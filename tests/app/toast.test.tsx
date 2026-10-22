import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { deleteSelection } from "../../src/app/actions.ts";
import { useUiStore } from "../../src/engine/store.ts";
import { messages, renderEditor } from "./editor.tsx";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

const message = () => messages().textContent;
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

test("the toast stays 6 s, and waits while the pointer is over it", () => {
  renderEditor();
  act(() => {
    useUiStore.getState().selectClip("15-wide");
    deleteSelection();
  });
  expect(message()).toContain("Deleted 15-wide.");

  wait(5_000);
  const toast = screen.getByText("Deleted 15-wide.").parentElement;
  if (!toast) throw new Error("No toast");
  fireEvent.pointerEnter(toast);
  wait(20_000);
  expect(message()).toContain("Deleted 15-wide.");

  // A second left after the pointer leaves.
  fireEvent.pointerLeave(toast);
  wait(999);
  expect(message()).toContain("Deleted 15-wide.");
  wait(2);
  expect(message()).toBe("");
});

test("the toast waits while focus is in it", () => {
  renderEditor();
  act(() => {
    useUiStore.getState().selectClip("15-wide");
    deleteSelection();
  });
  const undo = screen.getByRole("button", { name: "Undo" });

  act(() => {
    undo.focus();
  });
  wait(10_000);
  expect(message()).toContain("Deleted 15-wide.");
  act(() => {
    undo.blur();
  });
  wait(6_001);
  expect(message()).toBe("");
});
