// The program monitor's picture (spec sections 3.3 and 4.5): what its canvas shows, paused or
// playing, V2 over V1.
//
// Paused, a move of the playhead draws the picture in two stages (the two-stage scrub):
// 1. At once: each layer's exact frame if the cache has it. While scrubbing (a drag on the ruler,
//    or keys held down), a layer without one shows its nearest thumbnail, marked "Preview".
// 2. The exact frames from the decode worker, one request per layer, latest wins: an answer to a
//    request the playhead has moved on from is closed and dropped. Once every layer's frame is in,
//    the picture is exact: as soon as the pointer rests, the last request's answer replaces the
//    preview. A jump (a step, Home, the timecode field) keeps the last picture until then, dimmed
//    with a spinner if it takes longer than a moment.
// The exact frames are kept in a cache (src/media/frame-cache.ts), so going back over them, or an
// edit that leaves the picture as it was, draws them at once.
//
// Playing, playback (src/media/playback.ts) hands over each animation frame's frames to draw.

import { create } from "zustand";
import { layersAt, previewLocation } from "../engine/picture.ts";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { sourceSeconds } from "../engine/time.ts";
import type { Asset, Fps, Frames } from "../engine/types.ts";
import { recordScrub } from "../perf/counters.ts";
import {
  canvasContext,
  devicePixels,
  drawFitted,
  type Turn,
  type TurningContext2D,
} from "../timeline/draw.ts";
import { type DecodeEvent, type DecodeWorker, decodeWorker } from "./decode-client.ts";
import { FrameCache } from "./frame-cache.ts";
import { LatestWins } from "./latest-wins.ts";
import { requestMedia } from "./library.ts";
import { useMediaCache } from "./media-cache.ts";
import { dispatchPlayback } from "./playback-state.ts";
import { thumbnailCount, thumbnailIndexAt } from "./thumbnails.ts";

/** What the monitor shows over its canvas. */
export interface ProgramFlags {
  /** A layer shows its thumbnail, not its exact frame: the board's "Preview" chip. */
  preview: boolean;
  /** After a jump, the exact frame is taking a while: the picture dims, with a spinner. */
  loading: boolean;
}

export const useProgramStore = create<ProgramFlags>(() => ({ preview: false, loading: false }));

/** How long a jump's exact frame may take before the picture dims and the spinner shows. */
export const LOADING_DELAY_MS = 120;

/** Moves of the playhead closer together than this are a scrub: keys held down, say. */
export const RAPID_MS = 150;

/** An input this recent is what moved the playhead; an older one isn't (playback, an edit). */
const INPUT_MS = 100;

/**
 * How the playhead got where it is: dragged or moved again and again ("scrub": thumbnails first),
 * moved once ("jump": the last picture stays until the exact one is in), or left where playback
 * stopped ("settle": as a jump, without dimming).
 */
export type Move = "scrub" | "jump" | "settle";

/** A frame to draw during playback, as the worker turned it. */
export interface PlaybackPicture extends Turn {
  image: CanvasImageSource;
  width: number;
  height: number;
}

interface Layer {
  slot: string;
  clipId: string;
  asset: Asset;
  sourceFrame: Frames;
  /** The cache's key for its exact frame at this size. */
  key: string;
  /** The exact frame; null when the source has none there; undefined while it's decoding. */
  exact: ImageBitmap | null | undefined;
  /** Its frame wouldn't decode: it shows its thumbnail instead. */
  failed: boolean;
}

interface Wanted {
  frame: Frames;
  move: Move;
  /** When the playhead got there (performance.now()), for the scrub latencies. */
  at: number;
  /** What it shows: the frame, the layers' frames and the size. Nothing new, nothing to do. */
  signature: string;
  layers: Layer[];
  fps: Fps;
  done: boolean;
}

export class Program {
  private readonly worker: DecodeWorker;
  private canvas: HTMLCanvasElement | null = null;
  private readonly cache = new FrameCache<ImageBitmap>();
  private readonly latest = new LatestWins<string>();
  /** The slots it asks for stills in (the video tracks'): answers in others aren't its own. */
  private readonly slots = new Set<string>();
  private wanted: Wanted | null = null;
  private playing = false;
  /**
   * When the input that moved the playhead came in (its event's time), and when the monitor last
   * drew a move. The scrub latencies count from the input, as a person feels them.
   */
  private movedAt = 0;
  private inputAt = -Infinity;
  private lastMoveAt = -Infinity;
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(worker: DecodeWorker) {
    this.worker = worker;
    // Always listening, canvas or not: an answer that comes in after the monitor unmounts is
    // stale, and closed.
    worker.listen((event) => {
      this.receive(event);
    });
  }

