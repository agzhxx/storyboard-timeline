// The editor's state, in two Zustand stores (spec section 4.3).
// - The document store holds the project, which is all that undo and redo change. zundo keeps
//   its history: a snapshot of `{ project, lastEdit }` per step, up to 100 steps.
// - The UI store holds the rest of what the editor shows: playhead, selection, zoom, scroll,
//   snapping and the active track. It never enters the history, so undoing a trim doesn't move
//   the playhead; the selection only lets go of clips that are gone, and the scroll only moves
//   back when the cut gets too short for it.

import { temporal } from "zundo";
import { create, useStore } from "zustand";
import * as commands from "./commands.ts";
import { createProject, findAsset, findClip, projectDuration } from "./project.ts";
import { floorToFrame } from "./time.ts";
import type { Frames, Project } from "./types.ts";
import { clampScrollX, clampZoom, fitZoom, zoomAround, zoomRange } from "./viewport.ts";

/** One step of history: the project, and the label of the edit that made it. */
export interface HistoryEntry {
  project: Project;
  /** The edit that made this project, such as "trim end of 07-medium"; null for a fresh one. */
  lastEdit: string | null;
}

/** How many steps undo can go back. */
export const HISTORY_LIMIT = 100;

/** Repeats of one keyboard adjustment less than this far apart are one undo step. */
export const MERGE_WINDOW_MS = 1_000;

export interface EditOptions {
  /**
   * What a keyboard adjustment adjusts, such as the start of one clip: an edit with the same key as
   * the edit before it, less than `MERGE_WINDOW_MS` after it and with nothing else in between,
   * joins that edit's undo step instead of making its own. A held arrow key, or quick presses, on a
   * trim handle are then one step, as a drag is.
   */
  merge?: string;
}

export type AddClipResult =
  { ok: true; project: Project; clipId: string } | commands.CommandFailure;

export type SplitResult =
  { ok: true; project: Project; rightClipId: string } | commands.CommandFailure;

export interface DocumentState extends HistoryEntry {
  /** Adds a clip under a new id, which the result carries. */
  addClip: (args: Omit<commands.AddClipArgs, "clipId">) => AddClipResult;
  /**
   * Adds a clip of an asset the project may not have yet, such as a file from the media bin, under
   * a new id. The asset, the frame rate it may set and the clip are one step.
   */
  placeAsset: (args: Omit<commands.PlaceAssetArgs, "clipId">) => AddClipResult;
  moveClip: (args: commands.MoveClipArgs, options?: EditOptions) => commands.CommandResult;
  trimStart: (args: commands.TrimStartArgs, options?: EditOptions) => commands.CommandResult;
  trimEnd: (args: commands.TrimEndArgs, options?: EditOptions) => commands.CommandResult;
  /** Splits a clip; the right half gets a new id, which the result carries. */
  split: (args: Omit<commands.SplitArgs, "rightClipId">) => SplitResult;
  deleteClips: (args: commands.DeleteClipsArgs) => commands.CommandResult;
  /** Replaces the project (a new one, the demo, a restored save) and starts a fresh history. */
  loadProject: (project: Project) => void;
  undo: () => void;
  redo: () => void;
}

/**
 * A document store. Each edit action applies one command and records one undo step, or none
 * when the command fails or changes nothing; it returns the command's result either way. The
 * timeline writes once per gesture, on pointer release, so a whole drag or trim is one step
 * without pausing the history. Keyboard adjustments repeated in quick succession share a step
 * (`EditOptions.merge`); `now` is their clock. Edit only through these actions: a `setState` that
 * changes the project would still record a step, with no label.
 */
