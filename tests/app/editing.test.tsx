import { act, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { useDocumentStore, useUiStore } from "../../src/engine/store.ts";
import {
  clipBox,
  clipButton,
  clipsNamed,
  clipsOn,
  messages,
  placed,
  renderEditor,
  ROW_Y,
  selectedIds,
  undoSteps,
} from "./editor.tsx";

// The placeholder robot story at 24 fps and 2 px per frame: shot n (from 0) sits on V1 at frame
// 72 n, so at x = 144 n, and 15-wide, the last, at 1,008 (x 2,016). Clicking at y 144 is on V1.

/** Presses at one point, moves in steps to another, and lets go (unless told to hold on). */
async function drag(
  user: UserEvent,
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { steps = 6, release = true } = {},
) {
  await user.pointer({
    keys: "[MouseLeft>]",
    target,
    coords: { clientX: from.x, clientY: from.y },
  });
  for (let step = 1; step <= steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    await user.pointer({ coords: { clientX: x, clientY: y } });
  }
  if (release) await user.pointer({ keys: "[/MouseLeft]" });
}

function handle(clip: HTMLElement, edge: "start" | "end"): Element {
  const found = clip.parentElement?.querySelector(`[data-edge="${edge}"]`);
  if (!found) throw new Error(`No ${edge} handle`);
  return found;
}

describe("dragging a clip", () => {
  test("moves it, and only on release does the document change: one undo step", async () => {
    const { user } = renderEditor();
    const before = useDocumentStore.getState().project;

    // 15-wide is last on V1, so it can go right: 40 px is 20 frames.
    await drag(
      user,
      clipButton("15-wide"),
      { x: 2_030, y: ROW_Y.V1 },
      { x: 2_070, y: ROW_Y.V1 },
      {
        release: false,
      },
    );
    // Mid-drag the clip is moved by a transform; the document is untouched.
    expect(clipBox("15-wide").style.transform).toBe("translate3d(40px, -4px, 0)");
    expect(useDocumentStore.getState().project).toBe(before);
    expect(screen.getByText("00:00:42:20 · +20 f")).toBeDefined();

    await user.pointer({ keys: "[/MouseLeft]" });
    expect(placed("15-wide")).toMatchObject({ trackId: "V1", start: 1_028 });
    expect(clipButton("15-wide").getAttribute("aria-label")).toContain("starts 00:00:42:20");
    expect(undoSteps()).toBe(1);
    expect(screen.getByText("Undo: move 15-wide")).toBeDefined();
  });

  test("stops at its neighbors' edges", async () => {
    const { user } = renderEditor();

    // 15-wide can't go left: 14-medium ends where it starts.
    await drag(user, clipButton("15-wide"), { x: 2_030, y: ROW_Y.V1 }, { x: 1_900, y: ROW_Y.V1 });
    expect(placed("15-wide")).toMatchObject({ start: 1_008 });
    expect(undoSteps()).toBe(0);
  });

  test("snaps to a clip's edge on another track, and doesn't with Alt held", async () => {
    const { user } = renderEditor();

    // Up to V2, its start 3 frames after 06-tracking's start (360): it snaps to 360.
    const from = { x: 2_030, y: ROW_Y.V1 };
    const to = { x: from.x - (1_008 - 363) * 2, y: ROW_Y.V2 };
    await drag(user, clipButton("15-wide"), from, to, { release: false });
    expect(document.querySelector("[data-snap-line]")?.getAttribute("data-snap-line")).toBe("360");
    await user.pointer({ keys: "[/MouseLeft]" });
    expect(placed("15-wide")).toEqual({ trackId: "V2", start: 360, in: 0, duration: 72 });

    await user.keyboard("{Control>}z{/Control}");
    expect(placed("15-wide")).toMatchObject({ trackId: "V1", start: 1_008 });
    await user.keyboard("{Alt>}");
    await drag(user, clipButton("15-wide"), from, to, { release: false });
    expect(document.querySelector("[data-snap-line]")).toBeNull();
    await user.pointer({ keys: "[/MouseLeft]" });
    await user.keyboard("{/Alt}");
    expect(placed("15-wide")).toMatchObject({ trackId: "V2", start: 363 });
  });

  test("N turns snapping off and on", async () => {
    const { user } = renderEditor();
    const snapping = screen.getByRole("button", { name: "Snapping" });

    expect(snapping.getAttribute("aria-pressed")).toBe("true");
    await user.keyboard("n");
    expect(snapping.getAttribute("aria-pressed")).toBe("false");
    expect(snapping.textContent).toContain("Snapping off");
    await user.keyboard("n");
    expect(useUiStore.getState().snapping).toBe(true);
  });

  test("Esc mid-drag puts the clip back and writes nothing", async () => {
    const { user } = renderEditor();

    await drag(
      user,
      clipButton("15-wide"),
      { x: 2_030, y: ROW_Y.V1 },
      { x: 2_090, y: ROW_Y.V1 },
      {
        release: false,
      },
    );
    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[/MouseLeft]" });
    expect(placed("15-wide")).toMatchObject({ start: 1_008 });
    expect(undoSteps()).toBe(0);
  });
});

describe("a drag that loses its release", () => {
  test("ends at the next move without the button, writes nothing, and frees the keys", async () => {
    const { user } = renderEditor();

    await drag(
      user,
      clipButton("15-wide"),
      { x: 2_030, y: ROW_Y.V1 },
      { x: 2_070, y: ROW_Y.V1 },
      {
        release: false,
      },
    );
    // The button comes up where the page can't hear it, such as over a context menu.
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 1, buttons: 0, clientX: 2_080 }),
      );
    });
    expect(clipBox("15-wide").style.transform).toBe("");
    // A later release, anywhere, changes nothing, and the keys work again.
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 2_080 }));
    });
    expect(placed("15-wide")).toMatchObject({ start: 1_008 });
    expect(undoSteps()).toBe(0);
    await user.keyboard("n");
    expect(useUiStore.getState().snapping).toBe(false);
  });

  test("ends when the window loses focus", async () => {
    const { user } = renderEditor();

    await drag(
      user,
      clipButton("15-wide"),
      { x: 2_030, y: ROW_Y.V1 },
      { x: 2_070, y: ROW_Y.V1 },
      {
        release: false,
      },
    );
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(clipBox("15-wide").style.transform).toBe("");
    await user.pointer({ keys: "[/MouseLeft]" });
    expect(placed("15-wide")).toMatchObject({ start: 1_008 });
    expect(undoSteps()).toBe(0);
  });
});

