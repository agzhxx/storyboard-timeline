import { describe, expect, test } from "vitest";
import { TimeLeft } from "../../src/media/export-progress.ts";

/** Encodes `fps` frames a second, reporting each, from `from` frames at `start` ms. */
function encode(timeLeft: TimeLeft, fps: number, seconds: number, from = 0, start = 0) {
  const frames = Math.round(fps * seconds);
  for (let frame = 1; frame <= frames; frame += 1) {
    timeLeft.update(from + frame, start + (frame * 1000) / fps);
  }
  return { done: from + frames, at: start + seconds * 1000 };
}

describe("TimeLeft", () => {
  test("nothing to say until a rate is known", () => {
    const timeLeft = new TimeLeft();
    expect(timeLeft.seconds(1_080)).toBeNull();
    timeLeft.update(1, 10);
    timeLeft.update(2, 100);
    expect(timeLeft.seconds(1_080)).toBeNull();
  });

  test("a steady 48 frames a second leaves (total − done) ÷ 48 seconds", () => {
    const timeLeft = new TimeLeft();
    const { done } = encode(timeLeft, 48, 5);
    expect(timeLeft.seconds(1_080)).toBeCloseTo((1_080 - done) / 48, 1);
  });

  test("a change of speed is taken in over a few seconds, not at once", () => {
    const timeLeft = new TimeLeft();
    const fast = encode(timeLeft, 100, 5);
    expect(timeLeft.seconds(10_000)).toBeCloseTo((10_000 - fast.done) / 100, 0);
    // Half the speed: a second later the estimate has moved part of the way, after ten nearly all.
    const slow = encode(timeLeft, 50, 1, fast.done, fast.at);
    const early = timeLeft.seconds(10_000) ?? 0;
    expect(early).toBeGreaterThan((10_000 - slow.done) / 100);
    expect(early).toBeLessThan((10_000 - slow.done) / 50);
    const later = encode(timeLeft, 50, 9, slow.done, slow.at);
    expect(timeLeft.seconds(10_000)).toBeCloseTo((10_000 - later.done) / 50, -1);
  });

  test("one slow frame doesn't swing it", () => {
    const timeLeft = new TimeLeft();
    const { done, at } = encode(timeLeft, 60, 4);
    const before = timeLeft.seconds(2_000) ?? 0;
    timeLeft.update(done + 1, at + 400);
    const after = timeLeft.seconds(2_000) ?? 0;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(before * 2);
  });

  test("never below zero, at the end", () => {
    const timeLeft = new TimeLeft();
    encode(timeLeft, 48, 2);
    expect(timeLeft.seconds(10)).toBe(0);
  });
});
