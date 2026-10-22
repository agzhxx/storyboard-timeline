// Autosave (spec section 3.5): the project and the view are written to this browser's storage a
// moment after each change, by the save worker, taking turns between two slots (src/save/
// save-file.ts). A document change saves after half a second without another, or two seconds into
// a run of them; a view change alone (the playhead, the zoom, the scroll) a second after it
// settles, without touching the app bar's status. Leaving the page, or hiding it, saves at once. An empty new
// project isn't saved. A save that can't be written leaves the newest slot, the last good save,
// as it was; storage running out says so in the app bar and once in a toast, and the next change
// tries again.

import { create } from "zustand";
import type { DocumentStore, UiStore } from "../engine/store.ts";
import { perfMode } from "../perf/counters.ts";
import type { Project } from "../engine/types.ts";
import { SaveError, type SaveWorker } from "./save-client.ts";
import {
  nextSlot,
  SAVE_FORMAT,
  SAVE_VERSION,
  type SavedView,
  type SaveFile,
  SLOT_FILES,
  type Slot,
} from "./save-file.ts";
import type { SaveFailure } from "./save-protocol.ts";

/** How long the document has to stay as it is before it's saved. */
export const SAVE_DELAY_MS = 500;

/** How long a run of changes can put a save off. */
export const MAX_SAVE_DELAY_MS = 2_000;

/** How long the view has to stay as it is before it's saved on its own. */
export const VIEW_SAVE_DELAY_MS = 1_000;

/** How long "Restored from this browser" shows before it says "Saved". */
export const RESTORED_FOR_MS = 4_000;

/** How soon a save that found its file busy (another tab's worker) tries again. */
const BUSY_RETRY_MS = 1_000;

/** What the app bar says about saving. */
export type SaveStatus =
  /** Nothing saved, and nothing to save yet: the app bar says nothing. */
  | { kind: "idle" }
  | { kind: "saving" }
  /** `at`: when the last save was written (Date.now()). */
  | { kind: "saved"; at: number }
  /** Just restored, from a save written at `at`. */
  | { kind: "restored"; at: number }
  /** The last try failed, and why; `lastSaved` is when the last good save was written. */
  | { kind: "failed"; failure: Exclude<SaveFailure, "busy">; lastSaved: number | null };

export const useSaveStatus = create<{ status: SaveStatus }>(() => ({
  status: { kind: "idle" },
}));

function setStatus(status: SaveStatus): void {
  useSaveStatus.setState({ status });
}

/** The newest save in storage: where it is, its number, when it was written, what it holds. */
export interface Newest {
  slot: Slot;
  seq: number;
  savedAt: number;
  project: Project;
  view: SavedView;
}

export interface AutosaveDeps {
  worker: SaveWorker;
  documentStore: DocumentStore;
  uiStore: UiStore;
  /** The wall clock, for each save's time. */
  now: () => number;
  /** A save holding real work was written: storage may be asked to keep it (src/save/persist.ts). */
  onRealWork: () => void;
  /** A save failed for a new reason, after the last good one written at `lastSaved`. */
  onFailure: (failure: Exclude<SaveFailure, "busy">, lastSaved: number | null) => void;
}

/** Whether a project holds anything worth keeping: an asset, so a clip or a file placed once. */
export function worthSaving(project: Project): boolean {
  return Object.keys(project.assets).length > 0;
}

function viewOf({ playhead, pxPerFrame, scrollX }: SavedView): SavedView {
  return { playhead, pxPerFrame, scrollX };
}

function sameView(a: SavedView, b: SavedView): boolean {
  return a.playhead === b.playhead && a.pxPerFrame === b.pxPerFrame && a.scrollX === b.scrollX;
}