describe("trimming", () => {
  test("an edge follows the pointer and stops at the end of the source", async () => {
    const { user } = renderEditor();
    const clip = clipButton("15-wide");

    // 15-wide uses the first 72 of its 120 frames: its end can go 48 frames further, no more.
    await drag(
      user,
      handle(clip, "end"),
      { x: 2_158, y: ROW_Y.V1 },
      { x: 2_300, y: ROW_Y.V1 },
      {
        release: false,
      },
    );
    expect(screen.getByText("Source ends · 00:00:05:00")).toBeDefined();
    await user.pointer({ keys: "[/MouseLeft]" });
    expect(placed("15-wide")).toMatchObject({ start: 1_008, duration: 120 });
    expect(undoSteps()).toBe(1);
  });

  test("an edge stops at a neighbor, and the start shows its new in point", async () => {
    const { user } = renderEditor();

    // 08-closeup's end can't pass 09-cutaway, which starts where it ends.
    await drag(
      user,
      handle(clipButton("08-closeup"), "end"),
      { x: 1_150, y: ROW_Y.V1 },
      {
        x: 1_250,
        y: ROW_Y.V1,
      },
    );
    expect(placed("08-closeup")).toMatchObject({ start: 504, duration: 72 });
    expect(undoSteps()).toBe(0);

    // Its start moves right by 12 frames: in 00:00:00:12.
    await drag(
      user,
      handle(clipButton("08-closeup"), "start"),
      { x: 1_010, y: ROW_Y.V1 },
      {
        x: 1_034,
        y: ROW_Y.V1,
      },
      { release: false },
    );
    expect(screen.getByText("In 00:00:00:12")).toBeDefined();
    await user.pointer({ keys: "[/MouseLeft]" });
    expect(placed("08-closeup")).toEqual({ trackId: "V1", start: 516, in: 12, duration: 60 });
  });

  test("a click on a clip's edge selects it and trims nothing, even next to a snap point", async () => {
    const { user } = renderEditor();

    // Room after 05-wide, and the playhead 2 frames past its end: within snapping distance.
    await user.click(clipButton("06-tracking"));
    await user.keyboard("{Delete}");
    act(() => {
      useUiStore.getState().setPlayhead(362);
    });
    const steps = undoSteps();
    await user.pointer({
      keys: "[MouseLeft]",
      target: handle(clipButton("05-wide"), "end"),
      coords: { clientX: 718, clientY: ROW_Y.V1 },
    });
    expect(placed("05-wide")).toMatchObject({ start: 288, duration: 72 });
    expect(undoSteps()).toBe(steps);
    expect(selectedIds()).toEqual(["05-wide"]);
  });

  test("a trim that makes a clip too narrow for handles keeps the one it holds", async () => {
    const { user } = renderEditor();

    // 65 frames off 15-wide's 72 leaves 7: 14 px, too narrow to draw handles at rest.
    await drag(
      user,
      handle(clipButton("15-wide"), "end"),
      { x: 2_158, y: ROW_Y.V1 },
      {
        x: 2_028,
        y: ROW_Y.V1,
      },
      { release: false },
    );
    expect(clipBox("15-wide").querySelector('[data-edge="end"]')).not.toBeNull();
    await user.pointer({ keys: "[/MouseLeft]" });
    expect(placed("15-wide")).toMatchObject({ start: 1_008, duration: 7 });
    expect(clipBox("15-wide").querySelector('[data-edge="end"]')).toBeNull();
  });

  test("[ and ] trim the selected clip to the playhead", async () => {
    const { user } = renderEditor();

    await user.click(clipButton("03-closeup"));
    act(() => {
      useUiStore.getState().setPlayhead(150);
    });
    await user.keyboard("[[");
    expect(placed("03-closeup")).toEqual({ trackId: "V1", start: 150, in: 6, duration: 66 });
    act(() => {
      useUiStore.getState().setPlayhead(200);
    });
    await user.keyboard("]");
    expect(placed("03-closeup")).toEqual({ trackId: "V1", start: 150, in: 6, duration: 50 });
    expect(undoSteps()).toBe(2);
  });

  test("[ says why when the trim isn't possible", async () => {
    const { user } = renderEditor();

    // 03-closeup starts at 144 with in 0: there's no earlier source to trim back to.
    await user.click(clipButton("03-closeup"));
    act(() => {
      useUiStore.getState().setPlayhead(100);
    });
    await user.keyboard("[[");
    expect(messages().textContent).toContain("That's before the start of 03-closeup.");
    expect(placed("03-closeup")).toMatchObject({ start: 144 });
  });
});

