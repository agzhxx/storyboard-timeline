// New project (spec section 3.5; Messages board's confirmation): once confirmed, everything this
// project kept in the browser goes, the saves, the files in My files and the caches (the Feed
// clips' filmstrips), and the empty project shows. It can't be undone: a fresh project starts a
// fresh history, and the saves are gone.

import { createProject } from "../engine/project.ts";
import { newId, useDocumentStore, useUiStore } from "../engine/store.ts";
import type { Project } from "../engine/types.ts";
import { clearLibrary } from "../media/library.ts";
import { forgetAllMedia } from "../media/media-cache.ts";
import { forgetMissing } from "../media/missing.ts";
import { ASSETS_FOLDER, REMOTE_FOLDER } from "../media/opfs.ts";
import { forgetRemoteMedia } from "../media/remote-media.ts";
import { SAVES_FOLDER } from "../save/save-file.ts";
import { announce } from "./announcer.ts";
import { autosave } from "./startup.ts";
import { dismissToast, showToast } from "./toast-store.ts";

/**
 * What the confirmation says goes: the project, the files added, or both; with neither, the last
 * save (it asks then only when saving failed, so storage may hold one the tab couldn't open).
 */
export function newProjectText(project: Project, files: number): string {
  const named = project.name === "Untitled project" ? "This project" : project.name;
  const placed = Object.keys(project.assets).length > 0;
  let what = "Your last save";
  if (placed && files > 0) what = `${named} and the files you added`;
  else if (placed) what = named;
  else if (files > 0) what = "The files you added";
  return `${what} will be removed from this browser. This can't be undone.`;
}

/** "Start new project": clears this browser's storage of the project, then shows the empty one. */
export async function startNewProject(): Promise<void> {
  dismissToast();
  // Filmstrip jobs waiting their turn, and an import under way, stop first: none may write into
  // storage once it's cleared, and a copy lets go of its file before the folders go.
  forgetRemoteMedia();
  clearLibrary();
  const cleared = await autosave.replaceAll([SAVES_FOLDER, ASSETS_FOLDER, REMOTE_FOLDER], () => {
    useDocumentStore.getState().loadProject(createProject({ id: newId() }));
    useUiStore.setState({ playhead: 0, selection: [], activeTrackId: "V1" });
    useUiStore.getState().setZoom(2);
    useUiStore.getState().setScrollX(0);
  });
  // The old clips are gone from the page by now, so their pictures can go.
  forgetAllMedia();
  forgetMissing();
  if (cleared) {
    announce("Started a new project.");
    return;
  }
  showToast("Some of the last project couldn't be removed from this browser.", null, {
    label: "Try again",
    run: () => void startNewProject(),
  });
}
