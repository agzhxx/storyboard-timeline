// Drags on the timeline (spec sections 3.2 and 4.4): moving and trimming clips, scrubbing along
// the ruler, and dropping a card from the media bin. While the pointer moves, only the gesture
// store below changes; the dragged clip draws itself from it with a CSS transform, and the other
// clips don't re-render. The document store is written once, on release: one command, so one
// undo step for the whole gesture. Esc cancels, Alt drags without snapping, and N turns snapping
// off and on, mid-drag too.

import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { addAt, scrubTo } from "../app/actions.ts";
import { isMac } from "../app/platform.ts";
import { showToast } from "../app/toast-store.ts";
import { rateWithAsset } from "../engine/commands.ts";
import type { TrimLimit } from "../engine/limits.ts";
import { clipEnd, findAsset, findClip } from "../engine/project.ts";
import { snapCandidates, snapThreshold } from "../engine/snapping.ts";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { assetDurationFrames, floorToFrame } from "../engine/time.ts";
import type { Asset, Fps, Frames, Track } from "../engine/types.ts";
import { frameAt, positionAt } from "../engine/viewport.ts";
import { lanesPoint, type LanesPoint, lanesRect, pointIn } from "./lanes.ts";
import { nearestRow } from "./layout.ts";
import { type Placement, previewDrop, previewMove, previewTrim } from "./previews.ts";

export interface MoveGesture extends Placement {
  kind: "move";
  clipId: string;
}

export interface TrimGesture {
  kind: "trim";
  clipId: string;
  edge: "start" | "end";
  start: Frames;
  duration: Frames;
  limit: TrimLimit | null;
  snapAt: Frames | null;
}

export interface ScrubGesture {
  kind: "scrub";
}

export interface DropGesture {
  kind: "drop";
  name: string;
  /** The project's rate once the asset is placed: a first video brings its own. */
  fps: Fps;
  /** Where the new clip would go, or null while the pointer isn't over the tracks. */
  placement: (Placement & { duration: Frames }) | null;
}

export type Gesture = MoveGesture | TrimGesture | ScrubGesture | DropGesture;

export const useGestureStore = create<{ gesture: Gesture | null }>(() => ({ gesture: null }));

/** The gesture a clip is part of, for that clip's own selector: null for every other clip. */
export function gestureOf(
  gesture: Gesture | null,
  clipId: string,
): MoveGesture | TrimGesture | null {
  return gesture &&
    (gesture.kind === "move" || gesture.kind === "trim") &&
    gesture.clipId === clipId
    ? gesture
    : null;
}

/** Where the snap line goes during a gesture, if an edge snapped. */
export function snapLineOf(gesture: Gesture | null): Frames | null {
  if (!gesture || gesture.kind === "scrub") return null;
  return gesture.kind === "drop" ? (gesture.placement?.snapAt ?? null) : gesture.snapAt;
}

interface Pointer {
  clientX: number;
  clientY: number;
  altKey: boolean;
}

interface Session {
  pointerId: number;
  /** How far the pointer moves, in pixels, before a press becomes a drag. */
  threshold: number;
  down: Pointer;
  last: Pointer;
  started: boolean;
  /** Where the tracks are on the page, measured once when the gesture starts. */
  rect: DOMRect;
  /** The drag begins: the pointer has moved past the threshold. */
  onStart?: () => void;
  /** Draws the preview for a pointer position, measured from the tracks' top-left corner. */
  update: (point: LanesPoint, pointer: Pointer) => void;
  /** The pointer is released after dragging: write the document. */
  finish: () => void;
  /** The pointer is released without dragging. */
  onClick?: () => void;
}

let session: Session | null = null;
let unsubscribe: (() => void) | null = null;

/** Whether a drag is under way, so the keys that edit wait until it ends. */
export function gestureActive(): boolean {
  return session !== null;
}

/** Esc: drops the gesture without writing anything; a dragged clip goes back. */
export function cancelGesture(): void {
  end();
}

/**
 * Starts listening to a press: on the window, so the drag keeps following the pointer outside the
 * element, and with pointer capture, outside the browser window too.
 */
function begin(
  event: ReactPointerEvent<HTMLElement>,
  gesture: Omit<Session, "pointerId" | "down" | "last" | "started" | "rect">,
) {
  end();
  const rect = lanesRect();
  if (!rect) return;
  const pointer = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
  session = {
    ...gesture,
    pointerId: event.pointerId,
    down: pointer,
    last: pointer,
    started: false,
    rect,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onAltKey);
  window.addEventListener("keyup", onAltKey);
  // A context menu or another window can swallow the release: drop the drag instead.
  window.addEventListener("contextmenu", end);
  window.addEventListener("blur", end);
  // Scrolling, zooming or toggling snapping mid-drag redraws the preview where the pointer is.
  unsubscribe = useUiStore.subscribe((state, previous) => {
    const { scrollX, pxPerFrame, snapping } = previous;
    if (
      state.scrollX !== scrollX ||
      state.pxPerFrame !== pxPerFrame ||
      state.snapping !== snapping
    ) {
      redraw();
    }
  });
  if (gesture.threshold === 0) start();
}

