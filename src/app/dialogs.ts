// Which of the app bar's dialogs is open: Keyboard shortcuts ("?") or the New project
// confirmation. Each is its own chunk, loaded the first time it opens (src/app/App.tsx).

import { create } from "zustand";
import { useDocumentStore } from "../engine/store.ts";
import { useLibrary } from "../media/library.ts";
import { playback } from "../media/playback.ts";
import { useSaveStatus } from "../save/autosave.ts";
import { startNewProject } from "./new-project.ts";

export const useDialogs = create<{ shortcuts: boolean; newProject: boolean }>(() => ({
  shortcuts: false,
  newProject: false,
}));

/** "?" and the app bar's button. */
export function openShortcuts(): void {
  useDialogs.setState({ shortcuts: true });
}

export function closeShortcuts(): void {
  useDialogs.setState({ shortcuts: false });
}

/**
 * The app bar's New project: pauses playback and asks first, unless there's nothing to lose, when
 * it just starts afresh: no clip or file was ever added, and saving hasn't failed (storage may then
 * hold a project the tab couldn't open, or a save from before everything was deleted).
 */
export function openNewProject(): void {
  playback.pause();
  const { assets } = useDocumentStore.getState().project;
  const empty = Object.keys(assets).length === 0 && useLibrary.getState().entries.length === 0;
  if (empty && useSaveStatus.getState().status.kind !== "failed") {
    void startNewProject();
    return;
  }
  useDialogs.setState({ newProject: true });
}

export function closeNewProject(): void {
  useDialogs.setState({ newProject: false });
}