  /** The monitor's canvas, from when it mounts until it unmounts. */
  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.unsubscribe?.();
    this.unsubscribe = null;
    // A monitor that mounts starts afresh: its first picture is a jump, not part of a scrub.
    this.lastMoveAt = -Infinity;
    if (!canvas) {
      this.forgetWanted();
      return;
    }
    // The scrub latencies count from the input that moved the playhead: Chrome hands pointer moves
    // over at the start of a display frame, so the event's own time is when it really came in.
    const onInput = (event: Event) => {
      this.inputAt = event.timeStamp;
    };
    const inputs = ["pointerdown", "pointermove", "keydown"] as const;
    for (const type of inputs)
      window.addEventListener(type, onInput, { capture: true, passive: true });
    const stopWatching = useUiStore.subscribe((state, previous) => {
      if (state.playhead === previous.playhead) return;
      const now = performance.now();
      const since = now - this.inputAt;
      this.movedAt = since >= 0 && since < INPUT_MS ? this.inputAt : now;
    });
    this.unsubscribe = () => {
      stopWatching();
      for (const type of inputs) window.removeEventListener(type, onInput, { capture: true });
    };
  }

  /**
   * The playhead is at `frame` while paused, as of this animation frame: draws the picture there.
   * `scrubbing` while the ruler is dragged; moves in quick succession count as a scrub too.
   */
  moveTo(frame: Frames, scrubbing: boolean): void {
    if (frame === this.wanted?.frame) {
      this.show(frame, this.wanted.move);
      return;
    }
    const now = performance.now();
    const rapid = now - this.lastMoveAt < RAPID_MS;
    this.lastMoveAt = now;
    this.show(frame, scrubbing || rapid ? "scrub" : "jump", Math.min(this.movedAt || now, now));
  }

  /** Draws the picture at a frame, if it isn't the one shown already. */
  show(frame: Frames, move: Move, at = performance.now()): void {
    if (this.playing || !this.canvas) return;
    const { project } = useDocumentStore.getState();
    const size = this.deviceSize();
    const layers: Layer[] = layersAt(project, frame).map((layer) => {
      const key = `${layer.asset.id}:${layer.sourceFrame}@${project.fps}:${size.width}x${size.height}`;
      return {
        slot: layer.trackId,
        clipId: layer.clip.id,
        asset: layer.asset,
        sourceFrame: layer.sourceFrame,
        key,
        exact: this.cache.get(key),
        failed: false,
      };
    });
    const signature = `${frame}|${layers.map((layer) => layer.key).join(",")}`;
    if (this.wanted?.signature === signature) return;
    this.clearLoading();
    this.wanted = { frame, move, at, signature, layers, fps: project.fps, done: false };

    for (const track of project.tracks) {
      if (!layers.some((layer) => layer.slot === track.id && layer.exact === undefined)) {
        this.latest.cancel(track.id);
      }
    }
    for (const layer of layers) {
      requestMedia(layer.asset);
      if (layer.exact !== undefined) continue;
      const seq = this.latest.request(layer.slot);
      this.slots.add(layer.slot);
      this.worker.still({
        slot: layer.slot,
        seq,
        assetId: layer.asset.id,
        location: previewLocation(layer.asset),
        seconds: sourceSeconds(layer.sourceFrame, project.fps),
        ...size,
      });
    }

    if (this.settleIfReady()) {
      // The cache had every frame: the first picture is the exact one.
      if (move === "scrub" && layers.length > 0) recordScrub("coarse", at, performance.now());
      return;
    }
    if (move === "scrub") {
      this.drawPaused();
      if (layers.length > 0) recordScrub("coarse", at, performance.now());
    } else if (move === "jump") {
      const wanted = this.wanted;
      this.loadingTimer = setTimeout(() => {
        if (this.wanted === wanted && !wanted.done) useProgramStore.setState({ loading: true });
      }, LOADING_DELAY_MS);
    }
  }

  /** The document changed under a paused playhead: the picture there may have too. */
  refresh(): void {
    this.show(useUiStore.getState().playhead, "jump");
  }

  /** A thumbnail came in: a picture still waiting for exact frames may draw it. */
  thumbnailsChanged(): void {
    const wanted = this.wanted;
    if (!this.playing && wanted && !wanted.done && wanted.move === "scrub") this.drawPaused();
  }

  /** The canvas changed size: the cached frames are the wrong size now. */
  resized(): void {
    if (this.playing) return;
    // The old frames, stretched, until the exact ones come in at the new size.
    if (this.wanted) this.drawPaused();
    this.cache.clear();
    this.wanted = null;
    this.show(useUiStore.getState().playhead, "settle");
  }

  /** Playback starts: it draws from here on. */
  startPlayback(): void {
    this.playing = true;
    this.forgetWanted();
    useProgramStore.setState({ preview: false, loading: false });
  }

  /** Draws one animation frame of playback, bottom first; with none, the monitor is black. */
  drawPlayback(pictures: readonly PlaybackPicture[]): void {
    const drawing = this.context();
    if (!drawing) return;
    const { context, box } = drawing;
    context.clearRect(0, 0, box.width, box.height);
    for (const picture of pictures) drawFitted(context, picture.image, picture, box, picture);
  }

  /** Playback stopped at `frame`: the last frame it drew stays until the exact one is in. */
  stopPlayback(frame: Frames): void {
    this.playing = false;
    this.show(frame, "settle");
  }

  private receive(event: DecodeEvent): void {
    if (event.type === "crashed") {
      // Every frame being decoded is lost: the layers show their thumbnails.
      for (const layer of this.wanted?.layers ?? []) {
        if (layer.exact === undefined) layer.failed = true;
      }
      this.settleIfReady();
      return;
    }
    if (event.type !== "still" && event.type !== "still-failed") return;
    const { slot, seq } = event;
    if (!this.slots.has(slot)) return;
    const bitmap = event.type === "still" ? event.bitmap : null;
    const layer = this.wanted?.layers.find((candidate) => candidate.slot === slot);
    if (!this.latest.isLatest(slot, seq) || !layer) {
      // Stale: the playhead moved on before it came in.
      bitmap?.close();
      return;
    }
    this.latest.cancel(slot);
    if (event.type === "still-failed") {
      layer.failed = true;
      // A frame that didn't load (the network) may on the next try: no badge for it.
      if (!event.unreachable) dispatchPlayback({ type: "frame-failed", clipId: layer.clipId });
    } else {
      // V1 and V2 can show the same frame of the same file: the first answer serves both, so the
      // cache never closes a bitmap a layer still draws.
      const cached = this.cache.get(layer.key);
      if (bitmap && cached) bitmap.close();
      else if (bitmap) this.cache.set(layer.key, bitmap);
      layer.exact = cached ?? bitmap;
    }
    if (!this.settleIfReady() && this.wanted?.move === "scrub") this.drawPaused();
  }

  /** Draws the exact picture once every layer is in; whether it did. */
  private settleIfReady(): boolean {
    const wanted = this.wanted;
    if (!wanted || wanted.done) return wanted?.done ?? false;
    if (wanted.layers.some((layer) => layer.exact === undefined && !layer.failed)) return false;
    wanted.done = true;
    this.clearLoading();
    // Where playback stopped on a frame that won't decode, its last frame stays, dimmed under the
    // monitor's message, as drawn.
    if (wanted.move === "settle" && wanted.layers.some((layer) => layer.failed)) return true;
    this.drawPaused();
    // The latency is the picture's: a gap's black screen isn't one.
    if (wanted.layers.length > 0 && wanted.move !== "settle") {
      recordScrub("exact", wanted.at, performance.now());
    }
    return true;
  }

  /** The paused picture: each layer's exact frame, or its nearest thumbnail until that's in. */
  private drawPaused(): void {
    const wanted = this.wanted;
    const drawing = this.context();
    if (!wanted) return;
    let preview = false;
    if (drawing) drawing.context.clearRect(0, 0, drawing.box.width, drawing.box.height);
    for (const layer of wanted.layers) {
      const image =
        layer.exact ?? (layer.exact === null ? null : this.thumbnail(layer, wanted.fps));
      if (!image) continue;
      if (!layer.exact) preview = true;
      if (drawing) drawFitted(drawing.context, image, image, drawing.box);
    }
    const { preview: shown, loading } = useProgramStore.getState();
    const settled = wanted.done;
    if (shown !== preview || (settled && loading)) {
      useProgramStore.setState({ preview, loading: settled ? false : loading });
    }
  }

  private thumbnail(layer: Layer, fps: Fps): ImageBitmap | undefined {
    const thumbnails = useMediaCache.getState().thumbnails[layer.asset.id];
    const count = thumbnailCount(layer.asset.durationSec);
    return thumbnails?.[thumbnailIndexAt(layer.sourceFrame / fps, count)];
  }

  private context(): { context: TurningContext2D; box: { width: number; height: number } } | null {
    const canvas = this.canvas;
    if (!canvas) return null;
    const box = { width: canvas.clientWidth, height: canvas.clientHeight };
    const context = canvasContext(canvas, box.width, box.height);
    return context ? { context, box } : null;
  }

  private deviceSize(): { width: number; height: number } {
    const canvas = this.canvas;
    return devicePixels(canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0);
  }

  private clearLoading(): void {
    if (this.loadingTimer !== null) clearTimeout(this.loadingTimer);
    this.loadingTimer = null;
    if (useProgramStore.getState().loading) useProgramStore.setState({ loading: false });
  }

  /** Drops the picture being decoded: its answers will be stale. */
  private forgetWanted(): void {
    this.clearLoading();
    for (const layer of this.wanted?.layers ?? []) this.latest.cancel(layer.slot);
    this.wanted = null;
  }
}

/** The editor's monitor picture. */
export const program = new Program(decodeWorker);