function start() {
  if (!session) return;
  session.started = true;
  session.onStart?.();
  redraw();
}

function redraw() {
  if (!session?.started) return;
  const { rect, last } = session;
  session.update(pointIn(rect, last.clientX, last.clientY), last);
}

function onPointerMove(event: PointerEvent) {
  if (!session || event.pointerId !== session.pointerId) return;
  // The button came up without a pointerup reaching the page: drop the drag, write nothing.
  if ((event.buttons & 1) === 0) {
    end();
    return;
  }
  session.last = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey };
  if (!session.started) {
    const moved = Math.hypot(
      event.clientX - session.down.clientX,
      event.clientY - session.down.clientY,
    );
    if (moved < session.threshold) return;
    start();
    return;
  }
  redraw();
}

function onPointerUp(event: PointerEvent) {
  if (!session || event.pointerId !== session.pointerId) return;
  const { started, finish, onClick } = session;
  if (started) finish();
  else onClick?.();
  end();
}

function onPointerCancel(event: PointerEvent) {
  if (session && event.pointerId === session.pointerId) end();
}

/** Holding or letting go of Alt mid-drag turns snapping off or on at once. */
function onAltKey(event: KeyboardEvent) {
  if (!session || event.key !== "Alt") return;
  event.preventDefault();
  session.last = { ...session.last, altKey: event.type === "keydown" };
  redraw();
}

function end() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerCancel);
  window.removeEventListener("keydown", onAltKey);
  window.removeEventListener("keyup", onAltKey);
  window.removeEventListener("contextmenu", end);
  window.removeEventListener("blur", end);
  unsubscribe?.();
  unsubscribe = null;
  session = null;
  useGestureStore.setState({ gesture: null });
}

/** A plain press of the main button: not a right-click, which on a Mac includes Ctrl+click. */
function primaryPress(event: ReactPointerEvent<HTMLElement>): boolean {
  return event.button === 0 && !(isMac && event.ctrlKey);
}

/** The snap distance in frames, or null when snapping is off or Alt is held. */
function snapDistance(pointer: Pointer): number | null {
  const { snapping, pxPerFrame } = useUiStore.getState();
  return snapping && !pointer.altKey ? snapThreshold(pxPerFrame) : null;
}

/**
 * A press on a clip: its body moves it, its edges trim it. The press selects the clip (Shift adds
 * it to the selection) and makes its track the active one. A press on a clip that's already part
 * of a bigger selection keeps that selection until it turns out to be a click or a drag.
 */
