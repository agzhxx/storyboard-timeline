// What the keys, the toolbar, the monitor, the inspector and the media bin do. Each edit is one
// store action, so it's one undo step; when the document refuses it, the reason shows as a toast.

import { rateWithAsset } from "../engine/commands.ts";
import { clampMoveInTrack, type EdgeRange, trimRange } from "../engine/limits.ts";
import { clipAt, clipEnd, findAsset, findClip, projectDuration } from "../engine/project.ts";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { assetDurationFrames } from "../engine/time.ts";
import type { Asset, Frames, Project } from "../engine/types.ts";
import { END_PADDING_PX, ZOOM_STEP } from "../engine/viewport.ts";
import type { FeedClip } from "../feed/feed-clip.ts";
import { FeedClipError, feedAssetFor } from "../feed/feed-media.ts";
import { showFiles } from "../feed/feed-store.ts";
import { importFiles, removeFile } from "../media/library.ts";
import { markMissing } from "../media/missing.ts";
import { playback } from "../media/playback.ts";
import { pointerOverLanes } from "../timeline/lanes.ts";
import { announce, moveHistory } from "./announcer.ts";
import { showToast } from "./toast-store.ts";

const documentState = () => useDocumentStore.getState();
const uiState = () => useUiStore.getState();

const ONE_AT_A_TIME = "Split and trim work on one clip at a time.";

/**
 * Moves the playhead to a frame inside the cut (0 to the frame after its last one) and scrolls
 * the tracks to show it. Scrubbing moves it with `scrubTo` instead, without scrolling.
 */
export function movePlayhead(frame: number): void {
  scrubTo(frame);
  revealPlayhead();
}

/**
 * Moves the playhead to a frame inside the cut, as a drag along the ruler does. A scrub or a jump
 * during playback pauses it first.
 */
export function scrubTo(frame: number): void {
  playback.pause();
  const end = projectDuration(documentState().project);
  uiState().setPlayhead(Math.min(end, Math.max(0, frame)));
}

/** Moves the playhead by a number of frames. */
function stepPlayhead(frames: Frames): void {
  movePlayhead(uiState().playhead + frames);
}

/** ← and the monitor's frame-back button. */
export function backOneFrame(): void {
  stepPlayhead(-1);
}

/** → and the monitor's frame-forward button. */
export function forwardOneFrame(): void {
  stepPlayhead(1);
}

/** Shift+←. */
export function backOneSecond(): void {
  stepPlayhead(-documentState().project.fps);
}

/** Shift+→. */
export function forwardOneSecond(): void {
  stepPlayhead(documentState().project.fps);
}

/** Home. */
export function goToStart(): void {
  movePlayhead(0);
}

/** End: the frame after the cut's last one. */
export function goToEnd(): void {
  movePlayhead(projectDuration(documentState().project));
}

/** Space and the monitor's Play button: plays from the playhead, or pauses. */
export function togglePlayback(): void {
  playback.toggle();
}

/** L: plays; pressed again while playing, at 2×. */
export function playFaster(): void {
  playback.faster();
}

/** K. */
export function pausePlayback(): void {
  playback.pause();
}

/** J: a second back, playing on if it was playing. */
export function jumpBackOneSecond(): void {
  playback.backOneSecond();
}

/** After a frame wouldn't decode: plays on from the end of that clip. */
export function playFromNextClip(): void {
  playback.playFromNextClip();
}

/** After a clip's media didn't load: plays again from where it stopped. */
export function playAgain(): void {
  playback.playAgain();
}

/** Scrolls just enough to bring the playhead into view, with a little room beside it. */
function revealPlayhead(): void {
  revealFrames(uiState().playhead, uiState().playhead);
}

/**
 * Scrolls the tracks just enough to show frames `start` to `end` (a clip that keyboard focus
 * reaches, or the playhead), with a little room beside them; a range wider than the view shows
 * its start.
 */
export function revealFrames(start: Frames, end: Frames): void {
  const { pxPerFrame, scrollX, viewportWidth, setScrollX } = uiState();
  if (viewportWidth <= 0) return;
  const left = start * pxPerFrame - END_PADDING_PX;
  const right = end * pxPerFrame + END_PADDING_PX;
  if (left < scrollX || right - left > viewportWidth) setScrollX(left);
  else if (right > scrollX + viewportWidth) setScrollX(right - viewportWidth);
}

