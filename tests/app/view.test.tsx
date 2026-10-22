import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { addAtPlayhead } from "../../src/app/actions.ts";
import { useDocumentStore, useUiStore } from "../../src/engine/store.ts";
import { positionAt } from "../../src/engine/viewport.ts";
import { clipBox, placed, renderEditor, ROW_Y } from "./editor.tsx";

function lanes(): Element {
  const row = document.querySelector('[data-track-id="V1"]');
  if (!row?.parentElement) throw new Error("No tracks");
  return row.parentElement;
}

/** The monitor's timecode, which follows the playhead from requestAnimationFrame. */
async function expectTimecode(timecode: string) {
  await waitFor(() => {
    expect(screen.getByRole("timer", { name: "Playhead" }).textContent).toBe(timecode);
  });
}

describe("the playhead", () => {
  test("the arrow keys step one frame, Shift one second, Home and End to the ends", async () => {
    const { user } = renderEditor();

    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    await expectTimecode("00:00:00:03");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await expectTimecode("00:00:01:03");
    await user.keyboard("{ArrowLeft}");
    await expectTimecode("00:00:01:02");
    await user.keyboard("{End}");
    await expectTimecode("00:00:45:00");
    await user.keyboard("{ArrowRight}");
    expect(useUiStore.getState().playhead).toBe(1_080);
    await user.keyboard("{Home}{ArrowLeft}");
    await expectTimecode("00:00:00:00");
  });

  test("a press on the ruler jumps to the frame under the pointer, and a drag scrubs", async () => {
    const { user } = renderEditor();
    const ruler = lanes().querySelector(".cursor-pointer");
    if (!ruler) throw new Error("No ruler");

    // x 925 is in frame 462 at 2 px per frame: 00:00:19:06.
    await user.pointer({
      keys: "[MouseLeft>]",
      target: ruler,
      coords: { clientX: 925, clientY: ROW_Y.ruler },
    });
    await expectTimecode("00:00:19:06");
    await user.pointer({ coords: { clientX: 1_000, clientY: ROW_Y.ruler } });
    await user.pointer({ keys: "[/MouseLeft]" });
    await expectTimecode("00:00:20:20");
  });

  test("the monitor shows the clip on top at the playhead, V2 over V1", () => {
    renderEditor();

    act(() => {
      useUiStore.getState().setPlayhead(400);
    });
    expect(screen.getByRole("img", { name: "06-tracking at the playhead" })).toBeDefined();

    // Add 01-wide at the playhead: V1 is taken there, so it goes on V2 and covers 06-tracking.
    const wide = useDocumentStore.getState().project.assets["01-wide"];
    if (!wide) throw new Error("No 01-wide");
    act(() => {
      addAtPlayhead(wide);
    });
    expect(placed("01-wide")).toEqual({ trackId: "V2", start: 400, in: 0, duration: 120 });
    expect(screen.getByRole("img", { name: "01-wide at the playhead" })).toBeDefined();
  });
});

describe("the inspector", () => {
  test("a Feed clip: From the Feed with its model, the AI badge, and its source", () => {
    renderEditor();
    act(() => {
      useUiStore.getState().selectClip("07-medium");
    });
    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(within(inspector).getByRole("heading", { name: "07-medium" })).toBeDefined();
    expect(within(inspector).getByText("From the Feed · Kling 2.5 Pro").textContent).toBe(
      "From the Feed · Kling 2.5 Pro, AI-generated",
    );
    expect(within(inspector).getByText("AI")).toBeDefined();
    expect(within(inspector).getByText("1920 × 1080 · 24 fps · 5 s")).toBeDefined();
  });

  test("the demo music: it comes with the app, and its license is in the README", () => {
    renderEditor();
    act(() => {
      useUiStore.getState().selectClip("demo-music");
    });
    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(within(inspector).getByRole("heading", { name: "Demo music" })).toBeDefined();
    expect(within(inspector).getByText("Comes with the app · license in the README")).toBeDefined();
    expect(within(inspector).queryByText("AI")).toBeNull();
  });
});

