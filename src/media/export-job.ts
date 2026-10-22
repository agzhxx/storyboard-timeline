// The export's frame loop (spec section 4.7). For each output frame of the cut, in order: each
// video track's frame from its reader (src/media/export-reader.ts), the music up to a second ahead
// of the picture (the file's tracks stay interleaved), then the frames drawn V1 then V2 onto the
// canvas and the canvas added to the video encoder. Each add is awaited: it resolves once the
// encoder and the file can take more (backpressure), so while they're behind nothing more is
// decoded or drawn, and memory stays flat however long the cut. Progress after each frame.

import { frameSchedule } from "../engine/export-schedule.ts";
import { projectDuration } from "../engine/project.ts";
import type { Frames, Project } from "../engine/types.ts";
import type { Frame } from "./export-reader.ts";

/** How far ahead of the picture the music is added, in seconds. */
export const AUDIO_LEAD_SEC = 1;

/** What the loop asks a track for: a clip's frame at a source time, or none yet (a TrackReader). */
export interface FrameSource<F extends Frame> {
  frameAt(clipId: string, seconds: number): Promise<F | null>;
}

export interface EncodeDeps<F extends Frame> {
  /** Each video track's frames, by track id. */
  readers: ReadonlyMap<string, FrameSource<F>>;
  /** Clears the picture to black and draws the frames on it, bottom first. */
  draw: (frames: readonly F[]) => void;
  /** Adds the picture as output frame `frame`; resolves once the encoder can take more. */
  addVideo: (frame: Frames) => Promise<void>;
  /** Adds the music up to `untilSec` seconds in; resolves once the encoder can take more. */
  addAudio: (untilSec: number) => Promise<void>;
  /** Output frame `frame` is in the encoder. */
  progress: (frame: Frames) => void;
  signal: AbortSignal;
}

/** What the export was doing when it stopped. */
export type Stage = "read" | "video" | "audio";

/** The export stopped at an output frame: reading a clip's frame, or encoding picture or sound. */
export class StageError extends Error {
  readonly stage: Stage;
  readonly frame: Frames;
  /** The asset whose frame couldn't be read. */
  readonly assetId: string | null;

  constructor(stage: Stage, frame: Frames, cause: unknown, assetId: string | null = null) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.stage = stage;
    this.frame = frame;
    this.assetId = assetId;
  }
}

/** Where the loop's time went, in ms: waiting for frames, for the music's and picture's adds. */
export interface LoopTimings {
  readMs: number;
  audioMs: number;
  videoMs: number;
}

/** Encodes the cut's frames, in order; stops with a `StageError`, or the signal's reason. */
export async function encodeFrames<F extends Frame>(
  project: Project,
  deps: EncodeDeps<F>,
): Promise<LoopTimings> {
  const timings: LoopTimings = { readMs: 0, audioMs: 0, videoMs: 0 };
  const frames = projectDuration(project);
  for (let frame = 0; frame < frames; frame += 1) {
    deps.signal.throwIfAborted();
    let started = performance.now();
    const pictures = await Promise.all(
      frameSchedule(project, frame).map(async ({ trackId, clipId, assetId, seconds }) => {
        const reader = deps.readers.get(trackId);
        try {
          if (!reader) throw new Error(`Nothing reads ${trackId}`);
          return await reader.frameAt(clipId, seconds);
        } catch (error) {
          throw new StageError("read", frame, error, assetId);
        }
      }),
    );
    timings.readMs += performance.now() - started;
    deps.signal.throwIfAborted();
    started = performance.now();
    await stage("audio", frame, () => deps.addAudio((frame + 1) / project.fps + AUDIO_LEAD_SEC));
    timings.audioMs += performance.now() - started;
    started = performance.now();
    await stage("video", frame, () => {
      deps.draw(pictures.filter((picture) => picture !== null));
      return deps.addVideo(frame);
    });
    timings.videoMs += performance.now() - started;
    deps.progress(frame);
  }
  return timings;
}

async function stage(name: Stage, frame: Frames, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    throw new StageError(name, frame, error);
  }
}