export function pressClip(
  event: ReactPointerEvent<HTMLElement>,
  clipId: string,
  part: "body" | "start" | "end",
): void {
  if (!primaryPress(event)) return;
  const { project } = useDocumentStore.getState();
  const found = findClip(project, clipId);
  if (!found) return;
  const { clip, track } = found;
  const ui = useUiStore.getState();
  const selectedBefore = ui.selection.includes(clipId);
  if (event.shiftKey) ui.addToSelection(clipId);
  else if (!selectedBefore) ui.selectClip(clipId);
  ui.setActiveTrack(track.id);

  const down = lanesPoint(event.clientX, event.clientY);
  if (!down) return;
  const downAt = positionAt(down.x, ui);
  const candidates = snapCandidates(project, { playhead: ui.playhead, exclude: [clipId] });
  const narrowSelection = () => {
    if (!event.shiftKey && useUiStore.getState().selection.length > 1) {
      useUiStore.getState().selectClip(clipId);
    }
  };

  if (part === "body") {
    begin(event, {
      threshold: 3,
      onStart: narrowSelection,
      onClick: narrowSelection,
      update: (point, pointer) => {
        const moved = positionAt(point.x, useUiStore.getState()) - downAt;
        const row = nearestRow(track.kind, point.y);
        const to = project.tracks.find((candidate) => candidate.id === row?.trackId) ?? track;
        const placement = previewMove({
          clip,
          from: track,
          to,
          proposed: clip.start + moved,
          pointerFrame: floorToFrame(downAt + moved),
          candidates,
          threshold: snapDistance(pointer),
        });
        useGestureStore.setState({ gesture: { kind: "move", clipId, ...placement } });
      },
      finish: () => {
        const { gesture } = useGestureStore.getState();
        if (gesture?.kind !== "move" || !gesture.fits) return;
        if (gesture.start === clip.start && gesture.trackId === track.id) return;
        const result = useDocumentStore.getState().moveClip({
          clipId,
          start: gesture.start,
          trackId: gesture.trackId,
        });
        if (result.ok) useUiStore.getState().setActiveTrack(gesture.trackId);
        else showToast(result.error.message);
      },
    });
    return;
  }

  const asset = findAsset(project, clip.assetId);
  const sourceFrames = asset ? assetDurationFrames(asset, project.fps) : clip.in + clip.duration;
  const edgeBefore = part === "start" ? clip.start : clipEnd(clip);
  // A trim starts at the first pixel of movement: a click on an edge only selects the clip, and
  // at 2 px per frame, a one-frame trim is still possible.
  begin(event, {
    threshold: 1,
    onStart: narrowSelection,
    onClick: narrowSelection,
    update: (point, pointer) => {
      const moved = positionAt(point.x, useUiStore.getState()) - downAt;
      const preview = previewTrim({
        clip,
        track,
        edge: part,
        proposed: edgeBefore + moved,
        sourceFrames,
        candidates,
        threshold: snapDistance(pointer),
      });
      useGestureStore.setState({ gesture: { kind: "trim", clipId, edge: part, ...preview } });
    },
    finish: () => {
      const { gesture } = useGestureStore.getState();
      if (gesture?.kind !== "trim") return;
      const edit = useDocumentStore.getState();
      const result =
        part === "start"
          ? edit.trimStart({ clipId, start: gesture.start })
          : edit.trimEnd({ clipId, end: gesture.start + gesture.duration });
      if (!result.ok) showToast(result.error.message);
    },
  });
}

/** A press on the ruler: the playhead jumps to the frame under the pointer and follows it. */
export function pressRuler(event: ReactPointerEvent<HTMLElement>): void {
  if (!primaryPress(event)) return;
  begin(event, {
    threshold: 0,
    update: (point) => {
      scrubTo(frameAt(point.x, useUiStore.getState()));
      if (useGestureStore.getState().gesture?.kind !== "scrub") {
        useGestureStore.setState({ gesture: { kind: "scrub" } });
      }
    },
    finish: () => undefined,
  });
}

/**
 * A press on a card or a file in the media bin. Dragged onto a track, it shows where the new clip
 * would go and, on release, adds it there if it fits (`place`: by default, the asset itself; a Feed
 * card places its clip once its file's facts are in, given the start and length the preview had).
 * The asset can be a function, read at each move: a Feed clip's length and frame rate can arrive
 * mid-drag, and the preview takes them up. `onDragStart` lets the card ignore the click that
 * follows the release.
 */
export function pressAsset(
  event: ReactPointerEvent<HTMLElement>,
  asset: Asset | (() => Asset),
  onDragStart: () => void,
  place?: (trackId: string, start: Frames, duration: Frames) => void,
): void {
  const current = (): Asset => (typeof asset === "function" ? asset() : asset);
  const placeAt =
    place ??
    ((trackId: string, start: Frames) => {
      addAt(current(), trackId, start);
    });
  if (!primaryPress(event)) return;
  const { project } = useDocumentStore.getState();
  const pressed = current();
  if (assetDurationFrames(pressed, rateWithAsset(project, pressed)) < 1) return;
  const ui = useUiStore.getState();
  const candidates = snapCandidates(project, { playhead: ui.playhead });
  const { name, kind } = pressed;
  begin(event, {
    threshold: 4,
    onStart: onDragStart,
    update: (point, pointer) => {
      const shown = current();
      const fps = rateWithAsset(project, shown);
      const duration = assetDurationFrames(shown, fps);
      const row = point.inside ? nearestRow(kind, point.y) : undefined;
      const track: Track | undefined = project.tracks.find((t) => t.id === row?.trackId);
      if (!track) {
        useGestureStore.setState({ gesture: { kind: "drop", name, fps, placement: null } });
        return;
      }
      const at = positionAt(point.x, useUiStore.getState());
      const placement = previewDrop({
        track,
        duration,
        proposed: at,
        pointerFrame: floorToFrame(at),
        candidates,
        threshold: snapDistance(pointer),
      });
      useGestureStore.setState({
        gesture: { kind: "drop", name, fps, placement: { ...placement, duration } },
      });
    },
    finish: () => {
      const { gesture } = useGestureStore.getState();
      if (gesture?.kind !== "drop" || !gesture.placement?.fits) return;
      const { trackId, start, duration } = gesture.placement;
      placeAt(trackId, start, duration);
    },
  });
}
