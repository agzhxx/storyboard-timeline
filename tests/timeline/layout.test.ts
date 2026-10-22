import { describe, expect, test } from "vitest";
import editorTokensCss from "../../src/app/editor-tokens.css?raw";
import {
  clipWidth,
  nearestRow,
  RULER_HEIGHT,
  ROWS,
  TRACKS_HEIGHT,
} from "../../src/timeline/layout.ts";

/** A spacing token's size in pixels, from `--spacing-name: 4.5rem;`. */
function tokenPx(name: string): number {
  const rem = new RegExp(`--spacing-${name}:\\s*([\\d.]+)rem;`).exec(editorTokensCss)?.[1];
  if (rem === undefined) throw new Error(`No token --spacing-${name}`);
  return Number(rem) * 16;
}

describe("the timeline's rows", () => {
  test("are as tall as the tokens the rows' backgrounds use", () => {
    expect(RULER_HEIGHT).toBe(tokenPx("ruler"));
    expect(ROWS.map((row) => [row.trackId, row.height])).toEqual([
      ["V2", tokenPx("track-v2")],
      ["V1", tokenPx("track-v1")],
      ["A1", tokenPx("track-a1")],
    ]);
    expect(TRACKS_HEIGHT).toBe(260);
  });

  test("put clips 4 px below each row's top, as tall as drawn", () => {
    expect(ROWS.map(({ top, clipTop, clipHeight }) => ({ top, clipTop, clipHeight }))).toEqual([
      { top: 28, clipTop: 32, clipHeight: 63 },
      { top: 100, clipTop: 104, clipHeight: 78 },
      { top: 188, clipTop: 192, clipHeight: 63 },
    ]);
  });

  test("a clip dragged over a row of the other kind goes to the nearest row of its own", () => {
    expect(nearestRow("video", 10)?.trackId).toBe("V2");
    expect(nearestRow("video", 99)?.trackId).toBe("V2");
    expect(nearestRow("video", 100)?.trackId).toBe("V1");
    expect(nearestRow("video", 250)?.trackId).toBe("V1");
    expect(nearestRow("audio", 30)?.trackId).toBe("A1");
  });
});

test("a clip is drawn at least 4 px wide", () => {
  expect(clipWidth(72, 2)).toBe(144);
  expect(clipWidth(1, 2)).toBe(4);
});
