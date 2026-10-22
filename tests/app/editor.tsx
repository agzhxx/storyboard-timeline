// Renders the whole editor for component tests, on a fresh document, UI state and My files. jsdom
// has no layout: every element measures 0 × 0 at the page's top-left, so a pointer's clientX is its
// x on the tracks, clientY its y from the ruler's top, and the tracks' width stays unmeasured.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/app/App.tsx";
import { useExportDialog } from "../../src/app/export-open.ts";
import { useExportSession } from "../../src/app/export-session.ts";
import { useToastStore } from "../../src/app/toast-store.ts";
import { createProject } from "../../src/engine/project.ts";
import { useDocumentStore, useUiStore } from "../../src/engine/store.ts";
import type { Project } from "../../src/engine/types.ts";
import { useLibrary } from "../../src/media/library.ts";
import { useMediaCache } from "../../src/media/media-cache.ts";
import { useFeedTab } from "../../src/feed/feed-store.ts";
import { useGestureStore } from "../../src/timeline/gestures.ts";
import { testStory } from "./story.ts";

/** The rows' tops and middles, from the ruler's top (src/timeline/layout.ts). */
export const ROW_Y = { ruler: 14, V2: 64, V1: 144, A1: 224 } as const;

export function renderEditor(project: Project = testStory()) {
  useDocumentStore.getState().loadProject(project);
  useUiStore.setState({
    playhead: 0,
    selection: [],
    pxPerFrame: 2,
    scrollX: 0,
    viewportWidth: 0,
    snapping: true,
    activeTrackId: "V1",
  });
  useGestureStore.setState({ gesture: null });
  useToastStore.setState({ toast: null });
  useExportDialog.setState({ open: false });
  useExportSession.setState({ size: "1080p", encoders: {}, step: { kind: "settings" } });
  useLibrary.setState({ entries: [] });
  useFeedTab.setState({ tab: "files", collection: "story", clips: {} });
  useMediaCache.setState({ thumbnails: {}, posters: {}, peaks: {} });
  const user = userEvent.setup();
  render(<App />);
  return { user };
}

export function renderEmptyEditor() {
  return renderEditor(createProject({ id: "empty" }));
}

/** A clip on the timeline by its name, such as "07-medium". */
export function clipButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name} on `) });
}

/** A clip's box on the tracks, which moves and resizes; its button and its handles are inside. */
export function clipBox(name: string): HTMLElement {
  const box = clipButton(name).parentElement;
  if (!box) throw new Error(`${name} has no box`);
  return box;
}

/** The toasts at the bottom left. */
export function messages(): HTMLElement {
  return screen.getByRole("region", { name: "Messages" });
}

export function clipsNamed(name: string): HTMLElement[] {
  return screen.queryAllByRole("button", { name: new RegExp(`^${name} on `) });
}

/** Where a clip is in the document, by its asset's name. */
export function placed(name: string) {
  const { project } = useDocumentStore.getState();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (project.assets[clip.assetId]?.name === name) {
        const { start, in: inPoint, duration } = clip;
        return { trackId: track.id, start, in: inPoint, duration };
      }
    }
  }
  return undefined;
}

export function undoSteps(): number {
  return useDocumentStore.temporal.getState().pastStates.length;
}

export function clipsOn(trackId: string): number {
  return (
    useDocumentStore.getState().project.tracks.find((t) => t.id === trackId)?.clips.length ?? 0
  );
}

export function selectedIds(): string[] {
  return useUiStore.getState().selection;
}