describe("splitting", () => {
  test("S splits the selected clip at the playhead; undo gives one clip back, redo splits again", async () => {
    const { user } = renderEditor();

    await user.click(clipButton("07-medium"));
    act(() => {
      useUiStore.getState().setPlayhead(456);
    });
    await user.keyboard("s");
    const halves = clipsNamed("07-medium");
    expect(halves).toHaveLength(2);
    expect(clipsOn("V1")).toBe(16);
    // The right half is selected, as drawn.
    const right = halves.find((half) =>
      half.getAttribute("aria-label")?.includes("starts 00:00:19:00"),
    );
    expect(right?.getAttribute("aria-pressed")).toBe("true");

    await user.keyboard("{Control>}z{/Control}");
    expect(clipsNamed("07-medium")).toHaveLength(1);
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(clipsNamed("07-medium")).toHaveLength(2);
  });

  test("with nothing selected, S splits the clip under the playhead on the active track", async () => {
    const { user } = renderEditor();

    act(() => {
      useUiStore.getState().setPlayhead(100);
    });
    await user.keyboard("s");
    expect(clipsNamed("02-medium")).toHaveLength(2);
  });

  test("the inspector's Split button does what S does", async () => {
    const { user } = renderEditor();

    await user.click(clipButton("07-medium"));
    act(() => {
      useUiStore.getState().setPlayhead(456);
    });
    await user.click(screen.getByRole("button", { name: "Split" }));
    expect(clipsNamed("07-medium")).toHaveLength(2);
  });
});