export function createDocumentStore(
  project: Project = createProject({ id: newId() }),
  now: () => number = () => performance.now(),
) {
  /** The last keyboard adjustment: what it adjusted, when, and the project it left. */
  let lastMerge: { key: string; at: number; project: Project } | null = null;

  const store = create<DocumentState>()(
    temporal(
      (set, get) => {
        /**
         * Keeps a successful edit as one labeled step, or as part of the step before it when it
         * repeats that step's adjustment. A failed or no-op edit leaves no step.
         */
        function commit<R extends commands.CommandResult>(
          result: R,
          label: string,
          { merge }: EditOptions = {},
        ): R {
          if (!result.ok || result.project === get().project) return result;
          const at = now();
          const joins =
            merge !== undefined &&
            lastMerge?.key === merge &&
            at - lastMerge.at < MERGE_WINDOW_MS &&
            lastMerge.project === get().project;
          const history = store.temporal.getState();
          if (joins) history.pause();
          set({ project: result.project, lastEdit: label });
          if (joins) history.resume();
          lastMerge = merge === undefined ? null : { key: merge, at, project: result.project };
          return result;
        }
        const nameOf = (clipId: string) => clipName(get().project, clipId);

        return {
          project,
          lastEdit: null,
          addClip: (args) => {
            const clipId = newId();
            const result = commands.addClip(get().project, { ...args, clipId });
            const name = findAsset(get().project, args.assetId)?.name ?? "a clip";
            return commit(result.ok ? { ...result, clipId } : result, `add ${name}`);
          },
          placeAsset: (args) => {
            const clipId = newId();
            const result = commands.placeAsset(get().project, { ...args, clipId });
            return commit(result.ok ? { ...result, clipId } : result, `add ${args.asset.name}`);
          },
          moveClip: (args, options) =>
            commit(commands.moveClip(get().project, args), `move ${nameOf(args.clipId)}`, options),
          trimStart: (args, options) =>
            commit(
              commands.trimStart(get().project, args),
              `trim start of ${nameOf(args.clipId)}`,
              options,
            ),
          trimEnd: (args, options) =>
            commit(
              commands.trimEnd(get().project, args),
              `trim end of ${nameOf(args.clipId)}`,
              options,
            ),
          split: (args) => {
            const rightClipId = newId();
            const result = commands.split(get().project, { ...args, rightClipId });
            const label = `split ${nameOf(args.clipId)}`;
            return commit(result.ok ? { ...result, rightClipId } : result, label);
          },
          deleteClips: (args) => {
            const label = deleteLabel(get().project, args.clipIds);
            return commit(commands.deleteClips(get().project, args), label);
          },
          loadProject: (next) => {
            lastMerge = null;
            set({ project: next, lastEdit: null });
            store.temporal.getState().clear();
          },
          // A move through the history ends a chain: the next press is a step of its own, not part
          // of the one undone or redone.
          undo: () => {
            lastMerge = null;
            store.temporal.getState().undo();
          },
          redo: () => {
            lastMerge = null;
            store.temporal.getState().redo();
          },
        };
      },
      {
        partialize: ({ project, lastEdit }): HistoryEntry => ({ project, lastEdit }),
        // Only a new project is a step, even for a write that skips the actions.
        equality: (past, current) => past.project === current.project,
        limit: HISTORY_LIMIT,
      },
    ),
  );
  return store;
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;

/** The editor's document. */
export const useDocumentStore = createDocumentStore();

export interface HistoryLabels {
  /** The edit Undo would take back, or null when there's nothing to undo. */
  undo: string | null;
  /** The edit Redo would bring back, or null when there's nothing to redo. */
  redo: string | null;
}

/**
 * For the toolbar's "Undo: trim end of 07-medium". Each step carries the label of the edit that
 * made it, so Undo's label is the current one and Redo's is the next future step's. The oldest
 * step kept still has its label, but with no step before it there's nothing to undo.
 *
 * Read the history through this hook, or through lengths and labels: zundo changes `pastStates`
 * and `futureStates` in place, so a component that selects the arrays themselves misses changes.
 */
export function useHistoryLabels(store: DocumentStore = useDocumentStore): HistoryLabels {
  const lastEdit = useStore(store, (state) => state.lastEdit);
  const canUndo = useStore(store.temporal, (state) => state.pastStates.length > 0);
  const redo = useStore(store.temporal, (state) => state.futureStates.at(-1)?.lastEdit ?? null);
  return { undo: canUndo ? lastEdit : null, redo };
}

/**
 * A new random id, from `crypto.randomUUID`. That exists only on HTTPS and localhost pages, so
 * over plain http (a phone trying the dev server on the LAN) the id is 32 hex digits from
 * `getRandomValues` instead.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clipName(project: Project, clipId: string): string {
  const clip = findClip(project, clipId)?.clip;
  return (clip && findAsset(project, clip.assetId)?.name) ?? "a clip";
}

function deleteLabel(project: Project, clipIds: string[]): string {
  const ids = [...new Set(clipIds)];
  const [only] = ids;
  return ids.length === 1 && only !== undefined
    ? `delete ${clipName(project, only)}`
    : `delete ${ids.length} clips`;
}

export interface UiState {
  /** The frame under the playhead: where a split or a `[` `]` trim happens. */
  playhead: Frames;
  /** The selected clips' ids, in the order they were picked. */
  selection: string[];
  /** The zoom, in pixels per frame: 2 at the design's default. */
  pxPerFrame: number;
  /** How far the timeline is scrolled, in pixels. */
  scrollX: number;
  /**
   * How wide the visible part of the tracks is, in pixels: 0 until the timeline has been
   * measured. Once it's known, the zoom stays between fitting the whole cut and 48 px per frame,
   * and the scroll between the start and the end of the cut (`viewport.ts`).
   */
  viewportWidth: number;
  /** Whether dragged edges snap (`N` turns it off and on). */
  snapping: boolean;
  /** The track whose clip under the playhead `S` splits when nothing is selected. */
  activeTrackId: string;
  /**
   * Moves the playhead to the frame a position falls in, rounded down like every time (so a
   * pointer anywhere on a frame picks that frame), and never before 0.
   */
  setPlayhead: (frame: number) => void;
  /** A click: selects only this clip. */
  selectClip: (clipId: string) => void;
  /** A Shift-click: adds this clip to the selection. */
  addToSelection: (clipId: string) => void;
  /** Esc: selects nothing. */
  clearSelection: () => void;
  /**
   * Zooms to `pxPerFrame` (kept inside the zoom range), scrolled so the frame under `anchorX`, a
   * point measured from the tracks' left edge, stays under it: the left edge by default.
   */
  setZoom: (pxPerFrame: number, anchorX?: number) => void;
  /**
   * Zooms in or out by a factor around a point, as + and − or Cmd/Ctrl + wheel do. At the end of
   * the range it stops, and it never zooms the other way.
   */
  zoomBy: (factor: number, anchorX: number) => void;
  /** Shift+Z: the zoom that shows the whole cut, scrolled to its start. */
  zoomToFit: () => void;
  /** Scrolls the timeline, never before its start or past the end of the cut. */
  setScrollX: (scrollX: number) => void;
  setViewportWidth: (viewportWidth: number) => void;
  toggleSnapping: () => void;
  setActiveTrack: (trackId: string) => void;
}

