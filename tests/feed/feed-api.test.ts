// The Feed's API client: every answer checked against the schema copied from the Feed, pages
// followed by their cursor, and every way a page can fail mapped to a reason. fetch is faked.

import { afterEach, describe, expect, test, vi } from "vitest";
import storyResponse from "../../e2e/fixtures/feed/story.json";
import {
  FEED_TIMEOUT_MS,
  fetchFeedPage,
  fetchWholeCollection,
  parseFeedPage,
} from "../../src/feed/feed-api.ts";

/** The real answer's first item, as plain JSON to change. */
function realItem(): Record<string, unknown> {
  const [first] = structuredClone(storyResponse).items;
  if (!first) throw new Error("No items in the fixture");
  return first;
}

function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return { items, nextCursor: null, total: items.length, ...extra };
}

function invalid(body: unknown): string {
  const result = parseFeedPage(body);
  if (result.ok || result.failure.reason !== "invalid") throw new Error("It parsed");
  return result.failure.detail;
}

describe("parseFeedPage", () => {
  test("reads the Feed's real answer for the story: 15 clips on one page", () => {
    const result = parseFeedPage(storyResponse);
    if (!result.ok) throw new Error("The real answer didn't parse");
    expect(result.value.total).toBe(15);
    expect(result.value.nextCursor).toBeNull();
    expect(result.value.items).toHaveLength(15);
    expect(result.value.items[0]).toMatchObject({
      id: "g6lq3m8u9k",
      kind: "video",
      shot: "07-medium",
      model: "Kling 2.5 Pro",
      videoKey: "m/g6lq3m8u9k/v1/full.mp4",
      durationSec: 5,
      width: 1920,
      height: 1080,
    });
  });

  test("a field the Feed adds later is dropped, not an error", () => {
    const result = parseFeedPage(page([{ ...realItem(), rating: 5 }]));
    if (!result.ok) throw new Error("An unknown field failed the page");
    expect(result.value.items[0]).not.toHaveProperty("rating");
  });

  test("a field the Timeline reads that's missing or changed fails the page", () => {
    const withoutVideo = realItem();
    Reflect.deleteProperty(withoutVideo, "videoKey");
    expect(invalid(page([withoutVideo]))).toContain("A video needs videoKey");
    expect(invalid(page([{ ...realItem(), width: "1920" }]))).toContain("width");
    expect(invalid(page([{ ...realItem(), id: "not an id" }]))).toContain("id");
  });

  test("the copied schema's own rules hold: a shot belongs to a story item", () => {
    expect(invalid(page([{ ...realItem(), collection: "worlds" }]))).toContain(
      "shot belongs to story items",
    );
  });

  test("an image in a page of videos fails it", () => {
    const image = {
      ...realItem(),
      kind: "image",
      previewKey: undefined,
      videoKey: undefined,
      durationSec: undefined,
      sourceId: undefined,
    };
    expect(invalid(page([realItem(), image]))).toContain("isn't a video");
  });

  test("a page that isn't one fails", () => {
    expect(invalid({ items: [], total: -1, nextCursor: null })).toContain("total");
    expect(invalid({ items: [], total: 0, nextCursor: "" })).toContain("nextCursor");
    expect(invalid({ total: 0, nextCursor: null })).toContain("items");
    expect(invalid("Not Found")).not.toBe("");
  });
});

/** A fake fetch that answers with `body` and remembers the addresses asked for. */
function answer(body: unknown, init: ResponseInit = {}) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body), init)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchFeedPage", () => {
  test("asks the Feed for a page of a collection's videos, then for the page after the cursor", async () => {
    const fetchMock = answer(storyResponse);
    await fetchFeedPage("story", { limit: 24 });
    await fetchFeedPage("worlds", { limit: 24, cursor: "mvc2tyje.uudh5lvhuk" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://generation-feed.vercel.app/api/media?collection=story&kind=video&limit=24",
      "https://generation-feed.vercel.app/api/media?collection=worlds&kind=video&limit=24&cursor=mvc2tyje.uudh5lvhuk",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("a page that comes", async () => {
    answer(storyResponse);
    const result = await fetchFeedPage("story", { limit: 50 });
    expect(result.ok && result.value.items.length).toBe(15);
  });

  test("no answer at all: the network (offline, or a browser refusing the answer)", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchFeedPage("story", { limit: 24 })).toEqual({
      ok: false,
      failure: { reason: "network" },
    });
  });

  test("no answer in time", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    );
    expect(await fetchFeedPage("story", { limit: 24 })).toEqual({
      ok: false,
      failure: { reason: "timeout" },
    });
    expect(FEED_TIMEOUT_MS).toBe(15_000);
  });

  test("an error status", async () => {
    answer({ error: "busy" }, { status: 503 });
    expect(await fetchFeedPage("story", { limit: 24 })).toEqual({
      ok: false,
      failure: { reason: "status", status: 503 },
    });
  });

  test("an answer that isn't JSON, or isn't a page", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("<html>Busy</html>")));
    expect(await fetchFeedPage("story", { limit: 24 })).toEqual({
      ok: false,
      failure: { reason: "invalid", detail: "The answer isn't JSON." },
    });
    answer({ items: "none" });
    const result = await fetchFeedPage("story", { limit: 24 });
    expect(!result.ok && result.failure.reason).toBe("invalid");
  });
});

describe("fetchWholeCollection", () => {
  /** The story's 15 clips served in pages of `size`, cursors "p1", "p2"… */
  function pages(size: number) {
    const { items } = storyResponse;
    const fetchMock = vi.fn((url: string) => {
      const cursor = new URL(url).searchParams.get("cursor");
      const index = cursor === null ? 0 : Number(cursor.slice(1));
      const slice = items.slice(index * size, (index + 1) * size);
      const next = (index + 1) * size < items.length ? `p${String(index + 1)}` : null;
      return Promise.resolve(
        new Response(JSON.stringify({ items: slice, nextCursor: next, total: items.length })),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  test("follows the cursor from page to page until the last", async () => {
    const fetchMock = pages(4);
    const result = await fetchWholeCollection("story", 4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.ok && result.value.map((item) => item.id)).toEqual(
      storyResponse.items.map((item) => item.id),
    );
  });

  test("one page when it holds them all", async () => {
    const fetchMock = pages(50);
    const result = await fetchWholeCollection("story", 50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok && result.value).toHaveLength(15);
  });

  test("a page that fails fails the collection, with its reason", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      if (calls === 2) return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(
        new Response(JSON.stringify({ ...storyResponse, nextCursor: "p1", total: 30 })),
      );
    });
    expect(await fetchWholeCollection("story", 15)).toEqual({
      ok: false,
      failure: { reason: "network" },
    });
  });

  test("an item that comes again on a later page counts once", async () => {
    const { items } = storyResponse;
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      const page =
        calls === 1
          ? { items: items.slice(0, 10), nextCursor: "p1", total: 15 }
          : { items: items.slice(8), nextCursor: null, total: 15 };
      return Promise.resolve(new Response(JSON.stringify(page)));
    });
    const result = await fetchWholeCollection("story", 10);
    expect(result.ok && result.value.map((item) => item.id)).toEqual(items.map((item) => item.id));
  });

  test("a cursor that comes back again stops it, instead of looping", async () => {
    const fetchMock = answer({ ...storyResponse, nextCursor: "same" });
    const result = await fetchWholeCollection("story", 15);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: false,
      failure: { reason: "invalid", detail: "The pages never end." },
    });
  });
});