/**
 * S: splits the selected clip at the playhead, or with nothing selected, the clip under the
 * playhead on the active track. The right half ends up selected, as drawn.
 */
export function splitAtPlayhead(): void {
  const { selection, playhead, activeTrackId } = uiState();
  if (selection.length > 1) {
    showToast(ONE_AT_A_TIME);
    return;
  }
  const track = documentState().project.tracks.find((candidate) => candidate.id === activeTrackId);
  const clipId = selection[0] ?? (track && clipAt(track, playhead)?.id);
  if (clipId === undefined) {
    showToast(`There's no clip under the playhead on ${activeTrackId}.`);
    return;
  }
  const focused = focusIsIn([clipId]);
  const result = documentState().split({ clipId, at: playhead });
  if (!result.ok) {
    showToast(result.error.message);
    return;
  }
  uiState().selectClip(result.rightClipId);
  // Keyboard focus on the clip goes with the selection, to the right half.
  if (focused) focusClip(result.rightClipId);
}

/** [: trims the selected clip's start to the playhead. */
export function trimStartToPlayhead(): void {
  trimToPlayhead("start");
}

/** ]: trims the selected clip's end to the playhead. */
export function trimEndToPlayhead(): void {
  trimToPlayhead("end");
}

function trimToPlayhead(edge: "start" | "end"): void {
  const { selection, playhead } = uiState();
  const [clipId] = selection;
  if (clipId === undefined || selection.length > 1) {
    showToast(clipId === undefined ? "Select a clip to trim it to the playhead." : ONE_AT_A_TIME);
    return;
  }
  const result =
    edge === "start"
      ? documentState().trimStart({ clipId, start: playhead })
      : documentState().trimEnd({ clipId, end: playhead });
  if (!result.ok) showToast(result.error.message);
}

/**
 * ⌥← and ⌥→, a frame (with ⇧, a second): moves the selected clip along its track, stopping at its
 * neighbors and at frame 0, as a drag does. Presses in quick succession are one undo step.
 */
export function nudgeSelection(frames: Frames): void {
  const { selection } = uiState();
  const [clipId] = selection;
  if (clipId === undefined || selection.length > 1) {
    showToast(
      clipId === undefined ? "Select a clip to nudge it." : "Nudging works on one clip at a time.",
    );
    return;
  }
  const found = findClip(documentState().project, clipId);
  if (!found) return;
  const { clip, track } = found;
  const start = clampMoveInTrack(track, clip, clip.start + frames);
  if (start === clip.start) return;
  const result = documentState().moveClip({ clipId, start }, { merge: `${clipId}:move` });
  if (result.ok) revealFrames(start, start + clip.duration);
  else showToast(result.error.message);
}

/** ⌥← and ⌥→: a frame left or right; with ⇧, a second. */
export function nudge(direction: -1 | 1, bySecond: boolean): void {
  nudgeSelection(direction * (bySecond ? documentState().project.fps : 1));
}

/** A trim handle as a slider: where its edge is, and how far it can go. */
export interface EdgeSlider {
  value: Frames;
  range: EdgeRange;
}

/** A clip's start or end handle as a slider; null when the clip isn't in the project. */
export function edgeSlider(
  project: Project,
  clipId: string,
  edge: "start" | "end",
): EdgeSlider | null {
  const found = findClip(project, clipId);
  if (!found) return null;
  const { clip, track } = found;
  const asset = findAsset(project, clip.assetId);
  const sourceFrames = asset ? assetDurationFrames(asset, project.fps) : clip.in + clip.duration;
  return {
    value: edge === "start" ? clip.start : clipEnd(clip),
    range: trimRange(track, clip, edge, sourceFrames),
  };
}

/**
 * A trim handle's arrow keys: moves its edge by `frames`, no further than a drag could. A run of
 * presses (or a key held down) is one undo step.
 */
export function trimEdgeBy(clipId: string, edge: "start" | "end", frames: Frames): void {
  const slider = edgeSlider(documentState().project, clipId, edge);
  if (!slider) return;
  const { value, range } = slider;
  trimEdge(clipId, edge, Math.min(range.max, Math.max(range.min, value + frames)));
}

/** Home and End on a trim handle: its edge as far as it can go. */
export function trimEdgeTo(clipId: string, edge: "start" | "end", end: "min" | "max"): void {
  const slider = edgeSlider(documentState().project, clipId, edge);
  if (slider) trimEdge(clipId, edge, slider.range[end]);
}

