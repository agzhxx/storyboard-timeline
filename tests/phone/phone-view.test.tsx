// The phone view (spec section 3.6; Phone board): read-only, under 768 px, its own chunk. The
// robot story at 24 fps plays on its monitor; with nothing saved, it offers the story.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Root } from "../../src/app/Root.tsx";
import { useSession } from "../../src/app/startup.ts";
import { createProject } from "../../src/engine/project.ts";
import { useDocumentStore, useUiStore } from "../../src/engine/store.ts";
import type { Project } from "../../src/engine/types.ts";
import PhoneView from "../../src/phone/PhoneView.tsx";
import { testStory } from "../app/story.ts";

vi.mock("../../src/media/decode-client.ts", async () => ({
  decodeWorker: (await import("../app/fake-decode.ts")).fakeDecode.worker,
}));

const story = vi.hoisted(() => ({ load: vi.fn(() => Promise.resolve()) }));

vi.mock("../../src/app/story-loader.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/story-loader.ts")>()),
  loadRobotStory: story.load,
}));

function show(project: Project) {
  useDocumentStore.getState().loadProject(project);
  useUiStore.setState({ playhead: 0, selection: [] });
  render(<PhoneView />);
}

beforeEach(() => {
  story.load.mockClear();
});

describe("the phone view", () => {
  test("shows the saved cut as the board draws it", () => {
    show(testStory());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Storyboard Timeline");
    expect(screen.getByText("The robot story")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(screen.getByText("of 00:00:45:00")).toBeTruthy();
    expect(screen.getByText("01-wide · clip 1 of 15")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Editing works best on a laptop" })).toBeTruthy();
    expect(screen.getByText("15 AI clips from the Generation Feed · Demo music")).toBeTruthy();
    expect(screen.getByText("Saved in this browser only.")).toBeTruthy();
    // Read-only: nothing on it edits.
    for (const name of ["New project", "Export", "Split", "Delete"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  test("names the clip at the playhead as it moves, and the timecode follows", async () => {
    show(testStory());
    act(() => {
      useUiStore.getState().setPlayhead(462);
    });
    expect(screen.getByText("07-medium · clip 7 of 15")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("timer", { name: "Playhead" }).textContent).toBe("00:00:19:06");
    });
  });

  test("with nothing saved, offers to play the robot story", async () => {
    show(createProject({ id: "empty" }));
    expect(screen.getByRole("button", { name: "Play" }).hasAttribute("disabled")).toBe(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "Play the robot story" }));
    expect(story.load).toHaveBeenCalledOnce();
  });
});

describe("under 768 px", () => {
  const narrow = (width: number) =>
    vi.fn((query: string) => ({
      matches: query === "(width < 768px)" && width < 768,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));

  afterEach(() => {
    vi.unstubAllGlobals();
    useSession.setState({ state: "starting" });
  });

  test("the page is the phone view instead of the editor", async () => {
    vi.stubGlobal("matchMedia", narrow(390));
    useDocumentStore.getState().loadProject(testStory());
    useSession.setState({ state: "editing" });
    render(<Root />);
    expect(await screen.findByText("Editing works best on a laptop")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Timeline" })).toBeNull();
  });

  test("from 768 px, the editor", () => {
    vi.stubGlobal("matchMedia", narrow(768));
    useDocumentStore.getState().loadProject(testStory());
    useSession.setState({ state: "editing" });
    render(<Root />);
    expect(within(document.body).getByRole("region", { name: "Timeline" })).toBeTruthy();
  });
});
