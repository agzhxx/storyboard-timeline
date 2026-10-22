import { describe, expect, test } from "vitest";
import { FrameCache } from "../../src/media/frame-cache.ts";

/** Stands in for an ImageBitmap of 10 × 10 px: 400 bytes. */
class Bitmap {
  readonly width = 10;
  readonly height = 10;
  closed = 0;

  close(): void {
    this.closed += 1;
  }
}

describe("FrameCache", () => {
  test("keeps frames until they'd take more bytes than its cap, then closes the least recently used", () => {
    const cache = new FrameCache<Bitmap>(1_200);
    const [a, b, c, d] = [new Bitmap(), new Bitmap(), new Bitmap(), new Bitmap()];
    cache.set("a", a);
    cache.set("b", b);
    cache.set("c", c);
    expect(cache.bytes).toBe(1_200);
    // Using a makes b the least recently used.
    expect(cache.get("a")).toBe(a);
    cache.set("d", d);
    expect(b.closed).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect([a, c, d].map((bitmap) => bitmap.closed)).toEqual([0, 0, 0]);
    expect(cache.size).toBe(3);
    expect(cache.bytes).toBe(1_200);
  });

  test("a frame stored again under its key closes the one it replaces", () => {
    const cache = new FrameCache<Bitmap>(10_000);
    const [old, fresh] = [new Bitmap(), new Bitmap()];
    cache.set("a", old);
    cache.set("a", fresh);
    expect(old.closed).toBe(1);
    expect(cache.bytes).toBe(400);
  });

  test("the newest frame stays even when it alone is over the cap", () => {
    const cache = new FrameCache<Bitmap>(100);
    const big = new Bitmap();
    cache.set("a", big);
    expect(cache.get("a")).toBe(big);
    expect(big.closed).toBe(0);
  });

  test("deleteWhere and clear close what they drop", () => {
    const cache = new FrameCache<Bitmap>(10_000);
    const bitmaps = [new Bitmap(), new Bitmap(), new Bitmap()];
    cache.set("x:1", bitmaps[0] ?? new Bitmap());
    cache.set("x:2", bitmaps[1] ?? new Bitmap());
    cache.set("y:1", bitmaps[2] ?? new Bitmap());
    cache.deleteWhere((key) => key.startsWith("x:"));
    expect(bitmaps.map((bitmap) => bitmap.closed)).toEqual([1, 1, 0]);
    cache.clear();
    expect(bitmaps.map((bitmap) => bitmap.closed)).toEqual([1, 1, 1]);
    expect(cache.bytes).toBe(0);
  });
});
