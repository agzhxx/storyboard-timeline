// "Load the robot story" (spec 4.10; Empty project and Messages boards), in the whole editor: the
// button says it's loading, then the story fills the bin, the tracks and the monitor; when the
// Feed, a clip's file or the music doesn't come, the board's toast says so, with Retry, and the
// project stays as it was. The Feed's API, the clips' facts and the music are faked.

import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { useDocumentStore } from "../../src/engine/store.ts";
import type { Asset } from "../../src/engine/types.ts";
import type * as FeedApi from "../../src/feed/feed-api.ts";
import type { FeedClip } from "../../src/feed/feed-clip.ts";
import { STORY_PROBLEMS } from "../../src/app/story-loader.ts";
import { FeedClipError } from "../../src/feed/feed-media.ts";
import { clipsOn, renderEmptyEditor } from "./editor.tsx";
import { storyClips } from "./story.ts";

const fakes = vi.hoisted(() => ({
  fetchWholeCollection: vi.fn<typeof FeedApi.fetchWholeCollection>(),
  assetFor: vi.fn<(item: FeedClip) => Promise<Asset>>(),
  music: vi.fn<() => Promise<{ duration: number } | null>>(),
}));

vi.mock("../../src/feed/load-feed-api.ts", () => ({
  loadFeedApi: () =>
    Promise.resolve({ fetchWholeCollection: fakes.fetchWholeCollection, fetchFeedPage: vi.fn() }),
}));
vi.mock("../../src/feed/feed-media.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/feed/feed-media.ts")>()),
  feedAssetFor: fakes.assetFor,
}));
vi.mock("../../src/media/audio.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/media/audio.ts")>()),
  musicOf: fakes.music,
}));

const loadButton = () => screen.getByRole("button", { name: /robot story/ });

