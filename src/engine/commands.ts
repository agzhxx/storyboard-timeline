// The edit commands (spec section 4.3). Each one is pure: it takes a project and returns a new
// one, or an error saying why the edit isn't allowed. None throws or changes the project it's
// given, so undo can hand back the old project object as it was. Every result keeps the rules:
// - on each track, clips are sorted by start and never overlap;
// - a clip starts at frame 0 or later and is at least one frame long;
// - it uses only frames its source has: `in ≥ 0`, and `in + duration` is at most the source's
//   length in frames;
// - positions and lengths are whole frames;
// - it sits on a track of its asset's kind, and its id is unique.
// Tracks and assets a command doesn't touch keep their object identity.

import { clipEnd, findAsset, findClip } from "./project.ts";
import { assetDurationFrames, formatTimecode, projectRateFor } from "./time.ts";
import type { Asset, Clip, Fps, Frames, Project, Track } from "./types.ts";

export type CommandErrorCode =
  | "not-whole-frames"
  | "not-found"
  | "duplicate-id"
  | "wrong-track-kind"
  | "too-short"
  | "before-timeline-start"
  | "outside-source"
  | "overlap"
  | "nothing-to-split"
  | "has-clips";

export interface CommandError {
  code: CommandErrorCode;
  /** A sentence for the person editing, such as "That would overlap 07-medium on V1." */
  message: string;
}

export interface CommandFailure {
  ok: false;
  error: CommandError;
}

/** The edited project, or why the edit can't happen. A no-op edit returns its input. */
export type CommandResult = { ok: true; project: Project } | CommandFailure;

export interface AddClipArgs {
  /** The new clip's id. The caller makes it, so the command gives the same answer every time. */
  clipId: string;
  assetId: string;
  trackId: string;
  start: Frames;
  /** Where the clip starts in its source; 0 when left out. */
  in?: Frames;
  /** How long the clip is; the rest of the source after `in` when left out. */
  duration?: Frames;
}

export interface MoveClipArgs {
  clipId: string;
  start: Frames;
  /** Another track of the same kind; the clip's own track when left out. */
  trackId?: string;
}

export interface TrimStartArgs {
  clipId: string;
  /** The clip's new first frame on the timeline. Its end stays where it is. */
  start: Frames;
}

export interface TrimEndArgs {
  clipId: string;
  /** Where the clip now ends: the frame after its new last one. Its start stays where it is. */
  end: Frames;
}

export interface SplitArgs {
  clipId: string;
  /** The right half's first frame. */
  at: Frames;
  /** The right half's id, made by the caller. The left half keeps the clip's id. */
  rightClipId: string;
}

export interface DeleteClipsArgs {
  clipIds: string[];
}

export interface SetFrameRateArgs {
  fps: Fps;
}

export interface PlaceAssetArgs extends Omit<AddClipArgs, "assetId"> {
  /** The asset to place, such as a file from the media bin; it joins the project if it's new. */
  asset: Asset;
}

/** Adds a clip of an asset to a track. */
export function addClip(project: Project, args: AddClipArgs): CommandResult {
  if (!wholeFrames(args.start, args.in, args.duration)) return notWholeFrames();
  const asset = findAsset(project, args.assetId);
  if (!asset) return fail("not-found", `There's no asset ${args.assetId}.`);
  if (findClip(project, args.clipId)) return duplicateId(args.clipId);

  const inPoint = args.in ?? 0;
  const duration = args.duration ?? assetDurationFrames(asset, project.fps) - inPoint;
  const clip = { id: args.clipId, assetId: args.assetId, start: args.start, in: inPoint, duration };
  return putClip(project, clip, args.trackId);
}

/** Moves a clip to a new start, on its own track or another of the same kind. Never partway. */
export function moveClip(
  project: Project,
  { clipId, start, trackId }: MoveClipArgs,
): CommandResult {
  if (!wholeFrames(start)) return notWholeFrames();
  const found = findClip(project, clipId);
  if (!found) return clipNotFound(clipId);

  return putClip(project, { ...found.clip, start }, trackId ?? found.track.id);
}

