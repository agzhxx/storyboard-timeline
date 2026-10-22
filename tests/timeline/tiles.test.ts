import { describe, expect, test } from "vitest";
import {
  BAR_STEP,
  filmstripSlots,
  MAX_TILE_DEVICE_PX,
  TILE_MARGIN_PX,
  tilesInView,
  tileWidthFor,
  waveformBars,
} from "../../src/timeline/tiles.ts";

describe("tiles", () => {
  test("are at most 1,024 device pixels wide at any pixel ratio", () => {
    expect(MAX_TILE_DEVICE_PX).toBe(1_024);
    expect(tileWidthFor(1)).toBe(1_024);
    expect(tileWidthFor(2)).toBe(512);
    expect(tileWidthFor(3)).toBe(341);
    expect(tileWidthFor(1.5) * 1.5).toBeLessThanOrEqual(MAX_TILE_DEVICE_PX);
    expect(tileWidthFor(0)).toBe(1_024);
  });

  test("of a clip in view are the ones under the view, plus a margin each side", () => {
    // A 10,000 px clip from x 1,000; the view shows 2,000 to 3,352 px of the tracks.
    const view = {
      clipLeft: 1_000,
      clipWidth: 10_000,
      inX: 0,
      scrollX: 2_000,
      viewportWidth: 1_352,
    };
    expect(tilesInView({ ...view, tileWidth: 2_048 })).toEqual({ first: 0, last: 1 });
    expect(tilesInView({ ...view, scrollX: 6_000, tileWidth: 2_048 })).toEqual({
      first: 2,
      last: 3,
    });
  });

  test("are counted along the source, from the clip's in point", () => {
    // The same clip, trimmed to start 3,000 px into its source: the view meets its strip later.
    const view = {
      clipLeft: 1_000,
      clipWidth: 10_000,
      inX: 3_000,
      scrollX: 2_000,
      viewportWidth: 1_352,
    };
    expect(tilesInView({ ...view, tileWidth: 2_048 })).toEqual({ first: 1, last: 2 });
  });

  test("of a clip out of view, past the margin, are none", () => {
    const clip = {
      clipLeft: 5_000,
      clipWidth: 500,
      inX: 0,
      viewportWidth: 1_352,
      tileWidth: 2_048,
    };
    expect(tilesInView({ ...clip, scrollX: 5_000 + 500 + TILE_MARGIN_PX })).toBeNull();
    expect(tilesInView({ ...clip, scrollX: 5_000 - 1_352 - TILE_MARGIN_PX })).toBeNull();
    expect(tilesInView({ ...clip, scrollX: 5_000 - 1_352 - TILE_MARGIN_PX + 1 })).toEqual({
      first: 0,
      last: 0,
    });
  });

  test("of a 10-minute clip at 48 px per frame stay a handful near the view", () => {
    // 10 minutes at 24 fps and 48 px per frame is 691,200 px: no canvas could hold it.
    const clipWidth = 10 * 60 * 24 * 48;
    const tiles = tilesInView({
      clipLeft: 0,
      clipWidth,
      inX: 0,
      scrollX: 300_000,
      viewportWidth: 1_352,
      tileWidth: tileWidthFor(2),
    });
    // 512 px tiles at a pixel ratio of 2: six of them cover the view and its margins.
    expect(tiles).toEqual({ first: 584, last: 589 });
  });
});

describe("filmstripSlots", () => {
  // At 24 fps and 2 px per frame, a second is 48 px; a 16:9 thumbnail at 78 px tall is 138.67 px.
  const strip = { secondsPerPixel: 1 / 48, slotWidth: (78 * 16) / 9, count: 5 };

  test("lays thumbnails along the source, each the second its left edge falls in", () => {
    expect(filmstripSlots(0, 240, strip)).toEqual([
      { x: 0, index: 0 },
      { x: (78 * 16) / 9, index: 2 },
    ]);
  });

  test("starts a trimmed clip partway into a slot, as the board draws a trim", () => {
    // In at 1.5 s, 72 px along the strip: the clip starts inside the first slot.
    expect(filmstripSlots(72, 200, strip)[0]).toEqual({ x: 0, index: 0 });
  });

  test("repeats a thumbnail when zoomed in, where a second is wider than a slot", () => {
    // 48 px per frame: a second is 1,152 px, eight slots and a bit.
    const zoomedIn = { ...strip, secondsPerPixel: 1 / (48 * 24) };
    const indexes = filmstripSlots(0, 1_152, zoomedIn).map((slot) => slot.index);
    expect(indexes).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(filmstripSlots(1_152, 1_300, zoomedIn).map((slot) => slot.index)).toEqual([0, 1]);
  });

  test("covers only the slots that overlap the range, for a tile in the middle", () => {
    const slots = filmstripSlots(2_048, 4_096, strip);
    expect(slots[0]?.x).toBeLessThanOrEqual(2_048);
    expect((slots.at(-1)?.x ?? 0) + strip.slotWidth).toBeGreaterThanOrEqual(4_096);
    // Past the last second, the last thumbnail.
    expect(slots.at(-1)?.index).toBe(4);
  });

  test("is empty with no thumbnails yet", () => {
    expect(filmstripSlots(0, 240, { ...strip, count: 0 })).toEqual([]);
  });
});

describe("waveformBars", () => {
  test("are one every 3 px along the source, each covering the source time under it", () => {
    const bars = waveformBars(0, 9, 0.01);
    expect(bars.map((bar) => bar.x)).toEqual([0, 3, 6]);
    expect(bars[1]?.start).toBeCloseTo(0.03, 9);
    expect(bars[1]?.end).toBeCloseTo(0.06, 9);
  });

  test("include the bar that starts just before the range", () => {
    expect(waveformBars(4, 7, 1)[0]?.x).toBe(BAR_STEP);
  });
});