/** Lets the story's requests answer and the editor render it. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

// Loading the story shows the Feed tab, whose clips are a chunk of their own (src/app/MediaBin.tsx):
// imported once up front, as a browser has it by then.
beforeAll(async () => {
  await import("../../src/app/FeedClips.tsx");
});

beforeEach(async () => {
  const { shotAsset } = await import("./story.ts");
  fakes.fetchWholeCollection.mockReset();
  fakes.fetchWholeCollection.mockResolvedValue({ ok: true, value: storyClips() });
  fakes.assetFor.mockReset();
  fakes.assetFor.mockImplementation((item) => Promise.resolve(shotAsset(item)));
  fakes.music.mockReset();
  fakes.music.mockResolvedValue({ duration: 46 });
});

describe("Load the robot story", () => {
  test("says it's loading, then fills the bin, the tracks and the monitor", async () => {
    let answer: (result: Awaited<ReturnType<typeof FeedApi.fetchWholeCollection>>) => void = () =>
      undefined;
    fakes.fetchWholeCollection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderEmptyEditor();
    expect(screen.getByRole("heading", { name: "Start a cut" })).toBeDefined();
    expect(
      screen.getByText(
        "Load the robot story: 15 AI clips from the Generation Feed and a music track. Or add your own files. Nothing is uploaded; it all stays in this browser.",
      ),
    ).toBeDefined();

    fireEvent.click(loadButton());
    await settle();
    expect(loadButton().textContent).toBe("Loading the robot story…");
    expect(loadButton().getAttribute("aria-disabled")).toBe("true");
    // A second press while it loads asks for nothing more.
    fireEvent.click(loadButton());
    expect(fakes.fetchWholeCollection).toHaveBeenCalledTimes(1);
    expect(fakes.fetchWholeCollection).toHaveBeenCalledWith("story", 50);

    act(() => {
      answer({ ok: true, value: storyClips() });
    });
    await settle();
    expect(screen.getByText("The robot story")).toBeDefined();
    expect(clipsOn("V1")).toBe(15);
    expect(clipsOn("A1")).toBe(1);
    expect(screen.getByText("15 clips and music ·", { exact: false })).toBeDefined();
    expect(screen.getByRole("img", { name: "01-wide at the playhead" })).toBeDefined();
    expect(fakes.assetFor).toHaveBeenCalledTimes(15);

    // The bin shows the story's clips, as the Main board draws it.
    const bin = screen.getByRole("region", { name: "Media bin" });
    expect(
      within(bin).getByRole("tab", { name: "From the Feed" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(within(bin).getByRole("combobox", { name: "Collection" })).toHaveProperty(
      "value",
      "story",
    );
    expect(within(bin).getAllByRole("button", { name: / Kling 2\.5 Pro$/ })).toHaveLength(15);
  });

  test("when the Feed doesn't answer, the board's toast says so; Retry loads it", async () => {
    fakes.fetchWholeCollection.mockResolvedValueOnce({ ok: false, failure: { reason: "network" } });
    renderEmptyEditor();

    fireEvent.click(loadButton());
    await settle();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Couldn't load the robot story")).toBeDefined();
    expect(
      within(alert).getByText("The Feed didn't answer. Check your connection and try again."),
    ).toBeDefined();
    expect(clipsOn("V1")).toBe(0);
    expect(loadButton().textContent).toBe("Load the robot story");

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(clipsOn("V1")).toBe(15);
  });

  test("a clip's file that doesn't answer fails it the same way", async () => {
    fakes.assetFor.mockRejectedValueOnce(new FeedClipError("Couldn't add 07-medium", true));
    renderEmptyEditor();

    fireEvent.click(loadButton());
    await settle();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the robot story");
    expect(alert.textContent).toContain(STORY_PROBLEMS.noAnswer);
    expect(clipsOn("V1")).toBe(0);
  });

  test("each other problem says what it is", async () => {
    renderEmptyEditor();
    const problem = async () => {
      fireEvent.click(loadButton());
      await settle();
      return screen.getByRole("alert").textContent;
    };

    fakes.assetFor.mockRejectedValueOnce(new FeedClipError("Can't play 07-medium", false));
    expect(await problem()).toContain(STORY_PROBLEMS.cantPlay);
    fakes.music.mockResolvedValueOnce(null);
    expect(await problem()).toContain(STORY_PROBLEMS.noMusic);
    fakes.fetchWholeCollection.mockResolvedValueOnce({
      ok: false,
      failure: { reason: "invalid", detail: "items: expected array" },
    });
    expect(await problem()).toContain(STORY_PROBLEMS.unreadable);
    fakes.fetchWholeCollection.mockResolvedValueOnce({ ok: true, value: [] });
    expect(await problem()).toContain(STORY_PROBLEMS.unreadable);
    expect(clipsOn("V1")).toBe(0);
  });

  test("work done while it loads isn't replaced", async () => {
    let answer: (result: Awaited<ReturnType<typeof FeedApi.fetchWholeCollection>>) => void = () =>
      undefined;
    fakes.fetchWholeCollection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderEmptyEditor();
    fireEvent.click(loadButton());
    await settle();

    // A file placed from My files in the meantime.
    const file: Asset = {
      id: "mine",
      kind: "video",
      name: "mine.mp4",
      source: { type: "file", opfsPath: "assets/mine/source.mp4" },
      durationSec: 2,
    };
    act(() => {
      useDocumentStore.getState().placeAsset({ asset: file, trackId: "V1", start: 0 });
    });
    act(() => {
      answer({ ok: true, value: storyClips() });
    });
    await settle();
    expect(clipsOn("V1")).toBe(1);
    expect(useDocumentStore.getState().project.name).toBe("Untitled project");
  });
  test("Retry after a cut was started doesn't replace it", async () => {
    fakes.fetchWholeCollection.mockResolvedValueOnce({ ok: false, failure: { reason: "network" } });
    renderEmptyEditor();
    fireEvent.click(loadButton());
    await settle();
    const retry = within(screen.getByRole("alert")).getByRole("button", { name: "Retry" });

    const file: Asset = {
      id: "mine",
      kind: "video",
      name: "mine.mp4",
      source: { type: "file", opfsPath: "assets/mine/source.mp4" },
      durationSec: 2,
    };
    act(() => {
      useDocumentStore.getState().placeAsset({ asset: file, trackId: "V1", start: 0 });
    });
    fireEvent.click(retry);
    await settle();
    expect(fakes.fetchWholeCollection).toHaveBeenCalledTimes(1);
    expect(clipsOn("V1")).toBe(1);
    expect(useDocumentStore.getState().project.name).toBe("Untitled project");
  });
});
