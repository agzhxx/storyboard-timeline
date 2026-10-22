// The Feed tab's pages: loaded when a collection is first shown, then one more at a time, kept per
// collection, and a page that doesn't come said so without losing the ones in. The API client is
// faked: each test answers its requests.

import { beforeEach, describe, expect, test, vi } from "vitest";
import type * as FeedApi from "../../src/feed/feed-api.ts";
import type { FeedClip } from "../../src/feed/feed-clip.ts";
import {
  chooseCollection,
  clipsOf,
  complete,
  loadNextPage,
  PAGE_SIZE,
  showFeed,
  showFiles,
  showWholeCollection,
  useFeedTab,
} from "../../src/feed/feed-store.ts";
import { storyClips } from "../app/story.ts";

const api = vi.hoisted(() => ({
  fetchFeedPage: vi.fn<typeof FeedApi.fetchFeedPage>(),
  fetchWholeCollection: vi.fn<typeof FeedApi.fetchWholeCollection>(),
  /** Whether the client's own chunk fails to load, as it would offline. */
  unloadable: false,
}));

vi.mock("../../src/feed/load-feed-api.ts", () => ({
  loadFeedApi: () =>
    api.unloadable ? Promise.reject(new Error("Failed to fetch a chunk")) : Promise.resolve(api),
}));

type PageResult = Awaited<ReturnType<typeof FeedApi.fetchFeedPage>>;

/** A request the test answers when it wants, once it's been made. */
function pending() {
  let answer: (result: PageResult) => void = () => undefined;
  const asked = new Promise<void>((made) => {
    api.fetchFeedPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
          made();
        }),
    );
  });
  return async (result: PageResult) => {
    await asked;
    answer(result);
    await settle();
  };
}

function ok(items: FeedClip[], nextCursor: string | null, total: number): PageResult {
  return { ok: true, value: { items, nextCursor, total } };
}

