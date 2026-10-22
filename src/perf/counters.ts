// The media counters the perf overlay shows (spec section 4.8), kept by the code that does the work:
// open VideoFrames and VideoSamples, on the main thread and in the decode and export workers; each
// video track's decode queue; late or dropped frames over the last playback; the two scrub
// latencies; and the last export's output check. Plain numbers that cost nothing to update: the
// overlay, loaded only with ?perf=1, reads them twice a second. With ?perf=1 the latencies are
// also performance measures, which the benches read.

/** Whether the page was opened with ?perf=1. */
export const perfMode =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("perf") === "1";

/** How many latencies each p95 is taken over: the most recent ones. */
const KEPT = 200;

export interface QueueReading {
  length: number;
  capacity: number;
}

export const counters = {
  /**
   * VideoFrames the main thread holds, VideoSamples and VideoFrames the decode worker holds, and
   * VideoSamples the export worker holds.
   */
  openOnMain: 0,
  openInWorker: 0,
  openInExport: 0,
  /** Each video track's frames decoded ahead, during playback. */
  queues: new Map<string, QueueReading>(),
  /** Over the playback under way, or the last one. */
  late: 0,
  expected: 0,
  coarse: [] as number[],
  exact: [] as number[],
  /** The last export's output check, as the perf overlay's debug line; null before one. */
  exportCheck: null as string | null,
};

/** Every open VideoFrame and VideoSample: the number that must read 0 when paused. */
export function openFrames(): number {
  return counters.openOnMain + counters.openInWorker + counters.openInExport;
}

/**
 * A scrub latency, in ms: "coarse" from the playhead moving to the first picture (a cached frame
 * or the nearest thumbnail), "exact" to the exact frame.
 */
export function recordScrub(kind: "coarse" | "exact", startedAt: number, endedAt: number): void {
  const list = counters[kind];
  list.push(endedAt - startedAt);
  if (list.length > KEPT) list.shift();
  if (perfMode) performance.measure(`scrub:${kind}`, { start: startedAt, end: endedAt });
}

/** The 95th percentile, nearest rank; null for none. */
export function p95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}
