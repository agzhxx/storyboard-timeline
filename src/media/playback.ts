// Playback (spec sections 3.3 and 4.6). The audio clock leads: A1's music plays through the shared
// AudioContext, and the timeline's time is the context's time since the start, at the playback
// rate (src/media/clock.ts). The decode worker decodes each video track's clips ahead into a
// bounded queue (src/media/track-pump.ts), and each animation frame takes, for each track, the
// newest frame whose time has come, draws V1 then V2, and closes the frames before it
// (src/media/frame-queue.ts). A late frame is skipped, never waited for: the sound keeps time.
//
// Space plays and pauses, L plays (again for 2×), K pauses, J goes back a second and keeps playing
// or paused. An edit, a scrub or a jump pauses first; Space then plays from the playhead. Playback
// stops at the end of the cut, and at a frame that won't decode, with the monitor's message.

import { layersAt } from "../engine/picture.ts";
import { clipEnd, findAsset, findClip, projectDuration } from "../engine/project.ts";
import { dueUs, firstDueFrame, type MusicRun, musicPlan, videoPlan } from "../engine/schedule.ts";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { secondsToFrames } from "../engine/time.ts";
import type { Asset, Fps, Frames, Project } from "../engine/types.ts";
import { END_PADDING_PX } from "../engine/viewport.ts";
import { counters, perfMode } from "../perf/counters.ts";
import type { Turn } from "../timeline/draw.ts";
import { flushPlayhead } from "../timeline/playhead-loop.ts";
import { audioContext, musicOf } from "./audio.ts";
import { PlaybackClock } from "./clock.ts";
import { type DecodeEvent, type DecodeWorker, decodeWorker } from "./decode-client.ts";
import { LateFrames, TrackQueue } from "./frame-queue.ts";
import { Music } from "./music.ts";
import { dispatchPlayback, type Rate, usePlaybackStore } from "./playback-state.ts";
import { type PlaybackPicture, type Program, program as editorProgram } from "./program.ts";

/** How many frames each video track decodes ahead: a third of a second at 24 fps. */
export const QUEUE_CAPACITY = 8;

/** How long playback waits for its first frames before it starts anyway. */
export const PREROLL_MS = 1000;

/** How far ahead of the context's time the sound is scheduled, so it starts on time. */
const AUDIO_LEAD_SEC = 0.05;

/** A frame from the worker, with how its file turns it. */
interface TurnedFrame {
  frame: VideoFrame;
  turn: Turn;
  close(): void;
}

interface Session {
  id: number;
  fps: Fps;
  /** The cut's end: playback stops there. */
  end: Frames;
  rate: Rate;
  queues: Map<string, TrackQueue<TurnedFrame>>;
  /** Null while the first frames and the music are decoding. */
  clock: PlaybackClock | null;
  music: Music | null;
  /** The frame shown last, or where playback starts. */
  frame: Frames;
  /** The last frame counted for the late frames: the one before the start, at first. */
  counted: Frames;
  /** Where a clip's frames stopped coming, and why: playback pauses when it gets there. */
  failure: { clipId: string; frame: Frames; unreachable: boolean } | null;
  late: LateFrames;
  animation: number | null;
}

export interface PlaybackDeps {
  worker: DecodeWorker;
  program: Program;
  /** The shared AudioContext; null where there's none (the clock follows performance.now()). */
  audio: () => AudioContext | null;
  /** An asset's decoded music (src/media/audio.ts). */
  music: (asset: Asset) => Promise<AudioBuffer | null>;
  now: () => number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
}

export class Playback {
  private readonly deps: PlaybackDeps;
  private session: Session | null = null;
  private lastSession = 0;

