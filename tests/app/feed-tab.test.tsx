// The media bin's "From the Feed" tab (Media bin states board), in the whole editor: loading, the
// story's clips as drawn with the footer, Can't reach the Feed with Retry, the Collection picker,
// Add, and more pages. The Feed's API client is faked (each test answers its pages), and a clip's
// file facts are the story's (5 s at 24 fps), so a card's asset is the test story's.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { useAnnouncer } from "../../src/app/announcer.ts";
import { useUiStore } from "../../src/engine/store.ts";
import type * as FeedApi from "../../src/feed/feed-api.ts";
import type { FeedClip } from "../../src/feed/feed-clip.ts";
import {
  clipsOn,
  messages,
  placed,
  renderEditor,
  renderEmptyEditor,
  selectedIds,
} from "./editor.tsx";
import { storyClips } from "./story.ts";

const api = vi.hoisted(() => ({
  fetchFeedPage: vi.fn<typeof FeedApi.fetchFeedPage>(),
  fetchWholeCollection: vi.fn<typeof FeedApi.fetchWholeCollection>(),
}));

vi.mock("../../src/feed/load-feed-api.ts", () => ({ loadFeedApi: () => Promise.resolve(api) }));

// A clip's facts are the story's, and its asset the test story's, under the shot's name.
vi.mock("../../src/feed/feed-media.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/feed/feed-media.ts")>();
  const { shotAsset, SHOT_FACTS } = await import("./story.ts");
  return {
    ...actual,
    feedFacts: () => Promise.resolve(SHOT_FACTS),
    feedAssetFor: (item: FeedClip) => Promise.resolve(shotAsset(item)),
    feedAssetNow: shotAsset,
  };
});

type PageResult = Awaited<ReturnType<typeof FeedApi.fetchFeedPage>>;

const clips = storyClips();
const page = (items: FeedClip[], nextCursor: string | null, total: number): PageResult => ({
  ok: true,
  value: { items, nextCursor, total },
});

const bin = () => screen.getByRole("region", { name: "Media bin" });
const card = (name: string) => within(bin()).getByRole("button", { name: `${name} Kling 2.5 Pro` });
const cards = () => within(bin()).getAllByRole("button", { name: / Kling 2\.5 Pro$/ });

