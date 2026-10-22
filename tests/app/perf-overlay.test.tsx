// The perf overlay's rows (spec section 4.8, Perf overlay board), from the media counters.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { dispatchPlayback, PAUSED, usePlaybackStore } from "../../src/media/playback-state.ts";
import PerfOverlay from "../../src/perf/PerfOverlay.tsx";
import { counters, p95 } from "../../src/perf/counters.ts";

/** The overlay's rows as label → value. */
function rows(): Record<string, string> {
  const overlay = screen.getByRole("complementary", { name: "Performance" });
  const pairs = [...overlay.querySelectorAll(":scope > div")].slice(1).map((row) => {
    const [label, value] = [...row.querySelectorAll("span")].map((span) => span.textContent);
    return [label ?? "", value ?? ""];
  });
  return Object.fromEntries(pairs) as Record<string, string>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "requestAnimationFrame"] });
  vi.stubGlobal("PerformanceObserver", Object.assign(vi.fn(), { supportedEntryTypes: [] }));
  Object.assign(counters, {
    openOnMain: 0,
    openInWorker: 0,
    openInExport: 0,
    queues: new Map(),
    late: 0,
    expected: 0,
    coarse: [],
    exact: [],
    exportCheck: null,
  });
  usePlaybackStore.setState(PAUSED);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("shows the board's rows, in its order, with the media counters", () => {
  Object.assign(counters, {
    openOnMain: 2,
    openInWorker: 1,
    openInExport: 4,
    queues: new Map([
      ["V1", { length: 6, capacity: 8 }],
      ["V2", { length: 0, capacity: 8 }],
    ]),
    late: 3,
    expected: 462,
    coarse: [12, 31, 18],
    exact: [96, 142],
    exportCheck: "ok · 45.000 s of 45.000 s",
  });
  render(<PerfOverlay />);
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(Object.keys(rows())).toEqual([
    "Open VideoFrames",
    "Decode queue",
    "Late or dropped",
    "Scrub, coarse",
    "Scrub, exact",
    "FPS",
    "Long animation frames",
    "JS heap",
    "Slowest interaction",
    "Export check",
  ]);
  expect(rows()).toMatchObject({
    // The main thread's, the decode worker's and the export worker's.
    "Open VideoFrames": "7",
    "Decode queue": "V1 6/8 · V2 0/8",
    "Late or dropped": "3 of 462 (0.6%)",
    "Scrub, coarse": "last 18 ms · p95 31 ms",
    "Scrub, exact": "last 142 ms · p95 142 ms",
    "Export check": "ok · 45.000 s of 45.000 s",
  });
});

test("before anything has played or scrubbed", () => {
  render(<PerfOverlay />);
  expect(rows()).toMatchObject({
    "Open VideoFrames": "0",
    "Decode queue": "V1 0/8 · V2 0/8",
    "Late or dropped": "0 of 0 (0.0%)",
    "Scrub, coarse": "none yet",
    "Scrub, exact": "none yet",
    "Export check": "none yet",
  });
});

test("the header says what's happening: playing and its rate, or the gesture", () => {
  render(<PerfOverlay />);
  const header = () => screen.getByRole("complementary", { name: "Performance" }).firstElementChild;
  expect(header()?.textContent).toBe("perfidle");
  act(() => {
    dispatchPlayback({ type: "start", rate: 1 });
    dispatchPlayback({ type: "playing" });
  });
  expect(header()?.textContent).toBe("perfplaying · 1×");
  act(() => {
    dispatchPlayback({ type: "rate", rate: 2 });
  });
  expect(header()?.textContent).toBe("perfplaying · 2×");
});

test("p95 is the nearest-rank 95th percentile", () => {
  expect(p95([])).toBeNull();
  expect(p95([5])).toBe(5);
  expect(p95(Array.from({ length: 100 }, (_, index) => index + 1))).toBe(95);
  expect(p95(Array.from({ length: 20 }, (_, index) => 20 - index))).toBe(19);
});
