// Snapping (spec sections 3.2 and 4.3): while dragging, an edge within 8 px of the playhead,
// another clip's edge or frame 0 jumps to it. Pure geometry: whether the snapped spot is
// allowed (no overlap, not before 0) is for the commands and the timeline to decide.

import { clipEnd } from "./project.ts";
import { FRAME_TOLERANCE } from "./time.ts";
import type { Frames, Project } from "./types.ts";

/** How close an edge comes, in pixels, before it snaps. */
export const SNAP_DISTANCE_PX = 8;

/** The snap distance in frames at a zoom level: 8 px ÷ pixels per frame. */
export function snapThreshold(pxPerFrame: number): number {
  return SNAP_DISTANCE_PX / pxPerFrame;
}

/**
 * The candidate closest to `frame`, if it's within `threshold` frames, else null. `frame` can
 * fall between frames, as the pointer does. On a tie, the earlier candidate wins, so the answer
 * doesn't depend on the list's order. Distances allow for float error (`FRAME_TOLERANCE`), so
 * an edge exactly 8 px away snaps at any zoom, and a tie stays a tie.
 */
export function snap(
  frame: number,
  candidates: readonly Frames[],
  threshold: number,
): Frames | null {
  let best: Frames | null = null;
  for (const candidate of candidates) {
    const close = Math.abs(candidate - frame) <= threshold + FRAME_TOLERANCE;
    if (close && beats(candidate, best, frame)) best = candidate;
  }
  return best;
}

/** Whether `candidate` beats `best` as a snap for `frame`: it's closer, or as close and earlier. */
function beats(candidate: Frames, best: Frames | null, frame: number): boolean {
  if (best === null) return true;
  const difference = Math.abs(candidate - frame) - Math.abs(best - frame);
  return Math.abs(difference) <= FRAME_TOLERANCE ? candidate < best : difference < 0;
}

export interface SnapCandidatesArgs {
  playhead: Frames;
  /** The clips being dragged or trimmed: their own edges don't count. */
  exclude?: readonly string[];
}

/** Every frame an edge can snap to: 0, the playhead and both edges of every other clip. */
export function snapCandidates(
  project: Project,
  { playhead, exclude = [] }: SnapCandidatesArgs,
): Frames[] {
  const frames = new Set([0, playhead]);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (exclude.includes(clip.id)) continue;
      frames.add(clip.start);
      frames.add(clipEnd(clip));
    }
  }
  return [...frames].sort((a, b) => a - b);
}

export interface ClipSnap {
  /** The clip's snapped start. */
  start: Frames;
  /** The frame it snapped to, where the snap line goes. */
  at: Frames;
}

/**
 * Snaps a clip being moved by whichever of its two edges lands closer to a candidate. `start`
 * is where the pointer puts the clip, possibly between frames. On a tie, the start edge wins.
 */
export function snapClip(
  start: number,
  duration: Frames,
  candidates: readonly Frames[],
  threshold: number,
): ClipSnap | null {
  const end = start + duration;
  const startTarget = snap(start, candidates, threshold);
  const endTarget = snap(end, candidates, threshold);
  const startDistance = startTarget === null ? Infinity : Math.abs(startTarget - start);
  const endDistance = endTarget === null ? Infinity : Math.abs(endTarget - end);

  if (startTarget !== null && startDistance <= endDistance + FRAME_TOLERANCE) {
    return { start: startTarget, at: startTarget };
  }
  if (endTarget !== null) return { start: endTarget - duration, at: endTarget };
  return null;
}
