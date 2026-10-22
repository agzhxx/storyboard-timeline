// Editing with the keyboard alone (spec section 2): Tab to a clip, Enter selects it, its trim
// handles follow it as W3C sliders, ⌥ and the arrows nudge it, and a run of presses is one undo
// step. The robot story at 24 fps: 07-medium is on V1 from 00:00:18:00 (frame 432) to 00:00:21:00
// (504), between 06-tracking and 08-closeup, with the first 3 s of its 5 s source.

import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { handOverHandleFocus } from "../../src/app/actions.ts";
import { announceEdits, useAnnouncer } from "../../src/app/announcer.ts";
import { useDocumentStore, useUiStore } from "../../src/engine/store.ts";
import { useGestureStore } from "../../src/timeline/gestures.ts";
import { clipBox, clipButton, placed, renderEditor, selectedIds, undoSteps } from "./editor.tsx";

function sliders(name: string): HTMLElement[] {
  return within(clipBox(name)).queryAllByRole("slider");
}

function slider(name: string, edge: "Start" | "End"): HTMLElement {
  return within(clipBox(name)).getByRole("slider", { name: `${edge} of ${name}` });
}

function aria(element: HTMLElement) {
  return {
    now: element.getAttribute("aria-valuenow"),
    min: element.getAttribute("aria-valuemin"),
    max: element.getAttribute("aria-valuemax"),
    text: element.getAttribute("aria-valuetext"),
  };
}

/** Tabs to a clip and selects it with Enter, as a keyboard user does. */
async function selectWithKeyboard(user: ReturnType<typeof renderEditor>["user"], name: string) {
  act(() => {
    clipButton(name).focus();
  });
  await user.keyboard("{Enter}");
}

let stopAnnouncing: () => void = () => undefined;
let stopHandingOver: () => void = () => undefined;

beforeEach(() => {
  stopAnnouncing = announceEdits();
  stopHandingOver = handOverHandleFocus();
});

afterEach(() => {
  stopAnnouncing();
  stopHandingOver();
});

describe("the trim handles as sliders", () => {
  test("are sliders only while their clip is the one selected", async () => {
    const { user } = renderEditor();
    expect(sliders("07-medium")).toEqual([]);

    await selectWithKeyboard(user, "07-medium");
    expect(selectedIds()).toEqual(["07-medium"]);
    expect(sliders("07-medium").map((handle) => handle.getAttribute("aria-label"))).toEqual([
      "Start of 07-medium",
      "End of 07-medium",
    ]);

    act(() => {
      useUiStore.getState().addToSelection("08-closeup");
    });
    expect(sliders("07-medium")).toEqual([]);
  });

  test("give the focus back to their clip when they stop being sliders", async () => {
    const { user } = renderEditor();
    await selectWithKeyboard(user, "07-medium");
    await user.tab();
    expect(document.activeElement).toBe(slider("07-medium", "Start"));
    await user.keyboard("{Escape}");
    expect(selectedIds()).toEqual([]);
    expect(document.activeElement).toBe(clipButton("07-medium"));

    await user.keyboard("{Enter}");
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(slider("07-medium", "End"));
    act(() => {
      useUiStore.getState().addToSelection("08-closeup");
    });
    expect(document.activeElement).toBe(clipButton("07-medium"));
  });

  test("keep the focus through a drag, which makes them plain targets only while it lasts", async () => {
    const { user } = renderEditor();
    await selectWithKeyboard(user, "07-medium");
    await user.tab();
    const start = slider("07-medium", "Start");
    const trim = { kind: "trim", clipId: "07-medium", edge: "start" } as const;
    act(() => {
      useGestureStore.setState({
        gesture: { ...trim, start: 440, duration: 64, limit: null, snapAt: null },
      });
    });
    expect(document.activeElement).toBe(start);
    act(() => {
      useGestureStore.setState({ gesture: null });
    });
    expect(document.activeElement).toBe(slider("07-medium", "Start"));
  });

  test("follow their clip in the Tab order, before the next clip", async () => {
    const { user } = renderEditor();
    await selectWithKeyboard(user, "07-medium");
    await user.tab();
    expect(document.activeElement).toBe(slider("07-medium", "Start"));
    await user.tab();
    expect(document.activeElement).toBe(slider("07-medium", "End"));
    await user.tab();
    expect(document.activeElement).toBe(clipButton("08-closeup"));
  });

  test("give the edge's frame, its range, and a timecode that says what holds it", async () => {
    const { user } = renderEditor();
    await selectWithKeyboard(user, "07-medium");
    expect(aria(slider("07-medium", "Start"))).toEqual({
      now: "432",
      min: "432",
      max: "503",
      text: "00:00:18:00, the start of its source",
    });
    expect(aria(slider("07-medium", "End"))).toEqual({
      now: "504",
      min: "433",
      max: "504",
      text: "00:00:21:00, against 08-closeup",
    });
    expect(slider("07-medium", "End").getAttribute("aria-orientation")).toBe("horizontal");
  });

  test("← and → trim a frame, ⇧ a second, Home and End as far as the edge goes", async () => {
    const { user } = renderEditor();
    await selectWithKeyboard(user, "07-medium");
    await user.tab();
    const start = slider("07-medium", "Start");
    expect(document.activeElement).toBe(start);

    // Already at the source's start: ← changes nothing.
    await user.keyboard("{ArrowLeft}");
    expect(placed("07-medium")).toMatchObject({ start: 432, in: 0, duration: 72 });
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(placed("07-medium")).toMatchObject({ start: 434, in: 2, duration: 70 });
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(placed("07-medium")).toMatchObject({ start: 458, in: 26, duration: 46 });
    expect(aria(start).text).toBe("00:00:19:02");
    // One frame is 2 px, too narrow to draw handles, but the focused one stays.
    await user.keyboard("{End}");
    expect(placed("07-medium")).toMatchObject({ start: 503, duration: 1 });
    expect(document.activeElement).toBe(start);
    expect(aria(start).text).toBe("00:00:20:23, one frame long");
    await user.keyboard("{Home}");
    expect(placed("07-medium")).toMatchObject({ start: 432, in: 0, duration: 72 });
    // The arrows trimmed the clip: the playhead didn't move.
    expect(useUiStore.getState().playhead).toBe(0);
  });

  test("a run of presses is one undo step, said once as an edit", async () => {
    const { user } = renderEditor();
    await selectWithKeyboard(user, "07-medium");
    const end = slider("07-medium", "End");
    act(() => {
      end.focus();
    });
    const steps = undoSteps();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowDown}");
    expect(placed("07-medium")).toMatchObject({ start: 432, duration: 68 });
    expect(undoSteps()).toBe(steps + 1);
    await waitFor(() => {
      expect(useAnnouncer.getState().text).toBe("Trimmed the end of 07-medium.");
    });

    await user.keyboard("{Meta>}z{/Meta}");
    expect(placed("07-medium")).toMatchObject({ start: 432, duration: 72 });
    await waitFor(() => {
      expect(useAnnouncer.getState().text).toBe("Undid trim end of 07-medium.");
    });
  });

  test("stop at the next clip and the source's end, as a drag does", async () => {
    const { user } = renderEditor();
    act(() => {
      useDocumentStore.getState().deleteClips({ clipIds: ["08-closeup"] });
    });
    await selectWithKeyboard(user, "07-medium");
    const end = slider("07-medium", "End");
    act(() => {
      end.focus();
    });
    // 08-closeup gone, the end can go to the source's: 432 + 120 frames.
    await user.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}");
    expect(placed("07-medium")).toMatchObject({ duration: 120 });
    expect(aria(end).text).toBe("00:00:23:00, the end of its source");
  });
});