  constructor(deps: PlaybackDeps) {
    this.deps = deps;
    deps.worker.listen((event) => {
      this.receive(event);
    });
    // An edit, an undo or another project pauses playback first. A "Can't decode" message goes
    // with its clip.
    useDocumentStore.subscribe(({ project }, previous) => {
      if (project === previous.project) return;
      this.pause();
      if (project.id !== previous.project.id) dispatchPlayback({ type: "project-loaded" });
      const { stop } = usePlaybackStore.getState();
      if (stop && !findClip(project, stop.clipId)) dispatchPlayback({ type: "clip-gone" });
    });
    // A paused playhead that moves leaves the "Can't decode" message behind.
    useUiStore.subscribe(({ playhead }, previous) => {
      if (playhead !== previous.playhead && !this.session) {
        dispatchPlayback({ type: "playhead-moved" });
      }
    });
    // A hidden tab draws nothing: pause, rather than play on unseen.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.pause();
      });
    }
  }

  /** Space. */
  toggle(): void {
    if (this.session) this.pause();
    else this.play(1);
  }

  /** L: plays at 1×; while playing, at 2×. */
  faster(): void {
    if (this.session) this.setRate(2);
    else this.play(1);
  }

  /** J: a second back, playing on if it was playing. */
  backOneSecond(): void {
    const frame = Math.max(
      0,
      useUiStore.getState().playhead - useDocumentStore.getState().project.fps,
    );
    const session = this.session;
    if (!session) {
      useUiStore.getState().setPlayhead(frame);
      return;
    }
    const { rate } = session;
    this.end(session, session.frame);
    this.play(rate, frame);
  }

  /** "Play again", after a clip's media didn't load: plays from where it stopped, trying again. */
  playAgain(): void {
    const stop = usePlaybackStore.getState().stop;
    if (stop) this.play(1, stop.frame);
  }

  /** "Play from the next clip", after a frame wouldn't decode: plays on from the clip's end. */
  playFromNextClip(): void {
    const stop = usePlaybackStore.getState().stop;
    const { project } = useDocumentStore.getState();
    const found = stop && findClip(project, stop.clipId);
    if (!found) return;
    const next = clipEnd(found.clip);
    // The clip ends the cut: there's nothing after it to play.
    if (next >= projectDuration(project)) useUiStore.getState().setPlayhead(next);
    else this.play(1, next);
  }

  /** Plays from the playhead (from the start if it's at the cut's end), or from `from`. */
  play(rate: Rate, from?: Frames): void {
    if (this.session) return;
    const { project } = useDocumentStore.getState();
    const end = projectDuration(project);
    if (end === 0) return;
    let start = from ?? useUiStore.getState().playhead;
    if (start >= end) start = 0;
    useUiStore.getState().setPlayhead(start);
    // Resumed inside the key press or click: browsers start sound only after a gesture.
    const context = this.deps.audio();
    void context?.resume().catch(() => undefined);

    this.lastSession += 1;
    const session: Session = {
      id: this.lastSession,
      fps: project.fps,
      end,
      rate,
      queues: new Map(),
      clock: null,
      music: null,
      frame: start,
      counted: start - 1,
      failure: null,
      late: new LateFrames(),
      animation: null,
    };
    this.session = session;
    dispatchPlayback({ type: "start", rate });
    this.deps.program.startPlayback();
    counters.late = 0;
    counters.expected = 0;

    const tracks = videoPlan(project, start);
    for (const { trackId } of tracks) {
      session.queues.set(
        trackId,
        new TrackQueue<TurnedFrame>((count) => {
          counters.openOnMain -= count;
          if (this.session === session) this.deps.worker.ack(session.id, trackId, count);
        }),
      );
    }
    if (tracks.length > 0) this.deps.worker.play(session.id, tracks, QUEUE_CAPACITY);

    const runs = musicPlan(project, start);
    const music = this.decodeMusic(project, runs);
    const framesIn = new Promise<void>((resolve) => {
      let waiting = true;
      const done = () => {
        waiting = false;
        resolve();
      };
      const check = () => {
        if (!waiting) return;
        if (this.session !== session || this.firstFramesIn(session, start)) done();
        else setTimeout(check, 16);
      };
      setTimeout(done, PREROLL_MS);
      check();
    });
    void Promise.all([music, framesIn]).then(([buffers]) => {
      if (this.session === session) this.startClock(session, start, runs, buffers, context);
    });
  }

  /** K, Space, an edit, a jump: stops where the picture is. */
  pause(): void {
    const session = this.session;
    if (!session) return;
    this.end(session, session.frame);
    dispatchPlayback({ type: "pause" });
  }

  private setRate(rate: Rate): void {
    const session = this.session;
    if (!session || session.rate === rate) return;
    session.rate = rate;
    dispatchPlayback({ type: "rate", rate });
    const { clock } = session;
    if (!clock) return; // Still starting: it starts at the new rate.
    const context = this.deps.audio();
    const position = session.frame / session.fps;
    session.music?.stop();
    const audioStart = (context?.currentTime ?? 0) + AUDIO_LEAD_SEC;
    clock.restart({ position, rate, audioStart });
    if (context && clock.source === "audio") {
      const { project } = useDocumentStore.getState();
      session.music = this.scheduleMusic(context, project, session.frame, audioStart, rate);
    }
  }

  /** Whether each track with a clip to decode where playback starts has its first frame. */
  private firstFramesIn(session: Session, start: Frames): boolean {
    const layers = layersAt(useDocumentStore.getState().project, start);
    return layers.every(
      (layer) => (session.queues.get(layer.trackId)?.length ?? 0) > 0 || session.failure !== null,
    );
  }

  private startClock(
    session: Session,
    start: Frames,
    runs: readonly MusicRun[],
    buffers: ReadonlyMap<string, AudioBuffer>,
    context: AudioContext | null,
  ): void {
    const { rate } = session;
    const position = start / session.fps;
    const audioStart = (context?.currentTime ?? 0) + AUDIO_LEAD_SEC;
    if (context) {
      const music = new Music(context);
      music.start(runs, buffers, audioStart, rate);
      session.music = music;
    }
    session.clock = new PlaybackClock(
      {
        audio: context,
        now: this.deps.now,
        // The sound can't be trusted to keep time any more: silence, rather than out of step.
        onFallBack: () => session.music?.stop(),
      },
      { position, rate, audioStart },
    );
    dispatchPlayback({ type: "playing" });
    this.tick(session);
  }

  private scheduleMusic(
    context: AudioContext,
    project: Project,
    from: Frames,
    at: number,
    rate: Rate,
  ): Music {
    const music = new Music(context);
    const runs = musicPlan(project, from);
    void this.decodeMusic(project, runs).then((buffers) => {
      // Decoded already when the playback started, so this is the same moment.
      if (this.session?.music === music) music.start(runs, buffers, at, rate);
    });
    return music;
  }

  /** The music the runs play, decoded, by asset; music that won't decode is left out. */
  private async decodeMusic(
    project: Project,
    runs: readonly MusicRun[],
  ): Promise<Map<string, AudioBuffer>> {
    const buffers = new Map<string, AudioBuffer>();
    await Promise.all(
      runs.map(async ({ assetId }) => {
        const asset = findAsset(project, assetId);
        if (!asset || buffers.has(assetId)) return;
        const buffer = await this.deps.music(asset);
        if (buffer) buffers.set(assetId, buffer);
      }),
    );
    return buffers;
  }

  /** One animation frame of playback. */
  private tick(session: Session): void {
    if (this.session !== session || !session.clock) return;
    const { fps } = session;
    const { project } = useDocumentStore.getState();
    const frame = secondsToFrames(session.clock.position(), fps);
    const failure = session.failure;
    if (failure && frame >= failure.frame) {
      this.stopOnFailure(session, failure);
      return;
    }
    if (frame >= session.end) {
      this.end(session, session.end);
      dispatchPlayback({ type: "pause" });
      return;
    }
    // A frame comes due once: the first animation frame that reaches it counts it.
    const due = frame > session.counted;
    if (due) {
      // Frames that came and went since the last animation frame were never shown.
      let skipped = 0;
      for (let between = session.counted + 1; between < frame; between += 1) {
        skipped += layersAt(project, between).length;
      }
      if (skipped > 0) session.late.skipped(skipped);
      session.counted = frame;
    }
    if (frame !== session.frame) {
      session.frame = frame;
      useUiStore.getState().setPlayhead(frame);
      followPlayhead(frame);
      flushPlayhead();
    }

    const layers = layersAt(project, frame);
    const target = dueUs(frame, fps);
    const shown = new Map<string, TurnedFrame>();
    let changed = false;
    for (const [trackId, queue] of session.queues) {
      const expected = layers.some((layer) => layer.trackId === trackId);
      const result = queue.show(target, expected);
      if (due && expected) session.late.due(result.onTime);
      if (result.frame) shown.set(trackId, result.frame);
      changed ||= result.changed;
    }
    if (changed) {
      const pictures: PlaybackPicture[] = layers.flatMap((layer) => {
        const picture = shown.get(layer.trackId);
        if (!picture) return [];
        const { frame: image, turn } = picture;
        return [{ image, width: image.displayWidth, height: image.displayHeight, ...turn }];
      });
      this.deps.program.drawPlayback(pictures);
    }
    this.count(session);
    session.animation = this.deps.requestFrame(() => {
      this.tick(session);
    });
  }

  private stopOnFailure(
    session: Session,
    { clipId, frame, unreachable }: NonNullable<Session["failure"]>,
  ): void {
    const { project } = useDocumentStore.getState();
    const found = findClip(project, clipId);
    const name = (found && findAsset(project, found.clip.assetId)?.name) ?? "this clip";
    this.end(session, frame);
    dispatchPlayback({ type: "decode-error", stop: { clipId, name, frame, unreachable } });
  }

  /** Stops everything a session holds, and leaves the playhead and the picture at `frame`. */
  private end(session: Session, frame: Frames): void {
    if (this.session !== session) return;
    this.session = null;
    if (session.animation !== null) this.deps.cancelFrame(session.animation);
    session.music?.stop();
    this.deps.worker.stop(session.id);
    for (const queue of session.queues.values()) queue.clear();
    this.count(session);
    for (const reading of counters.queues.values()) reading.length = 0;
    useUiStore.getState().setPlayhead(frame);
    this.deps.program.stopPlayback(frame);
    if (perfMode) {
      const { expected, late } = session.late;
      const clock = session.clock?.source ?? null;
      performance.mark("playback:stopped", { detail: { expected, late, clock } });
    }
  }

  private count(session: Session): void {
    counters.late = session.late.late;
    counters.expected = session.late.expected;
    for (const [trackId, queue] of session.queues) {
      counters.queues.set(trackId, { length: queue.length, capacity: QUEUE_CAPACITY });
    }
  }

  private receive(event: DecodeEvent): void {
    const session = this.session;
    switch (event.type) {
      case "frame": {
        counters.openOnMain += 1;
        const entry: TurnedFrame = {
          frame: event.frame,
          turn: { rotation: event.rotation, flip: event.flip },
          close: () => {
            event.frame.close();
          },
        };
        const queue = session?.id === event.session ? session.queues.get(event.trackId) : undefined;
        if (!queue) {
          // From a playback that has stopped: nobody will show it.
          entry.close();
          counters.openOnMain -= 1;
          return;
        }
        queue.push({
          frame: entry,
          clipId: event.clipId,
          presentUs: event.presentUs,
          endUs: event.endUs,
        });
        return;
      }
      case "failed": {
        if (session?.id !== event.session) return;
        // The first frame that needed the missing picture: frames before it showed good ones.
        const found = findClip(useDocumentStore.getState().project, event.clipId);
        let frame = firstDueFrame(event.atUs, session.fps);
        if (found) frame = Math.min(clipEnd(found.clip) - 1, Math.max(found.clip.start, frame));
        if (!session.failure || frame < session.failure.frame) {
          session.failure = { clipId: event.clipId, frame, unreachable: event.unreachable };
        }
        return;
      }
      case "crashed":
        if (session) this.pause();
        return;
      default:
        return;
    }
  }
}

/** Keeps the playhead in view while it plays: when it reaches the view's edge, the next page. */
function followPlayhead(frame: Frames): void {
  const { pxPerFrame, scrollX, viewportWidth, setScrollX } = useUiStore.getState();
  if (viewportWidth <= 0) return;
  const x = frame * pxPerFrame;
  if (x < scrollX || x > scrollX + viewportWidth - END_PADDING_PX) setScrollX(x - END_PADDING_PX);
}

/** The shared AudioContext, or null where this browser has no Web Audio. */
function sharedContext(): AudioContext | null {
  try {
    return audioContext();
  } catch {
    return null;
  }
}

/** The editor's playback. */
export const playback = new Playback({
  worker: decodeWorker,
  program: editorProgram,
  audio: sharedContext,
  music: musicOf,
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => {
    cancelAnimationFrame(handle);
  },
});
