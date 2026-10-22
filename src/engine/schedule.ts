// What playback decodes and plays from a timeline frame (spec section 4.6), worked out from the
// document before it starts. For each video track: its clips from there on, where their media is,
// the source times to decode, and where each source frame shows on the timeline. For A1: when each
// music clip starts, from where in its file, and for how long.

import { type MediaLocation, previewLocation } from "./picture.ts";
import { clipEnd, findAsset } from "./project.ts";
import { framesToMicroseconds, SOURCE_TOLERANCE_SEC, SOURCE_TOLERANCE_US } from "./time.ts";
import type { Asset, Clip, Fps, Frames, Project } from "./types.ts";

/** One clip's part of a playback on a video track. */
export interface VideoRun {
  clipId: string;
  assetId: string;
  /** Where the decoder opens the asset's media. */
  location: MediaLocation;
  /** Where it shows on the timeline, in µs: from its start, or where playback starts inside it. */
  startUs: number;
  /** Where it ends on the timeline, in µs. */
  endUs: number;
  /**
   * The source times to decode, in seconds: from the frame it shows first (plus the lookup
   * tolerance, so the decoder starts on that frame) to its out point (minus the tolerance, so the
   * first frame after the clip, stored a little early, stays out).
   */
  fromSec: number;
  toSec: number;
  /** Timeline µs minus source µs: a source frame at `t` µs shows from `t + offsetUs` on. */
  offsetUs: number;
}

export interface TrackPlan {
  trackId: string;
  runs: VideoRun[];
}

/** One music clip's part of a playback on A1. */
export interface MusicRun {
  clipId: string;
  assetId: string;
  /** Seconds of timeline from where playback starts to where it starts: 0 if it's already under way. */
  delaySec: number;
  /** Where in its file it starts, in seconds. */
  offsetSec: number;
  /** How much of its file it plays, in seconds. */
  durationSec: number;
}

/** Each track's clips that are still to come, or under way, at a frame. */
function clipsFrom(
  project: Project,
  kind: "video" | "audio",
  from: Frames,
): { trackId: string; clips: { clip: Clip; asset: Asset }[] }[] {
  return project.tracks
    .filter((track) => track.kind === kind)
    .map((track) => ({
      trackId: track.id,
      clips: track.clips.flatMap((clip) => {
        const asset = findAsset(project, clip.assetId);
        return asset && clipEnd(clip) > from ? [{ clip, asset }] : [];
      }),
    }))
    .filter((track) => track.clips.length > 0);
}

/** The video tracks' runs from a frame on, for the decode worker; tracks with none are left out. */
export function videoPlan(project: Project, from: Frames): TrackPlan[] {
  const { fps } = project;
  return clipsFrom(project, "video", from).map(({ trackId, clips }) => ({
    trackId,
    runs: clips.map(({ clip, asset }) => videoRun(clip, asset, from, fps)),
  }));
}

function videoRun(clip: Clip, asset: Asset, from: Frames, fps: Fps): VideoRun {
  const first = Math.max(clip.start, from);
  return {
    clipId: clip.id,
    assetId: asset.id,
    location: previewLocation(asset),
    startUs: framesToMicroseconds(first, fps),
    endUs: framesToMicroseconds(clipEnd(clip), fps),
    fromSec: (clip.in + first - clip.start) / fps + SOURCE_TOLERANCE_SEC,
    toSec: (clip.in + clip.duration) / fps - SOURCE_TOLERANCE_SEC,
    offsetUs: Math.round(((clip.start - clip.in) * 1_000_000) / fps),
  };
}

/**
 * Where a source frame decoded for a run shows on the timeline, and until when, in µs. The frame
 * showing where the run starts may start before it, in its source: it shows from the run's start.
 * One whose length the file doesn't give lasts until the clip's end (or until the next frame).
 */
export function placeOnTimeline(
  run: VideoRun,
  sample: { timestamp: number; duration: number },
): { presentUs: number; endUs: number } {
  const toTimeline = (seconds: number) => Math.round(seconds * 1_000_000) + run.offsetUs;
  const endUs =
    sample.duration > 0
      ? Math.min(run.endUs, toTimeline(sample.timestamp + sample.duration))
      : run.endUs;
  return { presentUs: Math.max(run.startUs, toTimeline(sample.timestamp)), endUs };
}

/**
 * The timeline time, in µs, at which a frame's pictures are picked: where it starts, plus the
 * tolerance for rounded source times. A decoded frame placed at or before it is due.
 */
export function dueUs(frame: Frames, fps: Fps): number {
  return framesToMicroseconds(frame, fps) + SOURCE_TOLERANCE_US;
}

/**
 * The first timeline frame whose pictures are picked at or after a time in µs: the first frame
 * that needs a source frame placed there, such as one that didn't decode. The inverse of `dueUs`;
 * the extra microsecond absorbs its rounding.
 */
export function firstDueFrame(us: number, fps: Fps): Frames {
  return Math.max(0, Math.ceil(((us - SOURCE_TOLERANCE_US - 1) * fps) / 1_000_000));
}

/** A1's music clips from a frame on, for the audio player. */
export function musicPlan(project: Project, from: Frames): MusicRun[] {
  const { fps } = project;
  return clipsFrom(project, "audio", from).flatMap(({ clips }) =>
    clips.map(({ clip, asset }) => {
      const first = Math.max(clip.start, from);
      return {
        clipId: clip.id,
        assetId: asset.id,
        delaySec: (first - from) / fps,
        offsetSec: (clip.in + first - clip.start) / fps,
        durationSec: (clipEnd(clip) - first) / fps,
      };
    }),
  );
}
