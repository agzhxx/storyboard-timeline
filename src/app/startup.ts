// What happens before the editor shows (spec section 3.5): the tab asks for the project's lock
// (src/save/project-lock.ts). With it, My files is read back, the newest good save is restored,
// with its view, and autosave starts; then the editor (or the phone view) shows, never the empty
// state first. Without it, another tab has the project, and this one says so until it gets it, or
// takes it over. Leaving or hiding the page saves what's waiting at once.

import { create } from "zustand";
import { createProject, projectDuration } from "../engine/project.ts";
import { newId, useDocumentStore, useUiStore } from "../engine/store.ts";
import { restoreLibrary, useLibrary } from "../media/library.ts";
import { forgetMissing, markMissing } from "../media/missing.ts";
import { openStorage } from "../media/opfs.ts";
import { playback } from "../media/playback.ts";
import { Autosave, type Newest, useSaveStatus } from "../save/autosave.ts";
import { persistOnce } from "../save/persist.ts";
import { type Claim, ProjectLock } from "../save/project-lock.ts";
import { type Restored, restoreWithin } from "../save/restore.ts";
import { saveWorker } from "../save/save-client.ts";
import type { SaveFailure } from "../save/save-protocol.ts";
import { announce } from "./announcer.ts";
import { followDemoLink } from "./demo-link.ts";
import { watchConnection } from "./online.ts";
import { NOT_OPENED, statusText, storageFullDetail } from "./save-text.ts";
import { showProblem, showToast } from "./toast-store.ts";

/**
 * Where the tab is: getting the project ("starting", nothing shows), editing it, or showing that
 * another tab has it, from the start ("elsewhere") or since it took it over ("moved").
 */
export type SessionState = "starting" | "editing" | Exclude<Claim, "owner">;

export const useSession = create<{ state: SessionState }>(() => ({ state: "starting" }));

/** How long restoring may take before the editor starts without it (storage that hangs). */
const RESTORE_TIMEOUT_MS = 5_000;

/**
 * How long after the editor shows the save worker starts, when restoring didn't need it: ahead of
 * the first save, so saving still works if the connection goes before then.
 */
const WARM_SAVE_WORKER_MS = 1_000;

export const autosave = new Autosave({
  worker: saveWorker,
  documentStore: useDocumentStore,
  uiStore: useUiStore,
  now: () => Date.now(),
  onRealWork: () => {
    void persistOnce();
  },
  onFailure: reportFailure,
});

/** A save that failed for a new reason: storage full is an alert; the rest is said politely. */
function reportFailure(failure: Exclude<SaveFailure, "busy">, lastSaved: number | null): void {
  if (failure === "quota") {
    showProblem("Storage is full", storageFullDetail(lastSaved), null);
    return;
  }
  const status = statusText({ kind: "failed", failure, lastSaved });
  if (status !== null) announce(`${status}.`);
}

/** Counts the times the tab got or lost the project: a restore under way when it changes is dropped. */
let claims = 0;

const lock = new ProjectLock(navigator.locks, (claim) => {
  claims += 1;
  if (claim === "owner") void open();
  else leave(claim);
});

/** Once, as the page loads: gets the project and follows the page's life and the connection. */
export function startSession(): void {
  lock.claim();
  watchConnection();
  // A file imported is real work too: storage may be asked to keep it.
  useLibrary.subscribe(({ entries }) => {
    if (entries.some((entry) => entry.status.step === "ready")) void persistOnce();
  });
  window.addEventListener("pagehide", () => {
    void autosave.flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void autosave.flush();
  });
}

/** "Use it here": takes the project over from the tab that has it. */
export function moveProjectHere(): void {
  lock.takeOver();
}

/** This tab has the project now: what storage holds comes back, and edits are saved. */
async function open(): Promise<void> {
  const claim = claims;
  // Started before the project loads, so its files' clips wait for their thumbnails' entries.
  void restoreLibrary();
  const restored = await restoreWithin(RESTORE_TIMEOUT_MS, openStorage, saveWorker);
  // Another tab took the project over while this one was restoring it: it's that tab's now.
  if (claim !== claims) return;
  const newest = apply(restored);
  if (restored.kind === "failed") {
    // Storage didn't answer: saving now could write over a save that's still there.
    useSaveStatus.setState({ status: { kind: "failed", failure: "other", lastSaved: null } });
  } else {
    autosave.start(newest);
  }
  useSession.setState({ state: "editing" });
  setTimeout(() => {
    if (useSession.getState().state === "editing") saveWorker.warm();
  }, WARM_SAVE_WORKER_MS);
  if (restored.kind === "restored") announce("Restored from this browser.");
  if (restored.kind === "unreadable") {
    showToast("Your last save couldn't be read back, so this is a new project.");
  }
  // Saving is off, as storage full stops it: an alert, whose Retry is a reload.
  if (restored.kind === "failed") {
    showProblem(NOT_OPENED.message, NOT_OPENED.detail, () => {
      location.reload();
    });
    return;
  }
  // "Open in Timeline" from the Feed: the story, into an empty project (src/app/demo-link.ts).
  followDemoLink();
}

/** Puts what was restored into the stores; the newest save, if one was restored. */
function apply(restored: Restored): Newest | null {
  playback.pause();
  const ui = useUiStore.getState();
  forgetMissing();
  if (restored.kind !== "restored") {
    useDocumentStore.getState().loadProject(createProject({ id: newId() }));
    useUiStore.setState({ playhead: 0, selection: [], activeTrackId: "V1" });
    ui.setZoom(2);
    ui.setScrollX(0);
    return null;
  }
  const { save, slot, missing } = restored;
  const { project, view } = save;
  useDocumentStore.getState().loadProject(project);
  useUiStore.setState({ selection: [], activeTrackId: "V1" });
  ui.setPlayhead(Math.min(view.playhead, projectDuration(project)));
  ui.setZoom(view.pxPerFrame);
  ui.setScrollX(view.scrollX);
  markMissing(missing);
  const { playhead, pxPerFrame, scrollX } = useUiStore.getState();
  return {
    slot,
    seq: save.seq,
    savedAt: save.savedAt,
    project,
    view: { playhead, pxPerFrame, scrollX },
  };
}

/**
 * Another tab has the project: this one stops saving and playing, and says so. An import under
 * way finishes into storage, where the other tab finds it at its next start.
 */
function leave(claim: Exclude<Claim, "owner">): void {
  autosave.stop();
  saveWorker.stop();
  playback.pause();
  useSession.setState({ state: claim });
}
