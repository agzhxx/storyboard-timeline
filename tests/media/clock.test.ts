import { describe, expect, test, vi } from "vitest";
import { PlaybackClock, STALL_MS } from "../../src/media/clock.ts";

/** An AudioContext's clock and performance.now(), both set by hand. */
function fakes({ latency }: { latency?: number } = {}) {
  const audio = { currentTime: 10, outputLatency: latency };
  let now = 1_000;
  return {
    audio,
    now: () => now,
    /** Lets `ms` pass, the audio clock moving with it unless it's stuck. */
    pass(ms: number, { audioMoves = true } = {}) {
      now += ms;
      if (audioMoves) audio.currentTime += ms / 1000;
    },
  };
}

describe("PlaybackClock, following the audio", () => {
  test("position = start position + (currentTime − start time) × rate", () => {
    const time = fakes();
    const clock = new PlaybackClock(time, { position: 5, rate: 1, audioStart: 10 });
    expect(clock.position()).toBe(5);
    time.pass(250);
    expect(clock.position()).toBeCloseTo(5.25, 9);
    expect(clock.source).toBe("audio");
  });

  test("it waits for the sound: before the start time it stays at the start position", () => {
    const time = fakes();
    const clock = new PlaybackClock(time, { position: 5, rate: 1, audioStart: 10.05 });
    time.pass(30);
    expect(clock.position()).toBe(5);
    time.pass(70);
    expect(clock.position()).toBeCloseTo(5.05, 9);
  });

  test("at 2× it counts twice as fast", () => {
    const time = fakes();
    const clock = new PlaybackClock(time, { position: 0, rate: 2, audioStart: 10 });
    time.pass(500);
    expect(clock.position()).toBeCloseTo(1, 9);
  });

  test("the output latency holds the picture back until the sound comes out", () => {
    const time = fakes({ latency: 0.1 });
    const clock = new PlaybackClock(time, { position: 0, rate: 1, audioStart: 10 });
    time.pass(100);
    expect(clock.position()).toBe(0);
    time.pass(400);
    expect(clock.position()).toBeCloseTo(0.4, 9);
  });

  test("it never goes back, even if the latency grows", () => {
    const time = fakes({ latency: 0 });
    const clock = new PlaybackClock(time, { position: 0, rate: 1, audioStart: 10 });
    time.pass(500);
    expect(clock.position()).toBeCloseTo(0.5, 9);
    time.audio.outputLatency = 0.2;
    time.pass(16);
    expect(clock.position()).toBeCloseTo(0.5, 9);
  });

  test("restart takes a new position and rate from a new start time", () => {
    const time = fakes();
    const clock = new PlaybackClock(time, { position: 0, rate: 1, audioStart: 10 });
    time.pass(1_000);
    clock.restart({ position: 1, rate: 2, audioStart: 11.05 });
    time.pass(50);
    expect(clock.position()).toBe(1);
    time.pass(100);
    expect(clock.position()).toBeCloseTo(1.2, 9);
  });
});

describe("PlaybackClock, falling back to performance.now()", () => {
  test("without an AudioContext it follows performance.now() with the same math", () => {
    const time = fakes();
    const clock = new PlaybackClock(
      { audio: null, now: time.now },
      { position: 3, rate: 2, audioStart: 0 },
    );
    expect(clock.source).toBe("performance");
    time.pass(250, { audioMoves: false });
    expect(clock.position()).toBeCloseTo(3.5, 9);
  });

  test("a suspended context that never moves: after a stall it carries on, and says so once", () => {
    const time = fakes();
    const onFallBack = vi.fn();
    const clock = new PlaybackClock(
      { ...time, onFallBack },
      { position: 2, rate: 1, audioStart: 10.05 },
    );
    clock.position();
    time.pass(STALL_MS / 2, { audioMoves: false });
    expect(clock.position()).toBe(2);
    time.pass(STALL_MS, { audioMoves: false });
    expect(clock.position()).toBe(2);
    expect(clock.source).toBe("performance");
    time.pass(1_000, { audioMoves: false });
    expect(clock.position()).toBeCloseTo(3, 9);
    expect(onFallBack).toHaveBeenCalledTimes(1);
  });

  test("audio that stops mid-playback: the clock goes on from where it was, never back", () => {
    const time = fakes();
    const clock = new PlaybackClock(time, { position: 0, rate: 1, audioStart: 10 });
    time.pass(2_000);
    expect(clock.position()).toBeCloseTo(2, 9);
    // No audio output any more: the context's time stands still, and so does the picture, a while.
    for (let ms = 50; ms <= STALL_MS; ms += 50) {
      time.pass(50, { audioMoves: false });
      expect(clock.position()).toBeCloseTo(2, 9);
    }
    time.pass(50, { audioMoves: false });
    expect(clock.position()).toBeCloseTo(2, 9);
    expect(clock.source).toBe("performance");
    time.pass(500, { audioMoves: false });
    expect(clock.position()).toBeCloseTo(2.5, 9);
  });

  test("restart after the fallback keeps following performance.now()", () => {
    const time = fakes();
    const clock = new PlaybackClock(
      { audio: null, now: time.now },
      { position: 0, rate: 1, audioStart: 0 },
    );
    clock.restart({ position: 10, rate: 2, audioStart: 0 });
    time.pass(100, { audioMoves: false });
    expect(clock.position()).toBeCloseTo(10.2, 9);
  });
});
