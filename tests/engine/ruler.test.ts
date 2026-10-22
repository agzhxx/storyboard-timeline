import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { MIN_LABEL_GAP_PX, MIN_TICK_GAP_PX, rulerSteps } from "../../src/engine/ruler.ts";
import type { Fps } from "../../src/engine/types.ts";

describe("rulerSteps", () => {
  // The four rulers drawn on the design canvas (Toolbar, ruler and playhead; Editor · empty).
  test.each([
    {
      zoom: "fit, the 45 s cut across 1,145 px",
      fps: 24,
      pxPerFrame: 1145 / 1080,
      tick: 24,
      label: 120,
    },
    { zoom: "2 px per frame", fps: 24, pxPerFrame: 2, tick: 12, label: 48 },
    { zoom: "24 px per frame", fps: 24, pxPerFrame: 24, tick: 1, label: 6 },
    { zoom: "4 px per frame at 30 fps", fps: 30, pxPerFrame: 4, tick: 6, label: 30 },
  ] as const)("matches the design at $zoom", ({ fps, pxPerFrame, tick, label }) => {
    expect(rulerSteps(pxPerFrame, fps)).toEqual({ tick, label });
  });

  test("labels whole seconds, then minutes, as the zoom goes out", () => {
    expect(rulerSteps(1, 24)).toEqual({ tick: 24, label: 120 });
    expect(rulerSteps(0.5, 24)).toEqual({ tick: 48, label: 240 });
    expect(rulerSteps(0.05, 30)).toEqual({ tick: 900, label: 1_800 });
    expect(rulerSteps(0.001, 25)).toEqual({ tick: 25 * 1_800, label: 25 * 3_600 });
  });

  test("keeps going past the longest step it knows", () => {
    const { tick, label } = rulerSteps(1e-7, 24);

    expect(tick * 1e-7).toBeGreaterThanOrEqual(MIN_TICK_GAP_PX);
    expect(label % tick).toBe(0);
  });

  test("never collides, at any zoom and frame rate", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 48, noNaN: true }),
        fc.constantFrom<Fps>(24, 25, 30),
        (pxPerFrame, fps) => {
          const { tick, label } = rulerSteps(pxPerFrame, fps);
          // Ticks at least 24 px apart and labels at least 84 px, each label on a tick.
          expect(tick * pxPerFrame).toBeGreaterThanOrEqual(MIN_TICK_GAP_PX);
          expect(label * pxPerFrame).toBeGreaterThanOrEqual(MIN_LABEL_GAP_PX);
          expect(label % tick).toBe(0);
          // Not far apart either: no step is more than 5 times the one before it.
          expect(tick * pxPerFrame).toBeLessThan(MIN_TICK_GAP_PX * 5);
          // Labels land on round times: equal parts of a second, or whole seconds.
          expect(label < fps ? fps % label : label % fps).toBe(0);
        },
      ),
    );
  });

  test("spaces ticks and labels closer as the zoom goes in", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 48, noNaN: true }),
        fc.double({ min: 1, max: 10, noNaN: true }),
        fc.constantFrom<Fps>(24, 25, 30),
        (pxPerFrame, factor, fps) => {
          const out = rulerSteps(pxPerFrame, fps);
          const closer = rulerSteps(pxPerFrame * factor, fps);
          expect(closer.tick).toBeLessThanOrEqual(out.tick);
          expect(closer.label).toBeLessThanOrEqual(out.label);
        },
      ),
    );
  });

  test("needs a zoom above 0", () => {
    expect(() => rulerSteps(0, 24)).toThrow(RangeError);
    expect(() => rulerSteps(Number.NaN, 24)).toThrow(RangeError);
  });
});