/** Lets the client load and the answers land. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function openFeedTab() {
  fireEvent.click(within(bin()).getByRole("tab", { name: "From the Feed" }));
  await settle();
}

// The Feed tab's clips are a chunk of their own (src/app/MediaBin.tsx): imported once up front, as a
// browser has it by the press, so the tab draws them in the turn after it opens.
beforeAll(async () => {
  await import("../../src/app/FeedClips.tsx");
});

beforeEach(() => {
  api.fetchFeedPage.mockReset();
  api.fetchFeedPage.mockResolvedValue(page(clips, null, 15));
});

describe("the tab", () => {
  test("shows Loading clips from the Feed… until the first page is in", async () => {
    let answer: (result: PageResult) => void = () => undefined;
    api.fetchFeedPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderEmptyEditor();
    await openFeedTab();
    const tab = within(bin()).getByRole("tab", { name: "From the Feed" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(within(bin()).getAllByText("Loading clips from the Feed…")).toHaveLength(1);
    expect(api.fetchFeedPage).toHaveBeenCalledWith("story", { limit: 24, cursor: null });

    act(() => {
      answer(page(clips, null, 15));
    });
    await settle();
    expect(within(bin()).queryByText("Loading clips from the Feed…")).toBeNull();
    expect(cards()).toHaveLength(15);
    // What's loaded is said by the app's live region.
    await waitFor(() => {
      expect(useAnnouncer.getState().text).toBe("All 15 clips loaded.");
    });
  });

  test("the story's clips in shot order, with the count and the footer, as drawn", async () => {
    renderEmptyEditor();
    await openFeedTab();

    // The Feed sends them newest first; the tab shows them as the cut has them.
    const shots = clips.map((item) => item.shot ?? "").toSorted();
    expect(shots.map((shot) => cards().indexOf(card(shot)))).toEqual(shots.map((_, i) => i));
    expect(clips[0]?.shot).toBe("07-medium");
    expect(within(bin()).getByText("15 clips")).toBeDefined();
    expect(
      within(bin()).getByText("All 15 clips loaded · AI-generated, from the Generation Feed"),
    ).toBeDefined();
  });

  test("a card: its poster, the AI badge, its length, name and model, and what Enter does", async () => {
    renderEmptyEditor();
    await openFeedTab();

    const medium = within(bin()).getByRole("button", {
      name: "07-medium Kling 2.5 Pro",
      description: "AI-generated, 5 seconds. Enter adds it at the playhead.",
    });
    // Its poster over the clip's ThumbHash (the Kit's MediaCard).
    expect(medium.querySelector('[data-slot="media-card-poster"]')?.getAttribute("src")).toBe(
      "https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev/m/g6lq3m8u9k/v1/320.webp",
    );
    expect(
      medium.querySelector('[data-slot="media-card-placeholder"]')?.getAttribute("src"),
    ).toMatch(/^data:image\/png;base64,/);
    expect(within(medium).getByText("AI")).toBeDefined();
    expect(within(medium).getByText("0:05")).toBeDefined();
    expect(within(medium).getByText("Add ↵")).toBeDefined();
  });

  test("can't reach the Feed: says so, and Retry asks again", async () => {
    api.fetchFeedPage.mockResolvedValueOnce({ ok: false, failure: { reason: "network" } });
    renderEmptyEditor();
    await openFeedTab();

    const alert = within(bin()).getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "Can’t reach the Feed" })).toBeDefined();
    expect(
      within(alert).getByText(
        "Its clips can’t load right now. Your own files and the timeline keep working.",
      ),
    ).toBeDefined();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await settle();
    expect(cards()).toHaveLength(15);
    expect(api.fetchFeedPage).toHaveBeenCalledTimes(2);
  });

  test("the arrow keys move between the tabs; files dropped on the bin show My files", async () => {
    renderEmptyEditor();
    const tabs = within(bin()).getAllByRole("tab");
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: "ArrowRight" });
    await settle();
    expect(document.activeElement?.textContent).toBe("From the Feed");
    expect(within(bin()).getByRole("tabpanel", { name: "From the Feed" })).toBeDefined();

    fireEvent.drop(bin(), { dataTransfer: { types: ["Files"], items: [], files: [] } });
    expect(within(bin()).getByRole("tab", { name: "My files" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});

describe("the Collection picker", () => {
  test("offers the story first, then the other collections that have videos", async () => {
    renderEmptyEditor();
    await openFeedTab();

    const picker = within(bin()).getByRole("combobox", { name: "Collection" });
    expect(
      within(picker)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Story", "Worlds", "Camera moves", "Almaty", "Textures", "Ads"]);
  });

  test("shows another collection's clips, loaded once", async () => {
    renderEmptyEditor();
    await openFeedTab();
    api.fetchFeedPage.mockResolvedValueOnce(page([], null, 0));

    const picker = within(bin()).getByRole("combobox", { name: "Collection" });
    fireEvent.change(picker, { target: { value: "ads" } });
    await settle();
    expect(api.fetchFeedPage).toHaveBeenLastCalledWith("ads", { limit: 24, cursor: null });
    expect(
      within(bin()).getByText("No clips in this collection yet.", {
        selector: ":not([aria-live])",
      }),
    ).toBeDefined();

    fireEvent.change(picker, { target: { value: "story" } });
    expect(cards()).toHaveLength(15);
    expect(api.fetchFeedPage).toHaveBeenCalledTimes(2);
  });
});

describe("adding a clip", () => {
  test("a click adds all of it at the playhead, and selects it", async () => {
    renderEditor();
    await openFeedTab();
    act(() => {
      useUiStore.getState().setPlayhead(1_080);
    });

    fireEvent.click(card("05-wide"));
    await settle();
    // The cut ends at 1,080, so V1 is free there: all 5 s of 05-wide go after 15-wide.
    expect(clipsOn("V1")).toBe(16);
    expect(selectedIds()).toHaveLength(1);
    expect(screen.getByText("16 clips and music ·", { exact: false })).toBeDefined();
  });

  test("so does Enter on a card", async () => {
    const { user } = renderEditor();
    await openFeedTab();
    act(() => {
      useUiStore.getState().setPlayhead(400);
    });

    card("01-wide").focus();
    await user.keyboard("{Enter}");
    await settle();
    // V1 is taken at 400, so it goes on V2.
    expect(placed("01-wide")).toEqual({ trackId: "V2", start: 400, in: 0, duration: 120 });
  });

  test("says why when there's no room at the playhead", async () => {
    renderEditor();
    await openFeedTab();
    act(() => {
      useUiStore.getState().setPlayhead(20);
    });

    // V2 gets the first one; the second has no room on either video track.
    fireEvent.click(card("02-medium"));
    await settle();
    fireEvent.click(card("03-closeup"));
    await settle();
    expect(clipsOn("V2")).toBe(1);
    expect(messages().textContent).toContain("That would overlap");
  });
});

describe("more pages", () => {
  test("Load more clips brings the next page; the footer counts them", async () => {
    api.fetchFeedPage.mockResolvedValueOnce(page(clips.slice(0, 10), "c10", 15));
    renderEmptyEditor();
    await openFeedTab();

    expect(cards()).toHaveLength(10);
    expect(
      within(bin()).getByText("10 of 15 clips loaded · AI-generated, from the Generation Feed"),
    ).toBeDefined();
    api.fetchFeedPage.mockResolvedValueOnce(page(clips.slice(10), null, 15));
    fireEvent.click(within(bin()).getByRole("button", { name: "Load more clips" }));
    await settle();
    expect(api.fetchFeedPage).toHaveBeenLastCalledWith("story", { limit: 24, cursor: "c10" });
    expect(cards()).toHaveLength(15);
    expect(within(bin()).queryByRole("button", { name: "Load more clips" })).toBeNull();
    expect(
      within(bin()).getByText("All 15 clips loaded · AI-generated, from the Generation Feed"),
    ).toBeDefined();
  });

  test("a page that doesn't come says so under the clips, with Retry", async () => {
    api.fetchFeedPage.mockResolvedValueOnce(page(clips.slice(0, 10), "c10", 15));
    renderEmptyEditor();
    await openFeedTab();
    api.fetchFeedPage.mockResolvedValueOnce({ ok: false, failure: { reason: "timeout" } });

    fireEvent.click(within(bin()).getByRole("button", { name: "Load more clips" }));
    await settle();
    expect(within(bin()).getByRole("alert").textContent).toBe("Couldn’t load more clips.");
    expect(cards()).toHaveLength(10);
    fireEvent.click(within(bin()).getByRole("button", { name: "Retry" }));
    await settle();
    expect(cards()).toHaveLength(15);
  });
});