function trimEdge(clipId: string, edge: "start" | "end", to: Frames): void {
  const before = edgeSlider(documentState().project, clipId, edge);
  if (!before || before.value === to) return;
  const merge = { merge: `${clipId}:${edge}` };
  const result =
    edge === "start"
      ? documentState().trimStart({ clipId, start: to }, merge)
      : documentState().trimEnd({ clipId, end: to }, merge);
  if (result.ok) revealFrames(to, to);
  else showToast(result.error.message);
}

/** Delete or Backspace: removes the selected clips, leaves gaps, and offers Undo. */
export function deleteSelection(): void {
  const { selection } = uiState();
  const [only] = selection;
  if (only === undefined) return;
  const { project } = documentState();
  const found = findClip(project, only);
  const name = (found && findAsset(project, found.clip.assetId)?.name) ?? "the clip";
  // Keyboard focus on a clip that goes moves to the clip after it on its track, or before it.
  const focused = focusIsIn(selection);
  const next =
    found &&
    (found.track.clips.slice(found.index + 1).find((clip) => !selection.includes(clip.id)) ??
      found.track.clips.slice(0, found.index).findLast((clip) => !selection.includes(clip.id)));
  const result = documentState().deleteClips({ clipIds: selection });
  if (!result.ok) {
    showToast(result.error.message);
    return;
  }
  const message =
    selection.length === 1 ? `Deleted ${name}.` : `Deleted ${selection.length} clips.`;
  showToast(message, result.project);
  if (focused && next) focusClip(next.id);
}

/** Whether keyboard focus is on one of these clips, or on one of their handles. */
function focusIsIn(clipIds: readonly string[]): boolean {
  const clip = document.activeElement?.closest<HTMLElement>("[data-clip-id]");
  return clip?.dataset.clipId !== undefined && clipIds.includes(clip.dataset.clipId);
}

/**
 * A trim handle is a slider only while its clip is the only one selected. When the selection
 * changes so it isn't (Esc, another clip selected too) and the handle has the focus, its clip takes
 * it, there and then: once the handle has lost its tabindex, browsers drop the focus to the page
 * (Chrome) or leave it on something hidden from assistive technology. Returns a function that
 * stops it.
 */
export function handOverHandleFocus(): () => void {
  return useUiStore.subscribe(({ selection }, previous) => {
    if (selection === previous.selection) return;
    const handle = document.activeElement?.closest<HTMLElement>("[data-edge]");
    const clipId = handle?.closest<HTMLElement>("[data-clip-id]")?.dataset.clipId;
    if (clipId === undefined || (selection.length === 1 && selection[0] === clipId)) return;
    document.querySelector<HTMLElement>(`[data-clip-id="${clipId}"] > [role="button"]`)?.focus();
  });
}

