// The perf overlay (spec section 4.8, Perf overlay board), loaded as its own chunk only with
// ?perf=1. The board's rows: open VideoFrames (on the main thread and in the decode worker), each
// video track's decode queue, late or dropped frames over the playback, the two scrub latencies
// (last and p95), frames per second, long animation frames (over 50 ms) and Chrome's JS heap; M2's
// slowest interaction, which approximates INP the way the Event Timing API groups events; and the
// last export's output check, as a debug line. The media counters come from src/perf/counters.ts.
// No library: PerformanceObserver and requestAnimationFrame do the rest.

import { useEffect, useState } from "react";
import { usePlaybackStore } from "../media/playback-state.ts";
import { type Gesture, useGestureStore } from "../timeline/gestures.ts";
import { counters, openFrames, p95 } from "./counters.ts";

/** The decode queue's size, which playback reports once it runs. */
const QUEUE_CAPACITY = 8;

interface Media {
  open: number;
  queues: string;
  late: string;
  coarse: string;
  exact: string;
  /** The last export's output check (src/media/export-check.ts), as a debug line. */
  exportCheck: string | null;
}

interface Readings extends Media {
  fps: number | null;
  /** Long animation frames: how many; null where unsupported. */
  longFrames: { count: number } | null;
  /** The slowest interaction, in ms, as INP would count it; null before the first one. */
  interaction: number | null;
  heapMb: number | null;
}

const UNSUPPORTED = "not in this browser";

export default function PerfOverlay() {
  const readings = useReadings();
  const gesture = useGestureStore((state) => describeGesture(state.gesture));
  const status = usePlaybackStore((state) => state.status);
  const rate = usePlaybackStore((state) => state.rate);
  const { fps, longFrames, interaction, heapMb } = readings;
  const rows: [string, string][] = [
    ["Open VideoFrames", String(readings.open)],
    ["Decode queue", readings.queues],
    ["Late or dropped", readings.late],
    ["Scrub, coarse", readings.coarse],
    ["Scrub, exact", readings.exact],
    ["FPS", fps === null ? "…" : String(fps)],
    ["Long animation frames", longFrames ? `${longFrames.count} over 50 ms` : UNSUPPORTED],
    ["JS heap", heapMb === null ? UNSUPPORTED : `${heapMb.toFixed(1)} MB`],
    ["Slowest interaction", interaction === null ? "none yet" : ms(interaction)],
    ["Export check", readings.exportCheck ?? "none yet"],
  ];
  const state =
    status === "playing" ? `playing · ${rate}×` : status === "starting" ? "starting" : gesture;
  return (
    <aside
      aria-label="Performance"
      className="absolute top-3 right-3 z-10 w-[268px] rounded-control bg-bg/86 px-3 py-2.5 font-mono text-2xs leading-[18px] shadow-[0_0_0_1px_rgb(255_255_255/0.06)]"
    >
      <div className="mb-1 flex justify-between text-fg-subtle">
        <span>perf</span>
        <span>{state}</span>
      </div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 border-t border-surface-raised">
          <span className="whitespace-nowrap text-fg-muted">{label}</span>
          <span className="whitespace-nowrap text-fg">{value}</span>
        </div>
      ))}
    </aside>
  );
}

function ms(duration: number): string {
  return `${Math.round(duration)} ms`;
}

function describeGesture(gesture: Gesture | null): string {
  switch (gesture?.kind) {
    case "move":
      return "dragging";
    case "trim":
      return "trimming";
    case "scrub":
      return "scrubbing";
    case "drop":
      return "dropping";
    case undefined:
      return "idle";
  }
}

/** "last 18 ms · p95 31 ms", or "none yet". */
function latency(values: readonly number[]): string {
  const last = values.at(-1);
  const high = p95(values);
  return last === undefined || high === null ? "none yet" : `last ${ms(last)} · p95 ${ms(high)}`;
}

/** The media counters as the board writes them. */
function media(): Media {
  const queue = (trackId: string) => {
    const reading = counters.queues.get(trackId);
    return `${trackId} ${reading?.length ?? 0}/${reading?.capacity ?? QUEUE_CAPACITY}`;
  };
  const { late, expected } = counters;
  const share = expected === 0 ? 0 : (late / expected) * 100;
  return {
    open: openFrames(),
    queues: `${queue("V1")} · ${queue("V2")}`,
    late: `${late} of ${expected} (${share.toFixed(1)}%)`,
    coarse: latency(counters.coarse),
    exact: latency(counters.exact),
    exportCheck: counters.exportCheck,
  };
}

/** Collects the readings, and shows them twice a second. */
function useReadings(): Readings {
  const [readings, setReadings] = useState<Readings>(() => ({
    fps: null,
    longFrames: null,
    interaction: null,
    heapMb: null,
    ...media(),
  }));

  useEffect(() => {
    const supported = PerformanceObserver.supportedEntryTypes;
    const frames: number[] = [];
    let longFrames = supported.includes("long-animation-frame") ? { count: 0 } : null;
    // An interaction (a click, a drag's press and release, a key) is all the events with its id;
    // it lasts as long as its slowest event, from input to the next paint.
    const interactions = new Map<number, number>();
    let frame = 0;

    const tick = (now: number) => {
      frames.push(now);
      while (frames.length > 0 && (frames[0] ?? now) < now - 1000) frames.shift();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const observers: PerformanceObserver[] = [];
    if (longFrames) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!longFrames || entry.duration <= 50) continue;
          longFrames = { count: longFrames.count + 1 };
        }
      });
      observer.observe({ type: "long-animation-frame", buffered: true });
      observers.push(observer);
    }
    if (supported.includes("event")) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry instanceof PerformanceEventTiming) || entry.interactionId === 0) continue;
          const known = interactions.get(entry.interactionId) ?? 0;
          interactions.set(entry.interactionId, Math.max(known, entry.duration));
        }
      });
      // 16 ms is the lowest threshold the API takes; TypeScript's DOM types don't list it yet.
      const init: PerformanceObserverInit & { durationThreshold: number } = {
        type: "event",
        durationThreshold: 16,
        buffered: true,
      };
      observer.observe(init);
      observers.push(observer);
    }

    const show = setInterval(() => {
      setReadings({
        fps: frames.length,
        longFrames,
        interaction: worstInteraction([...interactions.values()]),
        heapMb: heapMegabytes(),
        ...media(),
      });
    }, 500);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(show);
      for (const observer of observers) observer.disconnect();
    };
  }, []);

  return readings;
}

/**
 * The interaction INP would report: the slowest one, or with 50 or more, one of the slowest that
 * skips an outlier per 50 interactions, as web-vitals does.
 */
function worstInteraction(durations: number[]): number | null {
  const sorted = durations.sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))] ?? null;
}

/** Chrome's `performance.memory`, which other browsers don't have. */
function heapMegabytes(): number | null {
  const memory: unknown = Reflect.get(performance, "memory");
  if (typeof memory !== "object" || memory === null) return null;
  const used: unknown = Reflect.get(memory, "usedJSHeapSize");
  return typeof used === "number" ? used / 1024 / 1024 : null;
}
