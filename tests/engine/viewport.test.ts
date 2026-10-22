import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  clampScrollX,
  contentWidth,
  END_PADDING_PX,
  fitZoom,
  frameAt,
  MAX_PX_PER_FRAME,
  positionAt,
  sliderToZoom,
  wheelZoomFactor,
  xOf,
  zoomAround,
  zoomRange,
  zoomToSlider,
} from "../../src/engine/viewport.ts";

describe("pixels and frames", () => {
  test("frame f starts at f × pixels per frame, minus the scroll", () => {
    expect(xOf(462, { pxPerFrame: 2, scrollX: 0 })).toBe(924);
    expect(xOf(462, { pxPerFrame: 2, scrollX: 900 })).toBe(24);
    expect(xOf(0, { pxPerFrame: 24, scrollX: 48 })).toBe(-48);
  });

  test("a point is on the frame it falls in, rounded down", () => {
    const view = { pxPerFrame: 2, scrollX: 0 };

    expect(frameAt(924, view)).toBe(462);
    expect(frameAt(925.9, view)).toBe(462);
    expect(frameAt(926, view)).toBe(463);
    expect(frameAt(24, { pxPerFrame: 2, scrollX: 900 })).toBe(462);
    // 3.3 / 1.1 is 2.9999999999999996 in floating point, but the point is on frame 3.
    expect(frameAt(3.3, { pxPerFrame: 1.1, scrollX: 0 })).toBe(3);
  });

  test("positions between frames stay exact for snapping and drags", () => {
    expect(positionAt(925, { pxPerFrame: 2, scrollX: 0 })).toBe(462.5);
  });

  test("a frame's start maps back to that frame at any zoom, scrolled anywhere before it", () => {
    fc.assert(
      fc.property(
        // Up to 2 hours at 30 fps, scrolled so the frame is somewhere in or right of the view.
        fc.integer({ min: 0, max: 216_000 }),
        fc.double({ min: 0.01, max: 48, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (frame, pxPerFrame, scrolled) => {
          const view = { pxPerFrame, scrollX: scrolled * frame * pxPerFrame };
          expect(frameAt(xOf(frame, view), view)).toBe(frame);
        },
      ),
    );
  });
});

describe("zoom around a point", () => {
  test("keeps the frame under the pointer where it was", () => {
    const view = { pxPerFrame: 2, scrollX: 300 };
    const zoomed = zoomAround(view, 8, 624);

    // 624 px into the tracks, scrolled 300 px: frame 462 at 2 px per frame, and still there.
    expect(positionAt(624, view)).toBe(462);
    expect(zoomed).toEqual({ pxPerFrame: 8, scrollX: 462 * 8 - 624 });
    expect(positionAt(624, zoomed)).toBe(462);
  });

  test("holds any point still, zooming in or out", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 48, noNaN: true }),
        fc.double({ min: 0.05, max: 48, noNaN: true }),
        fc.double({ min: 0, max: 1e5, noNaN: true }),
        fc.double({ min: 0, max: 2_000, noNaN: true }),
        (from, to, scrollX, anchorX) => {
          const view = { pxPerFrame: from, scrollX };
          const zoomed = zoomAround(view, to, anchorX);
          expect(positionAt(anchorX, zoomed)).toBeCloseTo(positionAt(anchorX, view), 6);
        },
      ),
    );
  });

  test("a wheel notch zooms by √2, and a trackpad pinch by a little", () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(Math.SQRT2, 12);
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / Math.SQRT2, 12);
    expect(wheelZoomFactor(-4)).toBeCloseTo(1.014, 3);
    expect(wheelZoomFactor(0)).toBe(1);
  });
});

describe("the zoom range", () => {
  test("fit shows the whole cut, with room after its end", () => {
    // The 45 s robot story (1,080 frames at 24 fps) in the design's 1,352 px of tracks.
    expect(fitZoom(1_080, 24, 1_352)).toBe((1_352 - END_PADDING_PX) / 1_080);
    expect(contentWidth(1_080, fitZoom(1_080, 24, 1_352), 1_352)).toBe(1_352);
  });

  test("fit shows at least 10 seconds, so a short or empty cut has room around it", () => {
    expect(fitZoom(0, 30, 1_352)).toBe((1_352 - END_PADDING_PX) / 300);
    expect(fitZoom(72, 24, 1_352)).toBe((1_352 - END_PADDING_PX) / 240);
  });

  test("goes from fitting the cut to 48 px per frame", () => {
    expect(zoomRange(1_080, 24, 1_352)).toEqual({
      min: (1_352 - END_PADDING_PX) / 1_080,
      max: MAX_PX_PER_FRAME,
    });
    // A view too narrow to fit even 10 seconds closer than 48 px per frame has one zoom level.
    expect(zoomRange(0, 24, 100_000)).toEqual({ min: MAX_PX_PER_FRAME, max: MAX_PX_PER_FRAME });
  });

  test("the slider moves evenly on a log scale, end to end", () => {
    const range = { min: 1, max: 64 };

    expect(zoomToSlider(1, range)).toBe(0);
    expect(zoomToSlider(8, range)).toBeCloseTo(0.5, 12);
    expect(zoomToSlider(64, range)).toBe(1);
    expect(zoomToSlider(0.5, range)).toBe(0);
    expect(sliderToZoom(0.5, range)).toBeCloseTo(8, 12);
    expect(sliderToZoom(1, range)).toBe(64);
    // One zoom level: the slider sits at its start.
    expect(zoomToSlider(48, { min: 48, max: 48 })).toBe(0);
    expect(sliderToZoom(0.7, { min: 48, max: 48 })).toBe(48);
  });
});

describe("scrolling", () => {
  test("the content is the cut plus room after it, and never narrower than the view", () => {
    expect(contentWidth(1_080, 2, 1_352)).toBe(2_160 + END_PADDING_PX);
    expect(contentWidth(0, 2, 1_352)).toBe(1_352);
  });

  test("stops at the start and where the content's end meets the view's", () => {
    const maxScroll = 2_160 + END_PADDING_PX - 1_352;

    expect(clampScrollX(-50, 1_080, 2, 1_352)).toBe(0);
    expect(clampScrollX(400, 1_080, 2, 1_352)).toBe(400);
    expect(clampScrollX(5_000, 1_080, 2, 1_352)).toBe(maxScroll);
    expect(clampScrollX(5_000, 1_080, 1, 1_352)).toBe(0);
  });
});
