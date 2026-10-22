// `?demo=story`, the Feed's "Open in Timeline": the story loads into an empty project; a cut that's
// already there stays, and a toast offers New project; the parameter leaves the address either way.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { followDemoLink, KEEPS_YOUR_CUT } from "../../src/app/demo-link.ts";
import { useToastStore } from "../../src/app/toast-store.ts";
import { createProject } from "../../src/engine/project.ts";
import { useDocumentStore } from "../../src/engine/store.ts";
import { testStory } from "./story.ts";

const fakes = vi.hoisted(() => ({ loadRobotStory: vi.fn(), openNewProject: vi.fn() }));

vi.mock("../../src/app/story-loader.ts", () => ({ loadRobotStory: fakes.loadRobotStory }));
vi.mock("../../src/app/dialogs.ts", () => ({ openNewProject: fakes.openNewProject }));

/** The page's address, and the history entry it's replaced with. */
function page(href: string) {
  const history = { state: { kept: true }, replaceState: vi.fn<History["replaceState"]>() };
  return { location: { href }, history };
}

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toast: null });
  useDocumentStore.getState().loadProject(createProject({ id: "empty" }));
});

describe("?demo=story", () => {
  test("loads the robot story into an empty project, and leaves the address", () => {
    const { location, history } = page("https://timeline.example/?demo=story&perf=1#top");
    followDemoLink(location, history);
    expect(fakes.loadRobotStory).toHaveBeenCalledTimes(1);
    // The history entry is kept, with the address less the parameter.
    expect(history.replaceState).toHaveBeenCalledWith({ kept: true }, "", expect.any(URL));
    expect(String(history.replaceState.mock.calls[0]?.[2])).toBe(
      "https://timeline.example/?perf=1#top",
    );
    expect(useToastStore.getState().toast).toBeNull();
  });

  test("keeps a cut that's there, and offers New project", () => {
    useDocumentStore.getState().loadProject(testStory());
    const { location, history } = page("https://timeline.example/?demo=story");
    followDemoLink(location, history);
    expect(fakes.loadRobotStory).not.toHaveBeenCalled();
    expect(String(history.replaceState.mock.calls[0]?.[2])).toBe("https://timeline.example/");
    const toast = useToastStore.getState().toast;
    expect(toast?.message).toBe(KEEPS_YOUR_CUT);
    expect(toast?.action?.label).toBe("New project");
    toast?.action?.run();
    expect(fakes.openNewProject).toHaveBeenCalledTimes(1);
  });

  test("does nothing without it, or with another demo", () => {
    for (const href of ["https://timeline.example/", "https://timeline.example/?demo=other"]) {
      const { location, history } = page(href);
      followDemoLink(location, history);
      expect(history.replaceState).not.toHaveBeenCalled();
    }
    expect(fakes.loadRobotStory).not.toHaveBeenCalled();
    expect(useToastStore.getState().toast).toBeNull();
  });
});
