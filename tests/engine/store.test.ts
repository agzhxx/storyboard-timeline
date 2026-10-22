import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { findClip } from "../../src/engine/project.ts";
import {
  createDocumentStore,
  createUiStore,
  HISTORY_LIMIT,
  useHistoryLabels,
} from "../../src/engine/store.ts";
import {
  END_PADDING_PX,
  fitZoom,
  MAX_PX_PER_FRAME,
  positionAt,
} from "../../src/engine/viewport.ts";
import { storyProject } from "./fixtures.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A document store on the story: a at 0–72 and b (07-medium) at 96–168 on V1, music on A1. */
function storyStore() {
  const store = createDocumentStore(storyProject());
  return { store, edit: store.getState(), history: () => store.temporal.getState() };
}

describe("the document store", () => {
  test("starts with an empty 30 fps project and no history", () => {
    const store = createDocumentStore();
    const { project, lastEdit } = store.getState();

    expect(project.id).toMatch(UUID);
    expect(project.fps).toBe(30);
    expect(project.tracks.map((track) => track.clips)).toEqual([[], [], []]);
    expect(lastEdit).toBeNull();
    expect(store.temporal.getState().pastStates).toEqual([]);
  });

  test("records each edit as one undo step", () => {
    const { store, edit, history } = storyStore();

    expect(edit.trimEnd({ clipId: "b", end: 150 }).ok).toBe(true);
    expect(history().pastStates).toHaveLength(1);
    expect(edit.split({ clipId: "b", at: 120 }).ok).toBe(true);
    expect(history().pastStates).toHaveLength(2);
    expect(store.getState().lastEdit).toBe("split 07-medium");
  });

  test("labels each edit with what it did to which clip", () => {
    const { store, edit } = storyStore();
    const label = () => store.getState().lastEdit;

    edit.trimEnd({ clipId: "b", end: 150 });
    expect(label()).toBe("trim end of 07-medium");
    edit.trimStart({ clipId: "b", start: 100 });
    expect(label()).toBe("trim start of 07-medium");
    edit.moveClip({ clipId: "a", start: 10 });
    expect(label()).toBe("move 06-tracking");
    edit.split({ clipId: "b", at: 120 });
    expect(label()).toBe("split 07-medium");
    edit.addClip({ assetId: "08-closeup", trackId: "V2", start: 0 });
    expect(label()).toBe("add 08-closeup");
    edit.deleteClips({ clipIds: ["m"] });
    expect(label()).toBe("delete music");
    edit.deleteClips({ clipIds: ["a", "b"] });
    expect(label()).toBe("delete 2 clips");
  });

  test("records nothing for an edit that fails, and says why", () => {
    const { store, edit, history } = storyStore();
    const before = store.getState().project;

    expect(edit.moveClip({ clipId: "a", start: 30 })).toEqual({
      ok: false,
      error: { code: "overlap", message: "That would overlap 07-medium on V1." },
    });
    expect(store.getState().project).toBe(before);
    expect(store.getState().lastEdit).toBeNull();
    expect(history().pastStates).toHaveLength(0);
  });

  test("records nothing for an edit that changes nothing", () => {
    const { store, edit, history } = storyStore();

    expect(edit.moveClip({ clipId: "b", start: 96 }).ok).toBe(true);
    expect(edit.deleteClips({ clipIds: [] }).ok).toBe(true);
    expect(history().pastStates).toHaveLength(0);
    expect(store.getState().lastEdit).toBeNull();
  });

  test("records no step for a write that leaves the project as it was", () => {
    const { store, history } = storyStore();

    store.setState({});
    store.setState({ project: store.getState().project });
    expect(history().pastStates).toHaveLength(0);
  });

  test("gives new clips fresh ids and hands them back", () => {
    const { store, edit } = storyStore();

    const added = edit.addClip({ assetId: "08-closeup", trackId: "V2", start: 0, duration: 48 });
    if (!added.ok) throw new Error(added.error.message);
    const halves = edit.split({ clipId: added.clipId, at: 24 });
    if (!halves.ok) throw new Error(halves.error.message);

    expect(added.clipId).toMatch(UUID);
    expect(halves.rightClipId).toMatch(UUID);
    expect(halves.rightClipId).not.toBe(added.clipId);
    expect(findClip(store.getState().project, halves.rightClipId)?.clip).toMatchObject({
      start: 24,
      in: 24,
      duration: 24,
    });
  });

  test("makes ids without crypto.randomUUID, which plain http doesn't have", () => {
    // Only HTTPS and localhost pages get randomUUID: a phone trying the dev server over the LAN
    // doesn't.
    const real = crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    try {
      const store = createDocumentStore(storyProject());
      const added = store.getState().addClip({ assetId: "08-closeup", trackId: "V2", start: 0 });
      if (!added.ok) throw new Error(added.error.message);

      expect(added.clipId).toMatch(/^[0-9a-f]{32}$/);
      expect(createDocumentStore().getState().project.id).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("undo brings back the exact project, and redo the edited one", () => {
    const { store, edit } = storyStore();
    const before = store.getState().project;
    const snapshot = structuredClone(before);

    edit.split({ clipId: "b", at: 120 });
    const after = store.getState().project;
    edit.undo();

    expect(store.getState().project).toBe(before);
    expect(store.getState().project).toEqual(snapshot);
    expect(store.getState().lastEdit).toBeNull();

    edit.redo();
    expect(store.getState().project).toBe(after);
    expect(store.getState().lastEdit).toBe("split 07-medium");
  });

  test("walks back and forth through several steps", () => {
    const { store, edit } = storyStore();
    const projects = [store.getState().project];
    for (const end of [150, 140, 130]) {
      edit.trimEnd({ clipId: "b", end });
      projects.push(store.getState().project);
    }

    for (let step = 2; step >= 0; step--) {
      edit.undo();
      expect(store.getState().project).toBe(projects[step]);
    }
    for (let step = 1; step <= 3; step++) {
      edit.redo();
      expect(store.getState().project).toBe(projects[step]);
    }
  });

  test("forgets what it could redo once there's a new edit", () => {
    const { edit, history } = storyStore();

    edit.trimEnd({ clipId: "b", end: 150 });
    edit.undo();
    expect(history().futureStates).toHaveLength(1);
    edit.moveClip({ clipId: "a", start: 10 });
    expect(history().futureStates).toHaveLength(0);
  });

  test("undo and redo with nothing to do change nothing", () => {
    const { store, edit } = storyStore();
    const before = store.getState().project;

    edit.undo();
    edit.redo();
    expect(store.getState().project).toBe(before);
  });

  test("keeps the last 100 steps", () => {
    const { store, edit, history } = storyStore();
    for (let step = 1; step <= HISTORY_LIMIT + 5; step++) {
      edit.moveClip({ clipId: "b", start: 200 + step });
    }

    expect(history().pastStates).toHaveLength(HISTORY_LIMIT);
    for (let step = 0; step < HISTORY_LIMIT; step++) edit.undo();
    // The oldest step kept is the project after the fifth move.
    expect(findClip(store.getState().project, "b")?.clip.start).toBe(205);
    expect(history().pastStates).toHaveLength(0);
  });

  test("loading a project replaces the document and starts a fresh history", () => {
    const { store, edit, history } = storyStore();
    edit.trimEnd({ clipId: "b", end: 150 });
    edit.undo();
    const next = storyProject();

    edit.loadProject(next);

    expect(store.getState().project).toBe(next);
    expect(store.getState().lastEdit).toBeNull();
    expect(history().pastStates).toHaveLength(0);
    expect(history().futureStates).toHaveLength(0);
  });
});

describe("repeated keyboard adjustments", () => {
  /** A story store on a clock the test moves. */
  function clockedStore() {
    let time = 0;
    const store = createDocumentStore(storyProject(), () => time);
    return {
      store,
      edit: store.getState(),
      steps: () => store.temporal.getState().pastStates.length,
      wait: (ms: number) => {
        time += ms;
      },
    };
  }

  test("a held key's repeats on one trim handle are one undo step", () => {
    const { store, edit, steps, wait } = clockedStore();
    const original = store.getState().project;

    for (const end of [167, 166, 165, 164]) {
      expect(edit.trimEnd({ clipId: "b", end }, { merge: "b:end" }).ok).toBe(true);
      wait(33);
    }

    expect(steps()).toBe(1);
    expect(store.getState().lastEdit).toBe("trim end of 07-medium");
    edit.undo();
    expect(store.getState().project).toBe(original);
    edit.redo();
    expect(findClip(store.getState().project, "b")?.clip.duration).toBe(68);
  });

  test("presses less than a second apart join; a pause starts a new step", () => {
    const { edit, steps, wait } = clockedStore();

    edit.moveClip({ clipId: "b", start: 97 }, { merge: "b:move" });
    wait(999);
    edit.moveClip({ clipId: "b", start: 98 }, { merge: "b:move" });
    expect(steps()).toBe(1);
    wait(1_000);
    edit.moveClip({ clipId: "b", start: 99 }, { merge: "b:move" });
    expect(steps()).toBe(2);
  });

  test("another edge, another clip, an edit in between or an undo starts a new step", () => {
    const { edit, steps } = clockedStore();

    edit.trimEnd({ clipId: "b", end: 160 }, { merge: "b:end" });
    edit.trimStart({ clipId: "b", start: 100 }, { merge: "b:start" });
    expect(steps()).toBe(2);
    edit.moveClip({ clipId: "a", start: 4 }, { merge: "a:move" });
    expect(steps()).toBe(3);
    edit.split({ clipId: "b", at: 120 });
    edit.trimStart({ clipId: "b", start: 101 }, { merge: "b:start" });
    expect(steps()).toBe(5);
    edit.undo();
    edit.trimStart({ clipId: "b", start: 102 }, { merge: "b:start" });
    expect(steps()).toBe(5);
    expect(edit.trimStart({ clipId: "b", start: 103 }, { merge: "b:start" }).ok).toBe(true);
    expect(steps()).toBe(5);
  });

  test("an undo and a redo start a new step: the next press doesn't join the one redone", () => {
    const { store, edit, steps } = clockedStore();

    edit.trimEnd({ clipId: "b", end: 160 }, { merge: "b:end" });
    const trimmed = store.getState().project;
    edit.undo();
    edit.redo();
    edit.trimEnd({ clipId: "b", end: 159 }, { merge: "b:end" });
    expect(steps()).toBe(2);
    edit.undo();
    expect(store.getState().project).toBe(trimmed);
  });

  test("an edit without a key never joins, and a failed one breaks no chain", () => {
    const { edit, steps } = clockedStore();

    edit.trimEnd({ clipId: "b", end: 160 });
    edit.trimEnd({ clipId: "b", end: 159 }, { merge: "b:end" });
    expect(steps()).toBe(2);
    expect(edit.trimEnd({ clipId: "b", end: 500 }, { merge: "b:end" }).ok).toBe(false);
    edit.trimEnd({ clipId: "b", end: 158 }, { merge: "b:end" });
    expect(steps()).toBe(2);
  });

  test("a loaded project starts a new chain", () => {
    const { edit, steps } = clockedStore();

    edit.trimEnd({ clipId: "b", end: 160 }, { merge: "b:end" });
    edit.loadProject(storyProject());
    edit.trimEnd({ clipId: "b", end: 159 }, { merge: "b:end" });
    expect(steps()).toBe(1);
  });
});

describe("useHistoryLabels", () => {
  test("names the step undo would take back and the one redo would bring back", () => {
    const { store, edit } = storyStore();
    const { result } = renderHook(() => useHistoryLabels(store));
    expect(result.current).toEqual({ undo: null, redo: null });

    act(() => {
      edit.trimEnd({ clipId: "b", end: 150 });
      edit.split({ clipId: "b", at: 120 });
    });
    expect(result.current).toEqual({ undo: "split 07-medium", redo: null });

    act(() => {
      edit.undo();
    });
    expect(result.current).toEqual({ undo: "trim end of 07-medium", redo: "split 07-medium" });

    act(() => {
      edit.undo();
    });
    expect(result.current).toEqual({ undo: null, redo: "trim end of 07-medium" });
  });

  test("names nothing to undo at the oldest step kept, though that step has a label", () => {
    const { store, edit } = storyStore();
    for (let step = 1; step <= HISTORY_LIMIT + 1; step++) {
      edit.moveClip({ clipId: "b", start: 200 + step });
    }
    for (let step = 0; step < HISTORY_LIMIT; step++) edit.undo();

    const { result } = renderHook(() => useHistoryLabels(store));

    expect(store.getState().lastEdit).toBe("move 07-medium");
    expect(result.current.undo).toBeNull();
  });
});

describe("the UI store", () => {
  test("starts at frame 0 with nothing selected, 2 px per frame, snapping on and V1 active", () => {
    expect(createUiStore(storyStore().store).getState()).toMatchObject({
      playhead: 0,
      selection: [],
      pxPerFrame: 2,
      scrollX: 0,
      snapping: true,
      activeTrackId: "V1",
    });
  });

  test("puts the playhead on the frame a position falls in, at 0 or later", () => {
    const ui = createUiStore(storyStore().store);
    const playheadAfter = (frame: number) => {
      ui.getState().setPlayhead(frame);
      return ui.getState().playhead;
    };

    expect(playheadAfter(462)).toBe(462);
    expect(playheadAfter(12.4)).toBe(12);
    expect(playheadAfter(12.6)).toBe(12);
    expect(playheadAfter(3.3 / 1.1)).toBe(3);
    expect(playheadAfter(-24)).toBe(0);
  });

  test("a click selects one clip, Shift-click adds one, and Esc clears them", () => {
    const ui = createUiStore(storyStore().store);
    const { selectClip, addToSelection, clearSelection } = ui.getState();

    selectClip("a");
    addToSelection("b");
    addToSelection("b");
    expect(ui.getState().selection).toEqual(["a", "b"]);
    selectClip("m");
    expect(ui.getState().selection).toEqual(["m"]);
    clearSelection();
    expect(ui.getState().selection).toEqual([]);
  });

  test("zooms, scrolls, toggles snapping and picks the active track", () => {
    const ui = createUiStore(storyStore().store);
    const { setZoom, setScrollX, toggleSnapping, setActiveTrack } = ui.getState();

    setZoom(24);
    setScrollX(-10);
    toggleSnapping();
    setActiveTrack("V2");
    expect(ui.getState()).toMatchObject({
      pxPerFrame: 24,
      scrollX: 0,
      snapping: false,
      activeTrackId: "V2",
    });
    setScrollX(480);
    toggleSnapping();
    expect(ui.getState()).toMatchObject({ scrollX: 480, snapping: true });
  });

  test("never enters the document's history", () => {
    const { store, edit, history } = storyStore();
    const ui = createUiStore(store);

    edit.trimEnd({ clipId: "b", end: 150 });
    ui.getState().setPlayhead(150);
    ui.getState().selectClip("b");
    ui.getState().setZoom(8);
    ui.getState().toggleSnapping();
    expect(history().pastStates).toHaveLength(1);

    edit.undo();
    expect(findClip(store.getState().project, "b")?.clip.duration).toBe(72);
    expect(ui.getState()).toMatchObject({
      playhead: 150,
      selection: ["b"],
      pxPerFrame: 8,
      snapping: false,
    });
  });

  test("drops selected clips that an edit, an undo or a load takes away", () => {
    const { store, edit } = storyStore();
    const ui = createUiStore(store);
    const selection = () => ui.getState().selection;

    // Select b and the right half of a split, then undo the split: the right half is gone.
    ui.getState().selectClip("b");
    const halves = edit.split({ clipId: "b", at: 120 });
    if (!halves.ok) throw new Error(halves.error.message);
    ui.getState().addToSelection(halves.rightClipId);
    edit.undo();
    expect(selection()).toEqual(["b"]);

    // So deleting the selection works, instead of failing on a clip that isn't there.
    expect(edit.deleteClips({ clipIds: selection() }).ok).toBe(true);
    expect(selection()).toEqual([]);

    ui.getState().selectClip("a");
    edit.loadProject(createDocumentStore().getState().project);
    expect(selection()).toEqual([]);
  });

  test("keeps the selection when its clips are still there", () => {
    const { store, edit } = storyStore();
    const ui = createUiStore(store);
    ui.getState().selectClip("a");
    ui.getState().addToSelection("b");
    const before = ui.getState().selection;

    edit.trimEnd({ clipId: "b", end: 150 });
    edit.undo();

    expect(ui.getState().selection).toBe(before);
  });
});

describe("the UI store's view of the tracks", () => {
  // The story's cut is 1,080 frames long, the music's 45 s; b ends at 168. At 1,440 px, the
  // design's tracks are 1,352 px wide.
  const WIDTH = 1_352;

  function measuredStore() {
    const { store, edit } = storyStore();
    const ui = createUiStore(store);
    ui.getState().setViewportWidth(WIDTH);
    return { ui, edit, view: () => ui.getState() };
  }

  test("zooms freely and scrolls past the end until the tracks are measured", () => {
    const ui = createUiStore(storyStore().store);

    ui.getState().setZoom(100);
    ui.getState().setScrollX(1e6);
    expect(ui.getState()).toMatchObject({ viewportWidth: 0, pxPerFrame: 100, scrollX: 1e6 });
  });

  test("keeps the zoom between fitting the whole cut and 48 px per frame", () => {
    const { ui, view } = measuredStore();
    const fit = fitZoom(1_080, 24, WIDTH);

    ui.getState().setZoom(100);
    expect(view().pxPerFrame).toBe(MAX_PX_PER_FRAME);
    ui.getState().setZoom(0.1);
    expect(view().pxPerFrame).toBe(fit);
  });

  test("zooms around a point: the frame under the pointer stays under it", () => {
    const { ui, view } = measuredStore();
    ui.getState().setScrollX(300);
    const before = positionAt(624, view());

    ui.getState().zoomBy(4, 624);
    expect(view().pxPerFrame).toBe(8);
    expect(positionAt(624, view())).toBeCloseTo(before, 9);

    ui.getState().setZoom(2, 624);
    expect(view()).toMatchObject({ pxPerFrame: 2, scrollX: 300 });
  });

  test("zooming in or out stops at the ends of the range, and never turns around", () => {
    const { ui, view } = measuredStore();

    ui.getState().setZoom(40);
    ui.getState().zoomBy(2, 0);
    expect(view().pxPerFrame).toBe(MAX_PX_PER_FRAME);

    // Below the range (the cut grew shorter after the zoom was set), zooming out does nothing.
    ui.setState({ pxPerFrame: 0.5 });
    ui.getState().zoomBy(1 / Math.SQRT2, 0);
    expect(view().pxPerFrame).toBe(0.5);
    ui.getState().zoomBy(Math.SQRT2, 0);
    expect(view().pxPerFrame).toBe(fitZoom(1_080, 24, WIDTH));
  });

  test("fit shows the whole cut from its start", () => {
    const { ui, view } = measuredStore();
    ui.getState().setScrollX(400);

    ui.getState().zoomToFit();
    expect(view()).toMatchObject({ pxPerFrame: fitZoom(1_080, 24, WIDTH), scrollX: 0 });
  });

  test("scrolls from the start to where the cut's end, plus room, meets the right edge", () => {
    const { ui, view } = measuredStore();
    const maxScroll = 1_080 * 2 + END_PADDING_PX - WIDTH;

    ui.getState().setScrollX(-20);
    expect(view().scrollX).toBe(0);
    ui.getState().setScrollX(5_000);
    expect(view().scrollX).toBe(maxScroll);
  });

  test("pulls the scroll back when the cut gets shorter or the tracks wider", () => {
    const { ui, edit, view } = measuredStore();
    ui.getState().setScrollX(5_000);

    // Without the music, the cut ends with b at frame 168: 336 px fits in the view.
    edit.deleteClips({ clipIds: ["m"] });
    expect(view().scrollX).toBe(0);
    edit.undo();
    ui.getState().setScrollX(5_000);
    ui.getState().setViewportWidth(2_000);
    expect(view().scrollX).toBe(1_080 * 2 + END_PADDING_PX - 2_000);
  });

  test("never changes the zoom on its own when the cut changes", () => {
    const { ui, edit, view } = measuredStore();

    edit.deleteClips({ clipIds: ["m"] });
    expect(view().pxPerFrame).toBe(2);
    ui.getState().setViewportWidth(600);
    expect(view().pxPerFrame).toBe(2);
  });
});
