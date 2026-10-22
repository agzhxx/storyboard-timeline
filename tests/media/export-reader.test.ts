import { describe, expect, test } from "vitest";
import type { DecodePass } from "../../src/engine/export-schedule.ts";
import { SOURCE_TOLERANCE_SEC } from "../../src/engine/time.ts";
import {
  MissingFrameError,
  type Pass,
  ReaderClosedError,
  TrackReader,
} from "../../src/media/export-reader.ts";

/** A decoded frame: its clip and index in the source. Closing it twice is a bug. */
class FakeFrame {
  closed = false;
  readonly timestamp: number;
  readonly duration: number;
  readonly name: string;

  constructor(name: string, timestamp: number, duration: number) {
    this.name = name;
    this.timestamp = timestamp;
    this.duration = duration;
  }

  close(): void {
    if (this.closed) throw new Error(`${this.name} closed twice`);
    this.closed = true;
  }
}

interface Source {
  /** The frames' indexes, in order, at `fps`: a gap or an early end is a broken file. */
  frames: number[];
  fps: number;
  /** The pass throws instead of handing out this frame index. */
  failAt?: number;
}

/** A track's clips and their fake decoders, with everything that happens to them written down. */
function track(sources: Record<string, Source>) {
  const log: string[] = [];
  const made: FakeFrame[] = [];
  let open = 0;
  const passes: DecodePass[] = Object.keys(sources).map((clipId) => ({
    clipId,
    assetId: clipId,
    fromSec: 0,
    toSec: 10,
  }));
  const reader = new TrackReader<FakeFrame>(passes, {
    open: (pass): Pass<FakeFrame> => {
      log.push(`open ${pass.clipId}`);
      const source = sources[pass.clipId];
      if (!source) throw new Error(`No source ${pass.clipId}`);
      const queue = [...source.frames];
      return {
        next: () => {
          const index = queue.shift();
          if (index === undefined) return Promise.resolve(null);
          if (index === source.failAt) return Promise.reject(new Error("The decoder broke"));
          const frame = new FakeFrame(`${pass.clipId}${index}`, index / source.fps, 1 / source.fps);
          made.push(frame);
          return Promise.resolve(frame);
        },
        close: () => {
          log.push(`close ${pass.clipId}`);
          return Promise.resolve();
        },
      };
    },
    opened: () => (open += 1),
    closed: () => (open -= 1),
  });
  return { reader, log, made, open: () => open };
}

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

/** The frame a reader shows, where the test knows there is one. */
async function shownAt(reader: TrackReader<FakeFrame>, clipId: string, seconds: number) {
  const frame = await reader.frameAt(clipId, seconds);
  if (!frame) throw new Error(`No frame of ${clipId} at ${seconds}`);
  return frame;
}
/** Where output frame n is looked up, at `fps`, in a clip from its source's start. */
const at = (n: number, fps = 24) => n / fps + SOURCE_TOLERANCE_SEC;

