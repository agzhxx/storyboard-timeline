import { describe, expect, test } from "vitest";
import {
  previewTimestamps,
  thumbnailCount,
  thumbnailIndexAt,
  thumbnailTimestamps,
  thumbnailTypeOf,
} from "../../src/media/thumbnails.ts";

describe("thumbnailTimestamps", () => {
  test("is one a second, every whole second before the end", () => {
    expect(thumbnailTimestamps(5)).toEqual([0, 1, 2, 3, 4]);
    expect(thumbnailTimestamps(5.02)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(thumbnailTimestamps(0.4)).toEqual([0]);
  });

  test("waits for a first frame that comes after 0", () => {
    expect(thumbnailTimestamps(3, 0.042)).toEqual([0.042, 1, 2]);
  });

  test("is nothing for a length that isn't one", () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(thumbnailTimestamps(duration)).toEqual([]);
    }
  });
});

describe("previewTimestamps", () => {
  test("is the clip's thumbnails whose second starts before the preview ends", () => {
    // The Feed's previews: a clip's first 2.5 s. A 5.04 s clip has 6 thumbnails, 0 to 5.
    expect(previewTimestamps(thumbnailCount(5.041667), 2.5)).toEqual([0, 1, 2]);
    // A preview that ends on a second's start doesn't hold that second's frame.
    expect(previewTimestamps(6, 2)).toEqual([0, 1]);
  });

  test("never goes past the clip's own thumbnails", () => {
    // A clip shorter than its preview, or a preview that is the whole clip.
    expect(previewTimestamps(thumbnailCount(1.5), 2.5)).toEqual([0, 1]);
    expect(previewTimestamps(5, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  test("waits for a first frame that comes after 0, as the clip's own do", () => {
    expect(previewTimestamps(6, 2.5, 0.042)).toEqual([0.042, 1, 2]);
  });
});

test("a thumbnail is WebP only when the blob really is", () => {
  expect(thumbnailTypeOf(new Blob([], { type: "image/webp" }))).toBe("image/webp");
  expect(thumbnailTypeOf(new Blob([], { type: "image/jpeg" }))).toBe("image/jpeg");
  // A browser that can't encode WebP hands back a PNG.
  expect(thumbnailTypeOf(new Blob([], { type: "image/png" }))).toBeNull();
});

test("a time shows the thumbnail taken at or before it, forgiving float error", () => {
  expect(thumbnailIndexAt(0, 5)).toBe(0);
  expect(thumbnailIndexAt(1.999, 5)).toBe(1);
  expect(thumbnailIndexAt(2.9999999, 5)).toBe(3);
  expect(thumbnailIndexAt(4.9, 5)).toBe(4);
  expect(thumbnailIndexAt(9, 5)).toBe(4);
  expect(thumbnailIndexAt(-1, 5)).toBe(0);
});