/**
 * A UI store: how the editor shows a document. None of it is in the undo history, so it follows
 * the document instead: when an edit, an undo or a load takes a selected clip away, the
 * selection drops it, and deleting the selection never trips over a clip that's gone; when the
 * cut gets shorter than the scroll, the scroll moves back to its end.
 */
export function createUiStore(documentStore: DocumentStore = useDocumentStore) {
  /** The cut's length and frame rate, which the zoom range and the scroll limit depend on. */
  const cut = () => {
    const { project } = documentStore.getState();
    return { duration: projectDuration(project), fps: project.fps };
  };
  /** A zoom kept inside the range, once the tracks are measured. */
  const limitZoom = (pxPerFrame: number, viewportWidth: number) => {
    if (viewportWidth <= 0) return pxPerFrame;
    const { duration, fps } = cut();
    return clampZoom(pxPerFrame, zoomRange(duration, fps, viewportWidth));
  };
  /** A scroll kept between the start and the end of the cut, once the tracks are measured. */
  const limitScroll = (scrollX: number, pxPerFrame: number, viewportWidth: number) =>
    viewportWidth <= 0
      ? Math.max(0, scrollX)
      : clampScrollX(scrollX, cut().duration, pxPerFrame, viewportWidth);
  /** The view zoomed to an already limited zoom around a point, with its scroll limited. */
  const zoomedView = (state: UiState, pxPerFrame: number, anchorX: number) => {
    const view = zoomAround(state, pxPerFrame, anchorX);
    return { pxPerFrame, scrollX: limitScroll(view.scrollX, pxPerFrame, state.viewportWidth) };
  };

  const store = create<UiState>()((set) => ({
    playhead: 0,
    selection: [],
    pxPerFrame: 2,
    scrollX: 0,
    viewportWidth: 0,
    snapping: true,
    activeTrackId: "V1",
    setPlayhead: (frame) => {
      set({ playhead: Math.max(0, floorToFrame(frame)) });
    },
    selectClip: (clipId) => {
      set({ selection: [clipId] });
    },
    addToSelection: (clipId) => {
      set((state) =>
        state.selection.includes(clipId) ? state : { selection: [...state.selection, clipId] },
      );
    },
    clearSelection: () => {
      set({ selection: [] });
    },
    setZoom: (pxPerFrame, anchorX = 0) => {
      set((state) => zoomedView(state, limitZoom(pxPerFrame, state.viewportWidth), anchorX));
    },
    zoomBy: (factor, anchorX) => {
      set((state) => {
        const next = limitZoom(state.pxPerFrame * factor, state.viewportWidth);
        const turnsAround = factor > 1 ? next < state.pxPerFrame : next > state.pxPerFrame;
        return turnsAround ? state : zoomedView(state, next, anchorX);
      });
    },
    zoomToFit: () => {
      set((state) => {
        if (state.viewportWidth <= 0) return state;
        const { duration, fps } = cut();
        return { pxPerFrame: fitZoom(duration, fps, state.viewportWidth), scrollX: 0 };
      });
    },
    setScrollX: (scrollX) => {
      set((state) => ({ scrollX: limitScroll(scrollX, state.pxPerFrame, state.viewportWidth) }));
    },
    setViewportWidth: (viewportWidth) => {
      set((state) => ({
        viewportWidth,
        scrollX: limitScroll(state.scrollX, state.pxPerFrame, viewportWidth),
      }));
    },
    toggleSnapping: () => {
      set((state) => ({ snapping: !state.snapping }));
    },
    setActiveTrack: (activeTrackId) => {
      set({ activeTrackId });
    },
  }));

  documentStore.subscribe(({ project }, previous) => {
    if (project === previous.project) return;
    const { selection, scrollX, pxPerFrame, viewportWidth } = store.getState();
    const kept = selection.filter((clipId) => findClip(project, clipId));
    if (kept.length < selection.length) store.setState({ selection: kept });
    // A shorter cut can leave the view scrolled past its end. The zoom stays as it was: a view
    // that rescaled itself after an edit would be hard to follow.
    const limited = limitScroll(scrollX, pxPerFrame, viewportWidth);
    if (limited !== scrollX) store.setState({ scrollX: limited });
  });
  return store;
}

export type UiStore = ReturnType<typeof createUiStore>;

/** The editor's view of the document. */
export const useUiStore = createUiStore();