describe("TrackReader", () => {
  test("a clip's frames come from one pass, in order: the last frame at or before each time", async () => {
    const { reader, log } = track({ a: { frames: range(48), fps: 24 } });
    const shown: string[] = [];
    for (let n = 0; n < 48; n += 1) shown.push((await shownAt(reader, "a", at(n))).name);
    expect(shown).toEqual(range(48).map((index) => `a${index}`));
    expect(log).toEqual(["open a"]);
  });

  test("a 30 fps source in a 24 fps cut: the frames between are closed unseen", async () => {
    const { reader, made } = track({ a: { frames: range(30), fps: 30 } });
    const shown: string[] = [];
    for (let n = 0; n < 8; n += 1) shown.push((await shownAt(reader, "a", at(n))).name);
    expect(shown).toEqual(["a0", "a1", "a2", "a3", "a5", "a6", "a7", "a8"]);
    expect(made.find((frame) => frame.name === "a4")?.closed).toBe(true);
  });

  test("a 24 fps source in a 30 fps cut: a frame is handed out twice, the same one", async () => {
    const { reader } = track({ a: { frames: range(24), fps: 24 } });
    const first = await shownAt(reader, "a", at(0, 30));
    const again = await shownAt(reader, "a", at(1, 30));
    expect(again).toBe(first);
    expect(first.closed).toBe(false);
    const shown = [first.name, again.name];
    for (let n = 2; n < 6; n += 1) shown.push((await shownAt(reader, "a", at(n, 30))).name);
    expect(shown).toEqual(["a0", "a0", "a1", "a2", "a3", "a4"]);
    expect(first.closed).toBe(true);
  });

  test("the next clip's pass opens as soon as a clip becomes current; a clip's pass closes at the cut", async () => {
    const { reader, log } = track({
      a: { frames: range(24), fps: 24 },
      b: { frames: range(24), fps: 24 },
      c: { frames: range(24), fps: 24 },
    });
    await reader.frameAt("a", at(0));
    expect(log).toEqual(["open a", "open b"]);
    await reader.frameAt("a", at(23));
    await reader.frameAt("b", at(0));
    expect(log).toEqual(["open a", "open b", "close a", "open c"]);
    await reader.frameAt("c", at(0));
    expect(log).toEqual(["open a", "open b", "close a", "open c", "close b"]);
  });

  test("a clip in a later pass can be asked for straight away: the passes skipped close", async () => {
    const { reader, log } = track({
      a: { frames: range(24), fps: 24 },
      b: { frames: range(24), fps: 24 },
      c: { frames: range(24), fps: 24 },
    });
    expect((await shownAt(reader, "c", at(3))).name).toBe("c3");
    expect(log).toEqual(["open c"]);
  });

  test("frames that end before the clip does fail at the first frame missing", async () => {
    const { reader } = track({ a: { frames: range(10), fps: 24 } });
    for (let n = 0; n < 10; n += 1) await reader.frameAt("a", at(n));
    await expect(reader.frameAt("a", at(10))).rejects.toBeInstanceOf(MissingFrameError);
  });

  test("frames that skip ahead fail where the gap is", async () => {
    const { reader } = track({ a: { frames: [0, 1, 2, 3, 7, 8], fps: 24 } });
    expect((await shownAt(reader, "a", at(3))).name).toBe("a3");
    await expect(reader.frameAt("a", at(4))).rejects.toBeInstanceOf(MissingFrameError);
  });

  test("before its file's first frame (a file can start after 0), there's nothing to show yet", async () => {
    const { reader } = track({ a: { frames: [2, 3, 4, 5], fps: 24 } });
    expect(await reader.frameAt("a", at(0))).toBeNull();
    expect(await reader.frameAt("a", at(1))).toBeNull();
    expect((await reader.frameAt("a", at(2)))?.name).toBe("a2");
  });

  test("a pass with no frame at all fails", async () => {
    const { reader } = track({ a: { frames: [], fps: 24 } });
    await expect(reader.frameAt("a", at(0))).rejects.toBeInstanceOf(MissingFrameError);
  });

  test("a decoder that throws fails the read with its error", async () => {
    const { reader } = track({ a: { frames: range(24), fps: 24, failAt: 5 } });
    await reader.frameAt("a", at(3));
    await expect(reader.frameAt("a", at(6))).rejects.toThrow("The decoder broke");
  });

  test("a clip asked for out of the track's order is a bug", async () => {
    const { reader } = track({
      a: { frames: range(24), fps: 24 },
      b: { frames: range(24), fps: 24 },
    });
    await reader.frameAt("b", at(0));
    await expect(reader.frameAt("a", at(0))).rejects.toThrow("isn't a clip after the current one");
  });

  test("closing stops every pass and closes every frame: none is left open", async () => {
    const { reader, log, made, open } = track({
      a: { frames: range(24), fps: 24 },
      b: { frames: range(24), fps: 24 },
    });
    for (let n = 0; n < 12; n += 1) await reader.frameAt("a", at(n));
    expect(open()).toBe(2);
    await reader.close();
    expect(open()).toBe(0);
    expect(made.every((frame) => frame.closed)).toBe(true);
    expect(log).toEqual(["open a", "open b", "close a", "close b"]);
  });

  test("closed while a frame is read: the frame is closed when it comes, and the read fails", async () => {
    let deliver: (frame: FakeFrame) => void = () => undefined;
    let open = 0;
    const frame = new FakeFrame("a0", 0, 1 / 24);
    const reader = new TrackReader<FakeFrame>(
      [{ clipId: "a", assetId: "a", fromSec: 0, toSec: 1 }],
      {
        open: () => ({
          next: () =>
            new Promise<FakeFrame>((resolve) => {
              deliver = resolve;
            }),
          close: () => Promise.resolve(),
        }),
        opened: () => (open += 1),
        closed: () => (open -= 1),
      },
    );
    const reading = reader.frameAt("a", at(0));
    await Promise.resolve();
    await reader.close();
    deliver(frame);
    await expect(reading).rejects.toBeInstanceOf(ReaderClosedError);
    expect(frame.closed).toBe(true);
    expect(open).toBe(0);
  });

  test("closed while the frame after the one shown is read: each frame is closed once", async () => {
    const shown = new FakeFrame("a0", 0, 1 / 24);
    const after = new FakeFrame("a1", 1 / 24, 1 / 24);
    let deliver: (frame: FakeFrame) => void = () => undefined;
    let askedForNext: () => void = () => undefined;
    const readingNext = new Promise<void>((resolve) => {
      askedForNext = resolve;
    });
    let open = 0;
    const reader = new TrackReader<FakeFrame>(
      [{ clipId: "a", assetId: "a", fromSec: 0, toSec: 1 }],
      {
        open: () => {
          let reads = 0;
          return {
            next: () => {
              reads += 1;
              if (reads === 1) return Promise.resolve(shown);
              askedForNext();
              return new Promise<FakeFrame>((resolve) => {
                deliver = resolve;
              });
            },
            close: () => Promise.resolve(),
          };
        },
        opened: () => (open += 1),
        closed: () => (open -= 1),
      },
    );
    const reading = reader.frameAt("a", at(0));
    await readingNext;
    await reader.close();
    deliver(after);
    await expect(reading).rejects.toBeInstanceOf(ReaderClosedError);
    expect([shown.closed, after.closed]).toEqual([true, true]);
    expect(open).toBe(0);
  });
});
