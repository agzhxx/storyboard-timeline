// What a drag on the timeline would do if the pointer were released now: the preview the clip
// draws while it moves. Each one snaps first (when snapping is on and Alt isn't held), then keeps
// the result inside the rules with the engine's limits. The snap line shows only when the limits
// left the snapped spot alone.

import {
  clampMoveInTrack,
  clampTrimEnd,
  clampTrimStart,
  placeInGap,
  type TrimLimit,
} from "../engine/limits.ts";
import { clipEnd } from "../engine/project.ts";
import { snap, snapClip } from "../engine/snapping.ts";
import type { Clip, Frames, Track } from "../engine/types.ts";

export interface Placement {
  trackId: string;
  start: Frames;
  /** False when there's no room under the pointer: releasing there changes nothing. */
  fits: boolean;
  /** Where the snap line goes, or null when nothing snapped. */
  snapAt: Frames | null;
}

interface SnapInput {
  /** Every frame an edge can snap to (`snapCandidates`). */
  candidates: readonly Frames[];
  /** The snap distance in frames (`snapThreshold`), or null when snapping is off or Alt is held. */
  threshold: number | null;
}

export interface MoveInput extends SnapInput {
  clip: Clip;
  /** The clip's own track, and the one the pointer is over (the same one, or another of its kind). */
  from: Track;
  to: Track;
  /** Where the pointer puts the clip's start, in frames; between two frames if it is. */
  proposed: number;
  /** The frame under the pointer: on another track, it picks the gap the clip goes into. */
  pointerFrame: Frames;
}

/** A clip being moved: along its track it stops at its neighbors; on another, it needs a gap. */
export function previewMove(input: MoveInput): Placement {
  const { clip, from, to } = input;
  if (to.id === from.id) {
    const snapped = snapStart(input, clip.duration);
    const start = clampMoveInTrack(from, clip, snapped.wanted);
    return { trackId: from.id, start, fits: true, snapAt: snapped.lineAt(start) };
  }
  return placeOn(to, clip.duration, input, [clip.id]);
}

export interface DropInput extends SnapInput {
  /** The track under the pointer, of the asset's kind. */
  track: Track;
  /** The new clip's length: all of its source. */
  duration: Frames;
  /** Where the pointer puts the new clip's start. */
  proposed: number;
  pointerFrame: Frames;
}

/** A clip dropped from the media bin: like a clip moved to another track. */
export function previewDrop(input: DropInput): Placement {
  return placeOn(input.track, input.duration, input);
}

export interface TrimInput extends SnapInput {
  clip: Clip;
  track: Track;
  edge: "start" | "end";
  /** Where the pointer puts the dragged edge, in frames. */
  proposed: number;
  /** The source's length in frames (`assetDurationFrames`). */
  sourceFrames: Frames;
}

export interface TrimPreview {
  start: Frames;
  duration: Frames;
  /** What holds the edge back, when something does. */
  limit: TrimLimit | null;
  snapAt: Frames | null;
}

/** A clip whose start or end is being dragged. */
export function previewTrim(input: TrimInput): TrimPreview {
  const { clip, track, edge, proposed, candidates, threshold } = input;
  const snapped = threshold === null ? null : snap(proposed, candidates, threshold);
  const wanted = snapped ?? Math.round(proposed);
  const { edge: at, limit } =
    edge === "start"
      ? clampTrimStart(track, clip, wanted)
      : clampTrimEnd(track, clip, input.sourceFrames, wanted);
  const snapAt = snapped !== null && at === snapped ? snapped : null;
  return edge === "start"
    ? { start: at, duration: clipEnd(clip) - at, limit, snapAt }
    : { start: clip.start, duration: at - clip.start, limit, snapAt };
}

/** A clip of `duration` frames put into the gap under the pointer on a track. */
function placeOn(
  track: Track,
  duration: Frames,
  input: SnapInput & { proposed: number; pointerFrame: Frames },
  exclude: readonly string[] = [],
): Placement {
  const snapped = snapStart(input, duration);
  const start = placeInGap(track, duration, snapped.wanted, input.pointerFrame, exclude);
  if (start === null) {
    return { trackId: track.id, start: Math.max(0, snapped.wanted), fits: false, snapAt: null };
  }
  return { trackId: track.id, start, fits: true, snapAt: snapped.lineAt(start) };
}

/** Snaps a clip's start by whichever edge is closer to a candidate, else rounds it to a frame. */
function snapStart(input: SnapInput & { proposed: number }, duration: Frames) {
  const snapped =
    input.threshold === null
      ? null
      : snapClip(input.proposed, duration, input.candidates, input.threshold);
  return {
    wanted: snapped?.start ?? Math.round(input.proposed),
    /** The snap line's frame, if the clip still starts where the snap put it. */
    lineAt: (start: Frames) => (snapped && start === snapped.start ? snapped.at : null),
  };
}
