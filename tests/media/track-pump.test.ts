import { describe, expect, test } from "vitest";
import type { VideoRun } from "../../src/engine/schedule.ts";
import {
  LOOKAHEAD_US,
  type Placed,
  type Reader,
  type Sample,
  TrackPump,
} from "../../src/media/track-pump.ts";

const FPS = 24;
const us = (frame: number) => Math.round((frame * 1_000_000) / FPS);

/** A clip's run on the timeline: frames `start` to `end`, from source frame 0. */
function run(clipId: string, start: number, end: number): VideoRun {
  return {
    clipId,
    assetId: clipId,
    location: { type: "file", opfsPath: `assets/${clipId}/source.mp4` },
    startUs: us(start),
    endUs: us(end),
    fromSec: 0.001,
    toSec: (end - start) / FPS - 0.001,
    offsetUs: us(start),
  };
}

/** Everything a pump did, and fakes that count open samples. */
function harness({
  frames,
  failAt,
  stopAfter,
}: {
  /** How many frames each clip's reader gives; a clip not listed gives a frame per timeline frame. */
  frames?: Record<string, number>;
  /** The clip whose reader throws, and before which of its frames. */
  failAt?: { clipId: string; frame: number };
  /** For readers that go quiet: frames given, then null. */
  stopAfter?: Record<string, number>;
} = {}) {
  let open = 0;
  const sent: (Placed & { frame: number })[] = [];
  const opened: string[] = [];
  const failures: { clipId: string; atUs: number }[] = [];
  /** What each failure threw, if anything. */
  const errors: unknown[] = [];
  const closedReaders: string[] = [];
  const open_ = (theRun: VideoRun): Reader<Sample & { frame: number }> => {
    opened.push(`${theRun.clipId} after ${sent.length} sent`);
    const count =
      frames?.[theRun.clipId] ?? Math.round(((theRun.endUs - theRun.startUs) * FPS) / 1e6);
    const quiet = stopAfter?.[theRun.clipId];
    let next = 0;
    let closed = false;
    return {
      next() {
        if (closed || next >= (quiet ?? count)) return Promise.resolve(null);
        if (failAt?.clipId === theRun.clipId && failAt.frame === next) {
          return Promise.reject(new Error("decode failed"));
        }
        const frame = next;
        next += 1;
        return Promise.resolve({
          timestamp: frame / FPS,
          duration: 1 / FPS,
          frame,
          close: () => undefined,
        });
      },
      close() {
        if (!closed) closedReaders.push(theRun.clipId);
        closed = true;
        return Promise.resolve();
      },
    };
  };
  return {
    sent,
    opened,
    failures,
    errors,
    closedReaders,
    open: () => open,
    deps: {
      open: open_,
      send: (sample: Sample & { frame: number }, placed: Placed) => {
        sent.push({ ...placed, frame: sample.frame });
      },
      fail: (failed: VideoRun, atUs: number, error?: unknown) => {
        failures.push({ clipId: failed.clipId, atUs });
        errors.push(error);
      },
      opened: () => {
        open += 1;
      },
      closed: () => {
        open -= 1;
      },
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TrackPump: backpressure", () => {
  test("sends `capacity` frames, then waits until the main thread hands some back", async () => {
    const h = harness();
    const pump = new TrackPump([run("a", 0, 48)], 8, h.deps);
    const done = pump.run();
    await settle();
    expect(h.sent).toHaveLength(8);
    pump.ack(3);
    await settle();
    expect(h.sent).toHaveLength(11);
    // Every sample it was handed is closed once its picture is sent.
    expect(h.open()).toBe(1);
    await pump.stop();
    await done;
    expect(h.open()).toBe(0);
  });

  test("frames go out in timeline order, placed where each shows", async () => {
    const h = harness();
    const pump = new TrackPump([run("a", 24, 30)], 8, h.deps);
    await pump.run();
    expect(h.sent.map((frame) => frame.presentUs)).toEqual([24, 25, 26, 27, 28, 29].map(us));
    expect(h.sent.every((frame) => frame.clipId === "a")).toBe(true);
    expect(h.open()).toBe(0);
  });

  test("stopping while it waits closes the sample it holds and every reader", async () => {
    const h = harness();
    const pump = new TrackPump([run("a", 0, 48), run("b", 48, 96)], 2, h.deps);
    const done = pump.run();
    await settle();
    expect(h.open()).toBe(1);
    await pump.stop();
    await done;
    expect(h.open()).toBe(0);
    expect(h.closedReaders).toContain("a");
  });
});

describe("TrackPump: look-ahead at cuts", () => {
  test("the next clip starts decoding when this one's frames reach a second before the cut", async () => {
    const h = harness();
    const pump = new TrackPump([run("a", 0, 72), run("b", 72, 96)], 100, h.deps);
    await pump.run();
    // b opens when a's frame at 72 − 24 = 48 is placed, before it's sent: 48 sent by then.
    expect(LOOKAHEAD_US).toBe(1_000_000);
    expect(h.opened).toEqual(["a after 0 sent", "b after 48 sent"]);
    expect(h.sent.map((frame) => frame.clipId).join("")).toBe("a".repeat(72) + "b".repeat(24));
  });

  test("a clip shorter than a second opens the one after it at once", async () => {
    const h = harness();
    const pump = new TrackPump([run("a", 0, 12), run("b", 12, 36)], 100, h.deps);
    await pump.run();
    expect(h.opened).toEqual(["a after 0 sent", "b after 0 sent"]);
  });

  test("a clip after a gap opens a second before it starts, or when the one before ends", async () => {
    const h = harness();
    const pump = new TrackPump([run("a", 0, 24), run("b", 120, 144)], 100, h.deps);
    await pump.run();
    expect(h.opened).toEqual(["a after 0 sent", "b after 24 sent"]);
  });
});

describe("TrackPump: decode failures", () => {
  test("a reader that throws fails its clip where its frames stopped, and the track stops", async () => {
    const h = harness({ failAt: { clipId: "a", frame: 10 } });
    const pump = new TrackPump([run("a", 0, 48), run("b", 48, 96)], 100, h.deps);
    await pump.run();
    expect(h.failures).toEqual([{ clipId: "a", atUs: us(10) }]);
    // What threw goes with it, so the worker can tell the network from the decoder.
    expect(h.errors).toEqual([new Error("decode failed")]);
    expect(h.sent).toHaveLength(10);
    expect(h.open()).toBe(0);
  });

  test("a reader that goes quiet before its clip's end fails it there", async () => {
    const h = harness({ stopAfter: { b: 5 } });
    const pump = new TrackPump([run("a", 0, 24), run("b", 24, 48)], 100, h.deps);
    await pump.run();
    expect(h.failures).toEqual([{ clipId: "b", atUs: us(29) }]);
    expect(h.errors).toEqual([undefined]);
  });

  test("a clip whose first frame never comes fails at its start", async () => {
    const h = harness({ stopAfter: { a: 0 } });
    await new TrackPump([run("a", 12, 24)], 100, h.deps).run();
    expect(h.failures).toEqual([{ clipId: "a", atUs: us(12) }]);
  });

  test("frames that skip ahead fail the clip where they skipped", async () => {
    const h = harness();
    const deps = {
      ...h.deps,
      open: (theRun: VideoRun) => {
        const reader = h.deps.open(theRun);
        let calls = 0;
        return {
          // Frame 3 never comes: 0, 1, 2, then 4.
          next: async () => {
            calls += 1;
            if (calls === 4) await reader.next();
            return reader.next();
          },
          close: () => reader.close(),
        };
      },
    };
    await new TrackPump([run("a", 0, 24)], 100, deps).run();
    expect(h.failures).toEqual([{ clipId: "a", atUs: us(3) }]);
    expect(h.sent).toHaveLength(3);
  });

  test("a frame that can't be sent fails its clip there, and its sample is still closed", async () => {
    const h = harness();
    const deps = {
      ...h.deps,
      send: (sample: Sample & { frame: number }, placed: Placed) => {
        if (sample.frame === 5) throw new Error("postMessage failed");
        h.deps.send(sample, placed);
      },
    };
    await new TrackPump([run("a", 0, 24)], 100, deps).run();
    expect(h.sent).toHaveLength(5);
    expect(h.failures).toEqual([{ clipId: "a", atUs: us(5) }]);
    expect(h.open()).toBe(0);
  });

  test("a stopped track reports nothing, even if its reader then fails", async () => {
    const h = harness({ failAt: { clipId: "a", frame: 3 } });
    const pump = new TrackPump([run("a", 0, 24)], 2, h.deps);
    const done = pump.run();
    await settle();
    await pump.stop();
    await done;
    expect(h.failures).toEqual([]);
  });
});