/**
 * Moves a clip's first frame and keeps its last: `start` and `in` shift by the same amount and
 * `duration` changes by the opposite, so every frame that stays shows what it showed before.
 */
export function trimStart(project: Project, { clipId, start }: TrimStartArgs): CommandResult {
  if (!wholeFrames(start)) return notWholeFrames();
  const found = findClip(project, clipId);
  if (!found) return clipNotFound(clipId);

  const { clip, track } = found;
  const shift = start - clip.start;
  const trimmed = { ...clip, start, in: clip.in + shift, duration: clip.duration - shift };
  return putClip(project, trimmed, track.id);
}

/** Moves a clip's end and keeps its start: only `duration` changes. */
export function trimEnd(project: Project, { clipId, end }: TrimEndArgs): CommandResult {
  if (!wholeFrames(end)) return notWholeFrames();
  const found = findClip(project, clipId);
  if (!found) return clipNotFound(clipId);

  const { clip, track } = found;
  return putClip(project, { ...clip, duration: end - clip.start }, track.id);
}

/**
 * Cuts a clip in two at a frame, with at least one frame on each side. Both halves use the same
 * source, and the right one starts `at − start` frames further into it, so nothing on screen
 * changes.
 */
export function split(project: Project, { clipId, at, rightClipId }: SplitArgs): CommandResult {
  if (!wholeFrames(at)) return notWholeFrames();
  const found = findClip(project, clipId);
  if (!found) return clipNotFound(clipId);
  if (findClip(project, rightClipId)) return duplicateId(rightClipId);

  const { clip, track, index } = found;
  if (at <= clip.start || at >= clipEnd(clip)) {
    return fail("nothing-to-split", "A split needs at least one frame of the clip on each side.");
  }
  const leftDuration = at - clip.start;
  const left = { ...clip, duration: leftDuration };
  const right = {
    id: rightClipId,
    assetId: clip.assetId,
    start: at,
    in: clip.in + leftDuration,
    duration: clip.duration - leftDuration,
  };
  // The halves cover exactly the frames the clip did, so the rules still hold without checks.
  const clips = track.clips.toSpliced(index, 1, left, right);
  return { ok: true, project: withTrack(project, { ...track, clips }) };
}

/** Removes clips and leaves gaps where they were. Every id must exist, or nothing is removed. */
export function deleteClips(project: Project, { clipIds }: DeleteClipsArgs): CommandResult {
  const missing = clipIds.find((clipId) => !findClip(project, clipId));
  if (missing !== undefined) return clipNotFound(missing);
  if (clipIds.length === 0) return { ok: true, project };

  const doomed = new Set(clipIds);
  const tracks = project.tracks.map((track) =>
    track.clips.some((clip) => doomed.has(clip.id))
      ? { ...track, clips: track.clips.filter((clip) => !doomed.has(clip.id)) }
      : track,
  );
  return { ok: true, project: { ...project, tracks } };
}

/**
 * Changes the project's frame rate. Only an empty timeline can: every position and length on it is
 * a count of frames at the rate they were placed at.
 */
export function setFrameRate(project: Project, { fps }: SetFrameRateArgs): CommandResult {
  if (project.fps === fps) return { ok: true, project };
  if (project.tracks.some((track) => track.clips.length > 0)) {
    return fail("has-clips", "The frame rate can't change once the timeline has clips.");
  }
  return { ok: true, project: { ...project, fps } };
}

/**
 * The project's rate once an asset is placed on it: the first video on an empty timeline brings
 * its own, the nearest of 24, 25 and 30 (`projectRateFor`); anything else keeps the project's.
 */
export function rateWithAsset(project: Project, asset: Asset): Fps {
  const own = asset.kind === "video" && asset.fps !== undefined ? projectRateFor(asset.fps) : null;
  const empty = project.tracks.every((track) => track.clips.length === 0);
  return own !== null && empty ? own : project.fps;
}

/**
 * Adds a clip of an asset that may be new to the project, such as a file from the media bin. A new
 * asset joins the project's assets, and the first video placed on an empty timeline sets the
 * project's rate (`rateWithAsset`). All of it is one result, so one undo step, and nothing changes
 * when the clip can't go there.
 */