export class Autosave {
  private readonly deps: AutosaveDeps;
  private newest: Newest | null = null;
  /** The number saves must come after: the last project's, which New project may have left. */
  private floor = 0;
  /** What's waiting to be saved: the document (the status says "Saving…"), or only the view. */
  private pending: "document" | "view" | null = null;
  private firstPendingAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private restoredTimer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> | null = null;
  private again = false;
  /** Whether it's saving: a write that ends after `stop()` changes nothing it says. */
  private active = false;
  /** The last failure reported, so a second try failing the same way doesn't report it again. */
  private reported: SaveFailure | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: AutosaveDeps) {
    this.deps = deps;
  }

  /**
   * Starts saving changes, from the save just restored (or none). The stores already hold what it
   * restored, so nothing is written until something changes.
   */
  start(restored: Newest | null): void {
    this.stop();
    this.active = true;
    this.newest = restored;
    this.reported = null;
    if (restored) {
      setStatus({ kind: "restored", at: restored.savedAt });
      this.restoredTimer = setTimeout(() => {
        if (useSaveStatus.getState().status.kind === "restored") {
          setStatus({ kind: "saved", at: restored.savedAt });
        }
      }, RESTORED_FOR_MS);
    } else {
      setStatus({ kind: "idle" });
    }
    const { documentStore, uiStore } = this.deps;
    const stopDocument = documentStore.subscribe(({ project }, previous) => {
      if (project !== previous.project) this.changed("document");
    });
    const stopView = uiStore.subscribe((state, previous) => {
      if (!sameView(state, previous)) this.changed("view");
    });
    this.unsubscribe = () => {
      stopDocument();
      stopView();
    };
  }

  /** Stops saving: another tab has the project now. Changes from here on aren't saved. */
  stop(): void {
    this.active = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cancelTimer();
    if (this.restoredTimer !== null) clearTimeout(this.restoredTimer);
    this.restoredTimer = null;
    this.pending = null;
  }

  /** Leaving or hiding the page: writes what's waiting now, rather than after the delay. */
  flush(): Promise<void> {
    if (this.timer === null) return this.writing ?? Promise.resolve();
    this.cancelTimer();
    this.run();
    return this.writing ?? Promise.resolve();
  }

  /**
   * New project: stops saving, waits for a save under way, deletes `folders` (the saves, the
   * files, the caches) with the worker, then lets `load` put the new project in, which isn't
   * saved until it holds something. Resolves with whether everything was deleted.
   *
   * The new project's saves are numbered after the last one's, so a slot the clear couldn't
   * delete never wins over them at the next start. Without a number to go on (saving never
   * started: the saves couldn't be opened), a clear that failed leaves saving off.
   */
  async replaceAll(folders: string[], load: () => void): Promise<boolean> {
    const known = this.active;
    this.stop();
    await this.writing?.catch(() => undefined);
    const cleared = await this.deps.worker.clear(folders).then(
      () => true,
      () => false,
    );
    this.floor = Math.max(this.floor, this.newest?.seq ?? 0);
    load();
    if (cleared || known) this.start(null);
    else setStatus({ kind: "failed", failure: "other", lastSaved: null });
    return cleared;
  }

  private changed(kind: "document" | "view"): void {
    const { project } = this.deps.documentStore.getState();
    // A new project with nothing in it isn't saved; once it holds something, every change is. An
    // undo back to nothing before the first save leaves nothing to save.
    if (!this.newest && !worthSaving(project)) {
      if (kind === "document" && this.pending === "document") {
        this.pending = null;
        this.cancelTimer();
        setStatus({ kind: "idle" });
      }
      return;
    }
    if (kind === "document") {
      this.pending = "document";
      if (useSaveStatus.getState().status.kind !== "failed") setStatus({ kind: "saving" });
      this.schedule(SAVE_DELAY_MS, true);
    } else if (this.pending !== "document") {
      this.pending = "view";
      this.schedule(VIEW_SAVE_DELAY_MS, false);
    }
  }

  /**
   * Writes after `delay` without another change. A run of document changes is `capped`: it can put
   * the save off two seconds at most. The view alone waits until it settles, so playback, which
   * moves the playhead every frame, saves nothing until it stops.
   */
  private schedule(delay: number, capped: boolean): void {
    this.cancelTimer();
    let wait = delay;
    if (capped) {
      const now = performance.now();
      this.firstPendingAt ??= now;
      wait = Math.max(0, Math.min(delay, MAX_SAVE_DELAY_MS - (now - this.firstPendingAt)));
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run();
    }, wait);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Writes what's waiting, one save at a time: changes during a write are saved after it. */
  private run(): void {
    if (this.writing) {
      this.again = true;
      return;
    }
    this.firstPendingAt = null;
    this.writing = this.writeOnce().finally(() => {
      this.writing = null;
      if (!this.again) return;
      this.again = false;
      if (this.pending && this.timer === null) this.run();
    });
  }

  private async writeOnce(): Promise<void> {
    const kind = this.pending;
    this.pending = null;
    if (!kind) return;
    const { documentStore, uiStore, worker, now } = this.deps;
    const { project } = documentStore.getState();
    const view = viewOf(uiStore.getState());
    const newest = this.newest;
    if (newest && newest.project === project && sameView(newest.view, view)) {
      if (kind === "document") this.settled(newest.savedAt);
      return;
    }
    const slot = nextSlot(newest?.slot ?? null);
    const seq = Math.max(newest?.seq ?? 0, this.floor) + 1;
    const savedAt = now();
    const save: SaveFile = {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      seq,
      savedAt,
      project,
      view,
    };
    // The main thread's part of a save; with ?perf=1, a performance measure the editing bench reads.
    const serializing = performance.now();
    const text = JSON.stringify(save);
    if (perfMode) {
      performance.measure("save", { start: serializing, detail: { kind, bytes: text.length } });
    }
    try {
      await worker.write(SLOT_FILES[slot], text);
    } catch (error) {
      // Stopped meanwhile (another tab took the project, which ended the worker): not a failure.
      if (this.active) this.failed(kind, error instanceof SaveError ? error.failure : "other");
      return;
    }
    if (!this.active) return;
    this.newest = { slot, seq, savedAt, project, view };
    this.reported = null;
    if (kind === "document" || useSaveStatus.getState().status.kind === "failed") {
      this.settled(savedAt);
    }
    if (worthSaving(project)) this.deps.onRealWork();
  }

  /** A save is written: "Saved", unless another change is already waiting. */
  private settled(at: number): void {
    if (this.pending !== "document") setStatus({ kind: "saved", at });
  }

  private failed(kind: "document" | "view", failure: SaveFailure): void {
    if (failure === "busy") {
      // Another tab's worker still has the file, as a tab hands the project over: try again.
      this.pending ??= kind;
      this.schedule(BUSY_RETRY_MS, false);
      return;
    }
    const lastSaved = this.newest?.savedAt ?? null;
    setStatus({ kind: "failed", failure, lastSaved });
    if (this.reported !== failure) this.deps.onFailure(failure, lastSaved);
    this.reported = failure;
    // This browser won't store files at all: there's no point trying again this session.
    if (failure === "unavailable") this.stop();
  }
}
