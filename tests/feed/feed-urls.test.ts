import { describe, expect, test } from "vitest";
import {
  FEED_ORIGIN,
  feedPageUrl,
  MEDIA_ORIGIN,
  mediaUrl,
  originalKey,
  posterUrl,
  posterWidths,
  videoUrl,
} from "../../src/feed/feed-urls.ts";
import { storyClips } from "../app/story.ts";

const MEDIA = "https://media.example";

function clip() {
  const [first] = storyClips();
  if (!first) throw new Error("No story clips");
  return first;
}

describe("the settings", () => {
  test("without VITE_FEED_ORIGIN and VITE_MEDIA_ORIGIN, the live Feed and its bucket", () => {
    expect(FEED_ORIGIN).toBe("https://generation-feed.vercel.app");
    expect(MEDIA_ORIGIN).toBe("https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev");
  });
});

describe("the Feed's URL helpers", () => {
  test("a key under an origin, with or without its slash", () => {
    expect(mediaUrl(MEDIA, "m/a/v1/320.webp")).toBe("https://media.example/m/a/v1/320.webp");
    expect(mediaUrl(`${MEDIA}//`, "m/a/v1/320.webp")).toBe("https://media.example/m/a/v1/320.webp");
  });

  test("the original: a video as delivered, an image as WebP", () => {
    expect(originalKey({ id: "g6lq3m8u9k", kind: "video" })).toBe("originals/g6lq3m8u9k.mp4");
    expect(originalKey({ id: "g6lq3m8u9k", kind: "image" })).toBe("originals/g6lq3m8u9k.webp");
  });

  test("the smallest poster at least as wide as asked, never wider than the source", () => {
    const item = clip();
    expect(posterUrl(MEDIA, item, 320, "webp")).toBe(`${MEDIA}/m/${item.id}/v1/320.webp`);
    expect(posterUrl(MEDIA, item, 400, "webp")).toBe(`${MEDIA}/m/${item.id}/v1/480.webp`);
    expect(posterUrl(MEDIA, item, 4000, "avif")).toBe(`${MEDIA}/m/${item.id}/v1/1920.avif`);
    expect(posterWidths(854)).toEqual([320, 480, 640]);
    expect(posterWidths(200)).toEqual([320]);
  });

  test("the Feed's 720p video", () => {
    const item = clip();
    expect(videoUrl(MEDIA, item)).toBe(`${MEDIA}/m/${item.id}/v1/full.mp4`);
  });
});

test("a page of a collection's videos, and the page after a cursor", () => {
  expect(feedPageUrl("story", 50, null)).toBe(
    "https://generation-feed.vercel.app/api/media?collection=story&kind=video&limit=50",
  );
  expect(feedPageUrl("camera-moves", 24, "mvbcmtme.f8n04p4giv")).toBe(
    "https://generation-feed.vercel.app/api/media?collection=camera-moves&kind=video&limit=24&cursor=mvbcmtme.f8n04p4giv",
  );
});
