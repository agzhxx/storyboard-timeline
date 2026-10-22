// Where a dragged clip or edge can go (spec section 3.2). The commands refuse an edit that breaks a
// rule; these keep the timeline's preview inside the rules while the pointer moves, so the one
// command on release always succeeds. A clip dragged along its track stops at its neighbors'
// edges. A clip dragged to another track goes into the free gap under the pointer, or is refused
// when it doesn't fit. A trim stops at the source's ends, at a neighbor, at frame 0 and at one
// frame. Every input and output is a whole frame: callers round the pointer's position first.

import { clipEnd } from "./project.ts";
import type { Clip, Frames, Track } from "./types.ts";

/** A free stretch of a track: frames `start` to `end − 1`. After the last clip, `end` is Infinity. */
export interface Gap {
  start: Frames;
  end: Frames;
}

/**
 * The free stretch of a track around a frame, or null when a clip covers that frame. Clips in
 * `exclude` count as free space, such as the clip being dragged. A frame before 0 counts as 0.
 */
export function gapAt(track: Track, frame: Frames, exclude: readonly string[] = []): Gap | null {
  const at = Math.max(0, frame);
  let start = 0;
  let end = Infinity;
  for (const clip of track.clips) {
    if (exclude.includes(clip.id)) continue;
    if (clip.start <= at && at < clipEnd(clip)) return null;
    if (clipEnd(clip) <= at) start = Math.max(start, clipEnd(clip));
    else end = Math.min(end, clip.start);
  }
  return { start, end };
}

/**
 * Where a clip dragged along its own track can start: anywhere between the neighbors it started
 * between, never over one. Dragged past a neighbor, it stops at that neighbor's edge.
 */
export function clampMoveInTrack(track: Track, clip: Clip, start: Frames): Frames {
  // The clip's own spot is free once the clip is left out, so there's always a gap here.
  const gap = gapAt(track, clip.start, [clip.id]) ?? { start: clip.start, end: clipEnd(clip) };
  return clamp(start, gap.start, gap.end - clip.duration);
}

/**
 * Where a clip of `duration` frames dropped on a track can start: in the free gap under the
 * pointer, pushed inside it if it would stick out. Null when the pointer is over a clip or the gap
 * is too short, so the drop is refused.
 */
export function placeInGap(
  track: Track,
  duration: Frames,
  start: Frames,
  pointerFrame: Frames,
  exclude: readonly string[] = [],
): Frames | null {
  const gap = gapAt(track, pointerFrame, exclude);
  if (!gap || gap.end - gap.start < duration) return null;
  return clamp(start, gap.start, gap.end - duration);
}

/** What stopped a trim: the end of the source, a neighbor, frame 0, or the one-frame minimum. */
export type TrimLimit = "source" | "neighbor" | "timeline-start" | "one-frame";

export interface TrimClamp {
  /** Where the dragged edge goes: the clip's new start, or its new end (the frame after it). */
  edge: Frames;
  /** The limit the edge is held at, or null when it follows the pointer. */
  limit: TrimLimit | null;
}

/**
 * Where a clip's start can go when it's dragged to `start`: not before the source's first frame
 * (where `in` would be 0), the previous clip's end or frame 0, and not past the clip's last frame.
 * An edge exactly at a limit reports that limit, so the timeline can show it.
 */
export function clampTrimStart(track: Track, clip: Clip, start: Frames): TrimClamp {
  const previous = neighbors(track, clip).previous;
  const bounds: [Frames, TrimLimit][] = [
    [clip.start - clip.in, "source"],
    previous ? [clipEnd(previous), "neighbor"] : [0, "timeline-start"],
  ];
  const lastFrame = clipEnd(clip) - 1;
  if (start >= lastFrame) return { edge: lastFrame, limit: "one-frame" };
  const [lower, limit] = tightest(bounds, (a, b) => a > b);
  return start <= lower ? { edge: lower, limit } : { edge: start, limit: null };
}

/**
 * Where a clip's end can go when it's dragged to `end`: not past the source's last frame or the
 * next clip's start, and at least one frame after the clip's start.
 */
export function clampTrimEnd(
  track: Track,
  clip: Clip,
  sourceFrames: Frames,
  end: Frames,
): TrimClamp {
  const next = neighbors(track, clip).next;
  const bounds: [Frames, TrimLimit][] = [[clip.start + sourceFrames - clip.in, "source"]];
  if (next) bounds.push([next.start, "neighbor"]);
  const firstEnd = clip.start + 1;
  if (end <= firstEnd) return { edge: firstEnd, limit: "one-frame" };
  const [upper, limit] = tightest(bounds, (a, b) => a < b);
  return end >= upper ? { edge: upper, limit } : { edge: end, limit: null };
}

/** How far a clip's start or end can go, and what holds it at each end. */
export interface EdgeRange {
  min: Frames;
  max: Frames;
  minLimit: TrimLimit;
  maxLimit: TrimLimit;
}

/**
 * The frames a trim can take a clip's start (its first frame) or end (the frame after its last) to:
 * what a drag reaches, and the range of the edge's slider on the keyboard.
 */
export function trimRange(
  track: Track,
  clip: Clip,
  edge: "start" | "end",
  sourceFrames: Frames,
): EdgeRange {
  const clampAt = (to: Frames) =>
    edge === "start"
      ? clampTrimStart(track, clip, to)
      : clampTrimEnd(track, clip, sourceFrames, to);
  const low = clampAt(-Infinity);
  const high = clampAt(Infinity);
  return {
    min: low.edge,
    max: high.edge,
    minLimit: low.limit ?? "one-frame",
    maxLimit: high.limit ?? "one-frame",
  };
}

/** The clips right before and after a clip on its track (sorted by start, with no overlaps). */
export function neighbors(track: Track, clip: Clip): { previous?: Clip; next?: Clip } {
  const index = track.clips.findIndex((other) => other.id === clip.id);
  return { previous: track.clips[index - 1], next: track.clips[index + 1] };
}

/** The bound that binds first; on a tie, the first one listed (the source). */
function tightest(
  bounds: [Frames, TrimLimit][],
  tighter: (a: Frames, b: Frames) => boolean,
): [Frames, TrimLimit] {
  return bounds.reduce((best, bound) => (tighter(bound[0], best[0]) ? bound : best));
}

function clamp(value: Frames, min: Frames, max: Frames): Frames {
  return Math.min(max, Math.max(min, value));
}