const clips = storyClips();
const state = () => useFeedTab.getState();
const story = () => clipsOf(state(), "story");
/** Lets the client load and every answer given so far land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useFeedTab.setState({ tab: "files", collection: "story", clips: {} });
  api.fetchFeedPage.mockReset();
  api.unloadable = false;
});

describe("the first page", () => {
  test("loads when the Feed tab first opens, and not again", async () => {
    const answer = pending();
    showFeed();
    expect(state().tab).toBe("feed");
    expect(story().loading).toBe(true);
    await answer(ok(clips.slice(0, 10), "c10", 15));
    expect(story()).toMatchObject({ total: 15, nextCursor: "c10", loading: false, failed: false });
    expect(story().items).toHaveLength(10);

    showFiles();
    showFeed();
    expect(api.fetchFeedPage).toHaveBeenCalledTimes(1);
    expect(api.fetchFeedPage).toHaveBeenCalledWith("story", { limit: PAGE_SIZE, cursor: null });
  });

  test("one that doesn't come says so; Retry asks again", async () => {
    api.fetchFeedPage.mockResolvedValueOnce({ ok: false, failure: { reason: "network" } });
    showFeed();
    await settle();
    expect(story()).toMatchObject({ items: [], total: null, loading: false, failed: true });

    api.fetchFeedPage.mockResolvedValueOnce(ok(clips, null, 15));
    await loadNextPage();
    expect(story()).toMatchObject({ total: 15, failed: false });
    expect(complete(story())).toBe(true);
  });

  test("a client that can't load (offline) is a page that didn't come", async () => {
    api.unloadable = true;
    showFeed();
    await settle();
    expect(story().failed).toBe(true);
    expect(api.fetchFeedPage).not.toHaveBeenCalled();
  });
});

describe("the next pages", () => {
  test("follow the cursor, add to the list, and stop at the last", async () => {
    api.fetchFeedPage.mockResolvedValueOnce(ok(clips.slice(0, 10), "c10", 15));
    showFeed();
    await settle();
    api.fetchFeedPage.mockResolvedValueOnce(ok(clips.slice(10), null, 15));
    await loadNextPage();
    expect(api.fetchFeedPage).toHaveBeenLastCalledWith("story", {
      limit: PAGE_SIZE,
      cursor: "c10",
    });
    expect(story().items.map((item) => item.id)).toEqual(clips.map((item) => item.id));
    expect(complete(story())).toBe(true);

    await loadNextPage();
    expect(api.fetchFeedPage).toHaveBeenCalledTimes(2);
  });

  test("one at a time: asking while a page is on its way does nothing", async () => {
    const answer = pending();
    showFeed();
    await loadNextPage();
    await settle();
    expect(api.fetchFeedPage).toHaveBeenCalledTimes(1);
    await answer(ok(clips, null, 15));
    expect(story().items).toHaveLength(15);
  });

  test("a clip already in the list isn't added twice", async () => {
    api.fetchFeedPage.mockResolvedValueOnce(ok(clips.slice(0, 10), "c10", 15));
    showFeed();
    await settle();
    api.fetchFeedPage.mockResolvedValueOnce(ok(clips.slice(8), null, 15));
    await loadNextPage();
    expect(story().items).toHaveLength(15);
  });

  test("a next page that doesn't come keeps the clips in, and can be asked again", async () => {
    api.fetchFeedPage.mockResolvedValueOnce(ok(clips.slice(0, 10), "c10", 15));
    showFeed();
    await settle();
    api.fetchFeedPage.mockResolvedValueOnce({ ok: false, failure: { reason: "timeout" } });
    await loadNextPage();
    expect(story()).toMatchObject({ failed: true, nextCursor: "c10" });
    expect(story().items).toHaveLength(10);
    expect(complete(story())).toBe(false);
  });
});

describe("collections", () => {
  test("another collection loads its own first page; each keeps its own", async () => {
    api.fetchFeedPage.mockResolvedValueOnce(ok(clips, null, 15));
    showFeed();
    await settle();
    api.fetchFeedPage.mockResolvedValueOnce(ok(clips.slice(0, 3), null, 3));
    chooseCollection("worlds");
    await settle();
    expect(api.fetchFeedPage).toHaveBeenLastCalledWith("worlds", {
      limit: PAGE_SIZE,
      cursor: null,
    });
    expect(clipsOf(state(), "worlds").items).toHaveLength(3);
    expect(story().items).toHaveLength(15);

    chooseCollection("story");
    expect(api.fetchFeedPage).toHaveBeenCalledTimes(2);
  });

  test("the picker's value counts only if the tab offers that collection", async () => {
    api.fetchFeedPage.mockResolvedValueOnce(ok(clips, null, 15));
    showFeed();
    await settle();
    // Pairs hold only images, so the tab doesn't offer them; the rest isn't a collection.
    for (const value of ["pairs", "nonsense", ""]) chooseCollection(value);
    expect(state().collection).toBe("story");
    expect(api.fetchFeedPage).toHaveBeenCalledTimes(1);
  });

  test("a page that comes after the picker moved on lands in its own collection", async () => {
    const answer = pending();
    showFeed();
    await settle();
    api.fetchFeedPage.mockResolvedValueOnce(ok([], null, 0));
    chooseCollection("ads");
    await answer(ok(clips, null, 15));
    expect(state().collection).toBe("ads");
    expect(story().items).toHaveLength(15);
    expect(clipsOf(state(), "ads")).toMatchObject({ items: [], total: 0 });
  });

  test("a page asked for before the story filled the collection doesn't land on top of it", async () => {
    const answer = pending();
    showFeed();
    await settle();
    showWholeCollection("story", clips);
    await answer({ ok: false, failure: { reason: "timeout" } });
    expect(story()).toMatchObject({ total: 15, nextCursor: null, loading: false, failed: false });
    expect(complete(story())).toBe(true);
  });

  test("nor does one that came", async () => {
    const answer = pending();
    showFeed();
    await settle();
    showWholeCollection("story", clips);
    await answer(ok(clips.slice(0, 10), "c10", 15));
    expect(story()).toMatchObject({ total: 15, nextCursor: null });
    expect(story().items).toHaveLength(15);
  });

  test("the story's whole collection, fetched by the story, shows without asking again", () => {
    showWholeCollection("story", clips);
    expect(state()).toMatchObject({ tab: "feed", collection: "story" });
    expect(complete(story())).toBe(true);
    showFeed();
    expect(api.fetchFeedPage).not.toHaveBeenCalled();
  });
});