export function placeAsset(project: Project, { asset, ...clip }: PlaceAssetArgs): CommandResult {
  const withAsset = findAsset(project, asset.id)
    ? project
    : { ...project, assets: { ...project.assets, [asset.id]: asset } };
  // Only an empty timeline gets a new rate, so this never fails.
  const rated = setFrameRate(withAsset, { fps: rateWithAsset(project, asset) });
  return addClip(rated.ok ? rated.project : withAsset, { ...clip, assetId: asset.id });
}

/**
 * Puts `clip` on a track, in place of the clip with the same id wherever that is, if every rule
 * holds. The shared check behind adding, moving and trimming. When an edit breaks several rules,
 * the first one below is the one reported.
 */
function putClip(project: Project, clip: Clip, trackId: string): CommandResult {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return fail("not-found", `There's no track ${trackId}.`);
  const asset = findAsset(project, clip.assetId);
  if (!asset) return fail("not-found", `There's no asset ${clip.assetId}.`);

  // The end is a position too: past 2^53 it can't be counted exactly.
  if (!wholeFrames(clipEnd(clip))) return notWholeFrames();
  if (asset.kind !== track.kind) {
    const article = track.kind === "audio" ? "an" : "a";
    return fail(
      "wrong-track-kind",
      `${asset.name} is ${asset.kind}, and ${track.id} is ${article} ${track.kind} track.`,
    );
  }
  if (clip.start < 0) {
    return fail("before-timeline-start", "A clip can't start before 00:00:00:00.");
  }
  const sourceLength = assetDurationFrames(asset, project.fps);
  const pastTheEnd = () => {
    const length = formatTimecode(sourceLength, project.fps);
    return fail("outside-source", `That's past the end of ${asset.name}, which is ${length} long.`);
  };
  if (clip.in < 0) return fail("outside-source", `That's before the start of ${asset.name}.`);
  if (clip.in >= sourceLength) return pastTheEnd();
  if (clip.duration < 1) return fail("too-short", "A clip can't be shorter than one frame.");
  if (clip.in + clip.duration > sourceLength) return pastTheEnd();
  const neighbor = track.clips.find(
    (other) => other.id !== clip.id && other.start < clipEnd(clip) && clip.start < clipEnd(other),
  );
  if (neighbor) {
    const name = findAsset(project, neighbor.assetId)?.name ?? neighbor.id;
    return fail("overlap", `That would overlap ${name} on ${track.id}.`);
  }

  const current = findClip(project, clip.id);
  if (current?.track === track && sameClip(current.clip, clip)) return { ok: true, project };

  const tracks = project.tracks.map((candidate) => {
    const others = candidate.clips.filter((other) => other.id !== clip.id);
    if (candidate === track) return { ...track, clips: [...others, clip].sort(byStart) };
    return others.length === candidate.clips.length ? candidate : { ...candidate, clips: others };
  });
  return { ok: true, project: { ...project, tracks } };
}

function withTrack(project: Project, track: Track): Project {
  return {
    ...project,
    tracks: project.tracks.map((candidate) => (candidate.id === track.id ? track : candidate)),
  };
}

function sameClip(a: Clip, b: Clip): boolean {
  return (
    a.assetId === b.assetId && a.start === b.start && a.in === b.in && a.duration === b.duration
  );
}

function byStart(a: Clip, b: Clip): number {
  return a.start - b.start;
}

/** Whether every frame value given is a whole number (left-out optional values pass). */
function wholeFrames(...values: (Frames | undefined)[]): boolean {
  return values.every((value) => value === undefined || Number.isSafeInteger(value));
}

function fail(code: CommandErrorCode, message: string): CommandFailure {
  return { ok: false, error: { code, message } };
}

function notWholeFrames(): CommandFailure {
  return fail("not-whole-frames", "Positions and lengths must be whole frames.");
}

function clipNotFound(clipId: string): CommandFailure {
  return fail("not-found", `There's no clip ${clipId}.`);
}

function duplicateId(clipId: string): CommandFailure {
  return fail("duplicate-id", `There's already a clip ${clipId}.`);
}
