import { describe, expect, test } from "vitest";
import { dueUs } from "../../src/engine/schedule.ts";
import { LateFrames, type Queued, TrackQueue } from "../../src/media/frame-queue.ts";

/** Stands in for a VideoFrame: a name, and whether it's been closed. */
class Frame {
  closed = 0;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  close(): void {
    this.closed += 1;
  }
}

/** Frames n, n+1… of a 24 fps clip placed from timeline frame n on. */
function frames(from: number, count: number, clipId = "a", endUs = Infinity): Queued<Frame>[] {
  return Array.from({ length: count }, (_, k) => {
    const n = from + k;
    return {
      frame: new Frame(`${clipId}${n}`),
      clipId,
      presentUs: Math.round((n * 1_000_000) / 24),
      endUs: Math.min(endUs, Math.round(((n + 1) * 1_000_000) / 24)),
    };
  });
}

function queueOf(entries: Queued<Frame>[]) {
  const acks: number[] = [];
  const queue = new TrackQueue<Frame>((count) => acks.push(count));
  for (const entry of entries) queue.push(entry);
  return { queue, acks };
}

const at = (frame: number) => dueUs(frame, 24);

describe("TrackQueue", () => {
  test("shows the newest frame that's due and closes the ones before it", () => {
    const entries = frames(0, 5);
    const { queue, acks } = queueOf(entries);

    expect(queue.show(at(0), true)).toEqual({
      frame: entries[0]?.frame,
      changed: true,
      onTime: true,
    });
    // Frame 1 is skipped: by the next animation frame, frame 2 is due.
    const shown = queue.show(at(2), true);
    expect(shown.frame?.name).toBe("a2");
    expect(entries.map((entry) => entry.frame.closed)).toEqual([1, 1, 0, 0, 0]);
    expect(acks).toEqual([2]);
    expect(queue.length).toBe(2);
  });

  test("keeps the frame on screen until a newer one is due, without drawing it again", () => {
    const { queue } = queueOf(frames(0, 3));
    queue.show(at(0), true);
    // A 60 Hz display shows each 24 fps frame for two or three animation frames.
    expect(queue.show(at(0), true)).toMatchObject({ changed: false, onTime: true });
    expect(queue.show(at(1), true)).toMatchObject({ changed: true, onTime: true });
  });

  test("a frame due but not decoded yet leaves the last one on screen, late", () => {
    const { queue } = queueOf(frames(0, 2));
    queue.show(at(1), true);
    expect(queue.show(at(2), true)).toMatchObject({ changed: false, onTime: false });
  });

  test("at a cut, the next clip's first frame takes over; its absence is late", () => {
    const { queue } = queueOf(frames(0, 2, "a", Math.round((2 * 1_000_000) / 24)));
    queue.show(at(1), true);
    // Clip b starts at frame 2, but its first frame isn't here: a's last frame stays, late.
    expect(queue.show(at(2), true).onTime).toBe(false);
    for (const entry of frames(2, 2, "b")) queue.push(entry);
    expect(queue.show(at(2), true)).toMatchObject({ changed: true, onTime: true });
  });

  test("where the track has nothing to decode (a gap), it shows nothing and closes what's due", () => {
    const entries = frames(0, 4);
    const { queue, acks } = queueOf(entries);
    queue.show(at(0), true);
    expect(queue.show(at(2), false)).toEqual({ frame: null, changed: true, onTime: false });
    expect(entries.map((entry) => entry.frame.closed)).toEqual([1, 1, 1, 0]);
    expect(acks).toEqual([3]);
    expect(queue.show(at(2), false).changed).toBe(false);
  });

  test("clear closes every frame, shown or waiting, exactly once", () => {
    const entries = frames(0, 6);
    const { queue, acks } = queueOf(entries);
    queue.show(at(1), true);
    queue.clear();
    queue.clear();
    expect(entries.every((entry) => entry.frame.closed === 1)).toBe(true);
    expect(acks.reduce((sum, count) => sum + count, 0)).toBe(6);
    expect(queue.length).toBe(0);
  });

  test("a WebM frame stored half a millisecond late is due on its frame", () => {
    const [first, second] = frames(0, 2);
    if (!first || !second) throw new Error("No frames");
    const { queue } = queueOf([first, { ...second, presentUs: second.presentUs + 500 }]);
    expect(queue.show(at(1), true).frame?.name).toBe("a1");
  });
});

describe("LateFrames", () => {
  test("counts each due frame once, late or not, and skipped frames as late", () => {
    const late = new LateFrames();
    late.due(true);
    late.due(false);
    late.skipped(3);
    expect({ expected: late.expected, late: late.late }).toEqual({ expected: 5, late: 4 });
    late.reset();
    expect({ expected: late.expected, late: late.late }).toEqual({ expected: 0, late: 0 });
  });
});