describe("nudging the selected clip", () => {
  test("⌥ and the arrows move it a frame, ⇧ a second, stopping at its neighbors", async () => {
    const { user } = renderEditor();
    act(() => {
      useDocumentStore.getState().deleteClips({ clipIds: ["08-closeup"] });
    });
    await selectWithKeyboard(user, "07-medium");
    const steps = undoSteps();

    // 06-tracking ends where 07-medium starts: it can't go left.
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(placed("07-medium")).toMatchObject({ start: 432 });
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(placed("07-medium")).toMatchObject({ start: 433 });
    // 09-cutaway starts at 576: 07-medium's 72 frames stop at 504.
    await user.keyboard(
      "{Alt>}{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}{/Alt}",
    );
    expect(placed("07-medium")).toMatchObject({ start: 504 });
    expect(undoSteps()).toBe(steps + 1);
    // The arrows nudged: the playhead stayed.
    expect(useUiStore.getState().playhead).toBe(0);
  });

  test("works from a focused trim handle too", async () => {
    const { user } = renderEditor();
    act(() => {
      useDocumentStore.getState().deleteClips({ clipIds: ["08-closeup"] });
    });
    await selectWithKeyboard(user, "07-medium");
    await user.tab();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(placed("07-medium")).toMatchObject({ start: 433, duration: 72 });
  });

  test("with nothing selected, or several clips, says why it doesn't", async () => {
    const { user } = renderEditor();
    act(() => {
      clipButton("07-medium").focus();
    });
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(screen.getByRole("region", { name: "Messages" }).textContent).toContain(
      "Select a clip to nudge it.",
    );
    act(() => {
      useUiStore.getState().selectClip("07-medium");
      useUiStore.getState().addToSelection("09-cutaway");
    });
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(screen.getByRole("region", { name: "Messages" }).textContent).toContain(
      "Nudging works on one clip at a time.",
    );
  });
});

describe("keyboard focus follows an edit", () => {
  test("S on a focused clip moves focus to the right half, which is selected", async () => {
    const { user } = renderEditor();
    await selectWithKeyboard(user, "07-medium");
    act(() => {
      useUiStore.getState().setPlayhead(450);
    });
    await user.keyboard("s");
    const [rightId] = selectedIds();
    await waitFor(() => {
      expect(document.activeElement?.closest("[data-clip-id]")?.getAttribute("data-clip-id")).toBe(
        rightId,
      );
    });
  });

  test("Delete on a focused clip moves focus to the clip after it", async () => {
    const { user } = renderEditor();
    await selectWithKeyboard(user, "07-medium");
    await user.keyboard("{Delete}");
    await waitFor(() => {
      expect(document.activeElement).toBe(clipButton("08-closeup"));
    });
  });
});

test("? opens the keyboard shortcuts", async () => {
  const { user } = renderEditor();
  await user.keyboard("?");
  expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
});