describe("selection", () => {
  test("a click selects a clip, Shift-click adds one, Esc clears them", async () => {
    const { user } = renderEditor();

    await user.click(clipButton("01-wide"));
    expect(selectedIds()).toEqual(["01-wide"]);
    await user.keyboard("{Shift>}");
    await user.click(clipButton("02-medium"));
    await user.keyboard("{/Shift}");
    expect(selectedIds()).toEqual(["01-wide", "02-medium"]);
    expect(screen.getByRole("heading", { name: "2 clips selected" })).toBeDefined();
    await user.keyboard("{Escape}");
    expect(selectedIds()).toEqual([]);
  });

  test("a click on an empty part of a track selects nothing and makes that track active", async () => {
    const { user } = renderEditor();

    await user.click(clipButton("01-wide"));
    const v2 = document.querySelector('[data-track-id="V2"]');
    if (!v2) throw new Error("No V2 row");
    await user.pointer({
      keys: "[MouseLeft]",
      target: v2,
      coords: { clientX: 300, clientY: ROW_Y.V2 },
    });
    expect(selectedIds()).toEqual([]);
    expect(useUiStore.getState().activeTrackId).toBe("V2");
  });

  test("Enter on a focused clip selects it", async () => {
    const { user } = renderEditor();

    clipButton("04-insert").focus();
    await user.keyboard("{Enter}");
    expect(selectedIds()).toEqual(["04-insert"]);
  });
});

describe("deleting", () => {
  test("Delete removes the selection, and the toast's Undo brings it back", async () => {
    const { user } = renderEditor();

    await user.click(clipButton("01-wide"));
    await user.keyboard("{Shift>}");
    await user.click(clipButton("02-medium"));
    await user.click(clipButton("03-closeup"));
    await user.keyboard("{/Shift}{Delete}");
    expect(clipsOn("V1")).toBe(12);
    const toast = messages();
    expect(toast.textContent).toContain("Deleted 3 clips.");

    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(clipsOn("V1")).toBe(15);
    expect(messages().textContent).toBe("");
  });

  test("the toast stops offering Undo once another edit happens", async () => {
    const { user } = renderEditor();

    await user.click(clipButton("15-wide"));
    await user.keyboard("{Backspace}");
    expect(messages().textContent).toContain("Deleted 15-wide.");
    await user.click(clipButton("01-wide"));
    act(() => {
      useUiStore.getState().setPlayhead(30);
    });
    await user.keyboard("s");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("the keyboard map", () => {
  test("leaves keys alone while a text field has focus", async () => {
    const { user } = renderEditor();

    // With the playhead inside 07-medium, S and [ would both change it if they fired.
    await user.click(clipButton("07-medium"));
    act(() => {
      useUiStore.getState().setPlayhead(456);
    });
    await user.click(screen.getByRole("textbox", { name: "Playhead" }));
    await user.keyboard("s[[{Backspace}");
    expect(clipsOn("V1")).toBe(15);
    expect(placed("07-medium")).toMatchObject({ start: 432, duration: 72 });
  });
});