describe("the inspector's playhead field", () => {
  test("Enter jumps to a timecode, shorthand too", async () => {
    const { user } = renderEditor();
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Playhead" });

    await user.click(field);
    expect(screen.getByText("Enter jumps there · Esc puts it back")).toBeDefined();
    await user.clear(field);
    await user.type(field, "00:00:20:1{Enter}");
    expect(useUiStore.getState().playhead).toBe(481);
    expect(field.value).toBe("00:00:20:01");
    await user.clear(field);
    await user.type(field, "19:06{Enter}");
    expect(useUiStore.getState().playhead).toBe(462);
  });

  test("a timecode that doesn't parse says how to write one, and Esc puts the time back", async () => {
    const { user } = renderEditor();
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Playhead" });

    await user.click(field);
    await user.clear(field);
    await user.type(field, "00:00:61:00{Enter}");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(
      "Use HH:MM:SS:FF. Seconds go up to 59, frames up to 23.",
    );
    expect(useUiStore.getState().playhead).toBe(0);

    await user.keyboard("{Escape}");
    expect(field.value).toBe("00:00:00:00");
    expect(field.getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("follows the playhead while it isn't being edited", async () => {
    const { user } = renderEditor();

    await user.keyboard("{End}");
    await waitFor(() => {
      const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Playhead" });
      expect(field.value).toBe("00:00:45:00");
    });
  });
});

describe("zoom and scroll", () => {
  test("Cmd/Ctrl + wheel zooms around the pointer: the frame under it stays put", () => {
    renderEditor();
    act(() => {
      useUiStore.getState().setScrollX(100);
    });
    const before = positionAt(600, useUiStore.getState());

    fireEvent.wheel(lanes(), { deltaY: -100, ctrlKey: true, clientX: 600, clientY: ROW_Y.V1 });
    const view = useUiStore.getState();
    expect(view.pxPerFrame).toBeCloseTo(2 * Math.SQRT2, 9);
    expect(positionAt(600, view)).toBeCloseTo(before, 9);
    // The clips are drawn at the new zoom: 02-medium starts at frame 72.
    expect(clipBox("02-medium").style.left).toBe(`${72 * view.pxPerFrame}px`);
  });

  test("the wheel scrolls the tracks", () => {
    renderEditor();

    fireEvent.wheel(lanes(), { deltaY: 120, clientX: 600, clientY: ROW_Y.V1 });
    expect(useUiStore.getState().scrollX).toBe(120);
    fireEvent.wheel(lanes(), { deltaX: -50, deltaY: 4, clientX: 600, clientY: ROW_Y.V1 });
    expect(useUiStore.getState().scrollX).toBe(70);
  });

  test("+ and − zoom around the pointer over the tracks", async () => {
    const { user } = renderEditor();

    await user.pointer({ target: lanes(), coords: { clientX: 400, clientY: ROW_Y.V1 } });
    const before = positionAt(400, useUiStore.getState());
    await user.keyboard("+");
    expect(useUiStore.getState().pxPerFrame).toBeCloseTo(2 * Math.SQRT2, 9);
    expect(positionAt(400, useUiStore.getState())).toBeCloseTo(before, 9);
    await user.keyboard("-");
    expect(useUiStore.getState().pxPerFrame).toBeCloseTo(2, 9);
  });

  test("Shift+Z and Fit show the whole cut, and the zoom stops at 48 px per frame", async () => {
    const { user } = renderEditor();
    act(() => {
      useUiStore.getState().setViewportWidth(1_352);
      useUiStore.getState().setScrollX(500);
    });

    await user.keyboard("{Shift>}Z{/Shift}");
    expect(useUiStore.getState()).toMatchObject({ pxPerFrame: (1_352 - 24) / 1_080, scrollX: 0 });
    expect(screen.getByRole("button", { name: "Zoom out" })).toHaveProperty("disabled", true);

    act(() => {
      useUiStore.getState().setZoom(40);
    });
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(useUiStore.getState().pxPerFrame).toBe(48);
    expect(screen.getByRole("button", { name: "Zoom in" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Fit" }));
    expect(useUiStore.getState().pxPerFrame).toBe((1_352 - 24) / 1_080);
  });

  test("the slider zooms on a log scale from fit to 48 px per frame", () => {
    renderEditor();
    act(() => {
      useUiStore.getState().setViewportWidth(1_352);
    });
    const slider = screen.getByRole("slider", { name: "Zoom" });

    fireEvent.change(slider, { target: { value: "1000" } });
    expect(useUiStore.getState().pxPerFrame).toBe(48);
    fireEvent.change(slider, { target: { value: "0" } });
    expect(useUiStore.getState().pxPerFrame).toBe((1_352 - 24) / 1_080);
    expect(slider.getAttribute("aria-valuetext")).toBe("1.2 pixels per frame");
  });
});