/** Puts keyboard focus on a clip once it's drawn. */
function focusClip(clipId: string): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-clip-id="${clipId}"] > [role="button"]`)?.focus();
  });
}

/**
 * Enter or a click on a card or a file in the media bin: adds all of the asset at the playhead.
 * A video goes on the active track if that's a video track, else on V1, and on the other video
 * track if that one is taken there; music goes on A1. The new clip ends up selected. A file joins
 * the project's assets as it's placed, and the first video sets an empty project's frame rate.
 */
export function addAtPlayhead(asset: Asset): void {
  const { project } = documentState();
  const { activeTrackId, playhead } = uiState();
  const preference = [activeTrackId, "V1"];
  const rank = (trackId: string) => {
    const index = preference.indexOf(trackId);
    return index === -1 ? preference.length : index;
  };
  const tracks = project.tracks
    .filter((track) => track.kind === asset.kind)
    .sort((a, b) => rank(a.id) - rank(b.id));
  let refusal: string | undefined;
  for (const track of tracks) {
    const result = documentState().placeAsset({ asset, trackId: track.id, start: playhead });
    if (result.ok) {
      selectNew(result.clipId, track.id);
      return;
    }
    refusal ??= result.error.message;
  }
  if (refusal !== undefined) showToast(refusal);
}

/**
 * A card or a file dropped on a track: adds all of the asset there (or its first `duration`
 * frames), and selects it.
 */
export function addAt(asset: Asset, trackId: string, start: Frames, duration?: Frames): void {
  const result = documentState().placeAsset({
    asset,
    trackId,
    start,
    ...(duration === undefined ? {} : { duration }),
  });
  if (result.ok) selectNew(result.clipId, trackId);
  else showToast(result.error.message);
}

/**
 * Enter or a click on a Feed card: adds the clip at the playhead, once its file's facts are in (at
 * once when they were read before). If they don't come, the toast says why.
 */
export async function addFeedClip(item: FeedClip): Promise<void> {
  const asset = await feedAssetOf(item);
  if (asset) addAtPlayhead(asset);
}

/**
 * A Feed card dropped on a track: adds the clip there, once its file's facts are in, and no longer
 * than its preview showed. A preview drawn before the facts came had the Feed's rounded length,
 * and its file can be a frame longer: it goes in as previewed, against the neighbor it touched,
 * instead of being refused.
 */
export async function addFeedClipAt(
  item: FeedClip,
  trackId: string,
  start: Frames,
  previewed: Frames,
): Promise<void> {
  const asset = await feedAssetOf(item);
  if (!asset) return;
  const frames = assetDurationFrames(asset, rateWithAsset(documentState().project, asset));
  addAt(asset, trackId, start, Math.min(previewed, frames));
}

async function feedAssetOf(item: FeedClip): Promise<Asset | null> {
  try {
    return await feedAssetFor(item);
  } catch (error) {
    showToast(error instanceof FeedClipError ? error.message : "Couldn't add that clip.");
    return null;
  }
}

/**
 * Files picked or dropped on the media bin: they join My files, which the bin shows, and are
 * imported one at a time. A file that's already there isn't imported again, and the toast says so.
 */
export function addFiles(files: Iterable<File>): void {
  showFiles();
  void importFiles(files).then(({ duplicates }) => {
    const [first] = duplicates;
    if (first === undefined) return;
    showToast(
      duplicates.length === 1
        ? `${first} is already in My files.`
        : `${duplicates.length} of those files are already in My files.`,
    );
  });
}

/**
 * Remove on a ready file in My files: it goes from this browser, with its copy, unless a clip on the
 * timeline uses it, which the toast says. A clip of it that Undo brings back afterwards shows that
 * its file is missing.
 */
export function removeFromMyFiles(id: string, name: string): void {
  const { project } = documentState();
  if (project.tracks.some((track) => track.clips.some((clip) => clip.assetId === id))) {
    showToast(`${name} is on the timeline. Delete its clips first, then remove it.`);
    return;
  }
  removeFile(id);
  markMissing([id]);
  announce(`Removed ${name} from this browser.`);
}

function selectNew(clipId: string, trackId: string): void {
  uiState().selectClip(clipId);
  uiState().setActiveTrack(trackId);
}

/** Cmd/Ctrl+Z, the toolbar's Undo and a toast's: says what it took back. */
export function undo(): void {
  moveHistory("undo");
}

/** Shift+Cmd/Ctrl+Z and the toolbar's Redo: says what it brought back. */
export function redo(): void {
  moveHistory("redo");
}

/** Esc. */
export function clearSelection(): void {
  uiState().clearSelection();
}

/** N and the toolbar's Snapping button. */
export function toggleSnapping(): void {
  uiState().toggleSnapping();
}

/**
 * + and the toolbar's Zoom in: one step in, around the pointer when it's over the tracks, else
 * around the playhead when it's in view, else around the middle.
 */
export function zoomIn(): void {
  uiState().zoomBy(ZOOM_STEP, zoomAnchor());
}

/** − and the toolbar's Zoom out, around the same point as `zoomIn`. */
export function zoomOut(): void {
  uiState().zoomBy(1 / ZOOM_STEP, zoomAnchor());
}

/** Shift+Z and the toolbar's Fit: the whole cut in view. */
export function fitCut(): void {
  uiState().zoomToFit();
}

/** The toolbar's slider: zooms to a level around the same point as `zoomIn`. */
export function zoomTo(pxPerFrame: number): void {
  uiState().setZoom(pxPerFrame, zoomAnchor());
}

function zoomAnchor(): number {
  const { playhead, pxPerFrame, scrollX, viewportWidth } = uiState();
  const pointer = pointerOverLanes();
  if (pointer !== null) return pointer;
  const playheadX = playhead * pxPerFrame - scrollX;
  return playheadX >= 0 && playheadX <= viewportWidth ? playheadX : viewportWidth / 2;
}
