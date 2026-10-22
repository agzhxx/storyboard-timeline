import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  assetDurationFrames,
  floorToFrame,
  formatTimecode,
  framesToMicroseconds,
  framesToSeconds,
  microsecondsToFrames,
  parseTimecode,
  secondsToFrames,
  sourceFrameAt,
} from "../../src/engine/time.ts";
import type { Clip, Fps } from "../../src/engine/types.ts";
import { videoAsset } from "./fixtures.ts";

const RATES: Fps[] = [24, 25, 30];
const HOUR = 3600;

/** Any frame in the first 100 hours. */
const anyFrame = (fps: Fps) => fc.integer({ min: 0, max: 100 * HOUR * fps });

describe("floorToFrame", () => {
  test("gives the frame a position falls in", () => {
    expect(floorToFrame(12)).toBe(12);
    expect(floorToFrame(12.4)).toBe(12);
    expect(floorToFrame(12.999)).toBe(12);
    expect(floorToFrame(0)).toBe(0);
  });

  test("forgives the float error of pixel math", () => {
    // At 1.1 px per frame, 3.3 px is frame 3, but 3.3 / 1.1 is 2.9999999999999996.
    expect(floorToFrame(3.3 / 1.1)).toBe(3);
  });
});

describe("seconds and frames", () => {
  test.each(RATES)("frame n starts at n / fps seconds (%i fps)", (fps) => {
    expect(framesToSeconds(0, fps)).toBe(0);
    expect(framesToSeconds(fps, fps)).toBe(1);
    expect(framesToSeconds(90 * fps, fps)).toBe(90);
  });

  test("a time shows the last frame that starts at or before it", () => {
    expect(secondsToFrames(0, 24)).toBe(0);
    expect(secondsToFrames(1 / 24, 24)).toBe(1);
    expect(secondsToFrames(0.08, 24)).toBe(1); // 1.92 frames in
    expect(secondsToFrames(5.04, 24)).toBe(120); // 120.96
    expect(secondsToFrames(0.999, 30)).toBe(29); // 29.97
    expect(secondsToFrames(10, 25)).toBe(250);
  });

  test("float error doesn't lose a frame", () => {
    expect(secondsToFrames(4.9999999, 24)).toBe(120);
    // 29 / 25 is 1.16 s, and 1.16 × 25 is 28.999999999999996 in floating point.
    expect(secondsToFrames(29 / 25, 25)).toBe(29);
    // 123 / 30 is 4.1 s, and 4.1 × 30 is 122.99999999999999.
    expect(secondsToFrames(123 / 30, 30)).toBe(123);
  });

  test.each(RATES)("every frame survives a trip through seconds (%i fps)", (fps) => {
    fc.assert(
      fc.property(anyFrame(fps), (frames) => {
        expect(secondsToFrames(framesToSeconds(frames, fps), fps)).toBe(frames);
      }),
    );
  });
});

describe("microseconds and frames", () => {
  test("a frame starts at a whole microsecond, rounded to the nearest", () => {
    expect(framesToMicroseconds(0, 24)).toBe(0);
    expect(framesToMicroseconds(1, 24)).toBe(41_667); // 41,666.67
    expect(framesToMicroseconds(2, 24)).toBe(83_333); // 83,333.33
    expect(framesToMicroseconds(1, 25)).toBe(40_000);
    expect(framesToMicroseconds(1, 30)).toBe(33_333); // 33,333.33
    expect(framesToMicroseconds(2, 30)).toBe(66_667); // 66,666.67
  });

  test("ten hours of frames is exact", () => {
    expect(framesToMicroseconds(10 * HOUR * 24, 24)).toBe(36_000_000_000);
    expect(microsecondsToFrames(36_000_000_000, 30)).toBe(10 * HOUR * 30);
  });

  test("a timestamp up to 1 µs early still counts as its frame", () => {
    expect(microsecondsToFrames(83_333, 24)).toBe(2); // frame 2 starts at 83,333.33 µs
    expect(microsecondsToFrames(41_666, 24)).toBe(1); // frame 1's start, cut short
    expect(microsecondsToFrames(41_665, 24)).toBe(0);
    expect(microsecondsToFrames(999_999, 25)).toBe(25);
    expect(microsecondsToFrames(999_998, 25)).toBe(24);
  });

  test("any other time rounds down to the frame it falls in", () => {
    expect(microsecondsToFrames(5_040_000, 24)).toBe(120);
    expect(microsecondsToFrames(33_331, 30)).toBe(0); // 2.33 µs before frame 1
    expect(microsecondsToFrames(66_665, 30)).toBe(1); // 1.67 µs before frame 2
  });

  test.each(RATES)("every frame survives a trip through microseconds (%i fps)", (fps) => {
    fc.assert(
      fc.property(anyFrame(fps), (frames) => {
        expect(microsecondsToFrames(framesToMicroseconds(frames, fps), fps)).toBe(frames);
      }),
    );
  });
});

describe("an asset's length in frames", () => {
  test("is its duration, rounded down to whole frames at the project's rate", () => {
    expect(assetDurationFrames(videoAsset("05-wide", 5), 24)).toBe(120);
    expect(assetDurationFrames(videoAsset("05-wide", 5), 30)).toBe(150);
    // 150 frames at 29.97 fps last 5.005 s: 150.15 frames at 30 fps, so 150 whole ones.
    expect(assetDurationFrames(videoAsset("05-wide", 5.005), 30)).toBe(150);
    expect(assetDurationFrames(videoAsset("05-wide", 4.9999999), 24)).toBe(120);
  });

  test("is 0 for a source shorter than one frame", () => {
    expect(assetDurationFrames(videoAsset("blip", 0.03), 24)).toBe(0);
  });

  test("is 0 for a duration that isn't a real length, so no clip can use it", () => {
    expect(assetDurationFrames(videoAsset("broken", Number.NaN), 24)).toBe(0);
    expect(assetDurationFrames(videoAsset("broken", -5), 24)).toBe(0);
    expect(assetDurationFrames(videoAsset("broken", Infinity), 24)).toBe(0);
  });
});

describe("formatTimecode", () => {
  test.each<[number, Fps, string]>([
    [0, 24, "00:00:00:00"],
    [23, 24, "00:00:00:23"],
    [24, 24, "00:00:01:00"],
    [462, 24, "00:00:19:06"],
    [1_080, 24, "00:00:45:00"],
    [24 * 60, 24, "00:01:00:00"],
    [24 * HOUR - 1, 24, "00:59:59:23"],
    [24 * HOUR, 24, "01:00:00:00"],
    [24, 25, "00:00:00:24"],
    [25, 25, "00:00:01:00"],
    [25 * 59 + 24, 25, "00:00:59:24"],
    [29, 30, "00:00:00:29"],
    [30 * 61 + 7, 30, "00:01:01:07"],
    [30 * (2 * HOUR + 3 * 60 + 4) + 5, 30, "02:03:04:05"],
  ])("%i frames at %i fps is %s", (frames, fps, timecode) => {
    expect(formatTimecode(frames, fps)).toBe(timecode);
  });

  test("counts large values exactly, past 99 hours", () => {
    expect(formatTimecode(100 * HOUR * 30 - 1, 30)).toBe("99:59:59:29");
    expect(formatTimecode(100 * HOUR * 30, 30)).toBe("100:00:00:00");
    expect(formatTimecode(Number.MAX_SAFE_INTEGER, 24)).toBe("104249991374:19:01:07");
  });

  test("refuses a fractional or negative frame count", () => {
    expect(() => formatTimecode(1.5, 24)).toThrow(RangeError);
    expect(() => formatTimecode(-1, 24)).toThrow(RangeError);
    expect(() => formatTimecode(Number.NaN, 24)).toThrow(RangeError);
  });
});

describe("parseTimecode", () => {
  test("reads HH:MM:SS:FF", () => {
    expect(parseTimecode("00:00:19:06", 24)).toEqual({ ok: true, frames: 462 });
    expect(parseTimecode("00:00:00:24", 25)).toEqual({ ok: true, frames: 24 });
    expect(parseTimecode("01:00:00:00", 30)).toEqual({ ok: true, frames: 108_000 });
    expect(parseTimecode("100:00:00:00", 30)).toEqual({ ok: true, frames: 10_800_000 });
  });

  test("reads shorthand: leave out groups on the left, or a leading zero", () => {
    expect(parseTimecode("19:06", 24)).toEqual({ ok: true, frames: 462 });
    expect(parseTimecode("6", 24)).toEqual({ ok: true, frames: 6 });
    expect(parseTimecode("1:00:00", 24)).toEqual({ ok: true, frames: 1_440 });
    expect(parseTimecode("00:00:20:1", 24)).toEqual({ ok: true, frames: 481 });
    expect(parseTimecode("1:2:3:4", 25)).toEqual({ ok: true, frames: 25 * 3723 + 4 });
  });

  test("ignores spaces around the timecode", () => {
    expect(parseTimecode("  00:00:19:06\n", 24)).toEqual({ ok: true, frames: 462 });
  });

  test.each(RATES)("reads back every timecode formatTimecode writes (%i fps)", (fps) => {
    fc.assert(
      fc.property(anyFrame(fps), (frames) => {
        expect(parseTimecode(formatTimecode(frames, fps), fps)).toEqual({ ok: true, frames });
      }),
    );
  });

  describe("says how to write one when it can't read it", () => {
    const error = {
      ok: false,
      error: {
        code: "invalid-timecode",
        message: "Use HH:MM:SS:FF. Seconds go up to 59, frames up to 23.",
      },
    };

    test.each([
      ["", "nothing"],
      ["   ", "only spaces"],
      ["19 seconds", "words"],
      ["00:00:61:00", "seconds past 59"],
      ["00:60:00:00", "minutes past 59"],
      ["00:00:00:24", "frames past 23 at 24 fps"],
      ["00:00:00:00:00", "five groups"],
      ["00::19:06", "an empty group"],
      [":19:06", "a leading colon"],
      ["00:00:019:06", "three digits after the hours"],
      ["-00:00:01:00", "a negative time"],
      ["00:00:01:00.5", "a fraction"],
      ["00;00;19;06", "drop-frame separators"],
      ["1e3", "an exponent"],
      ["999999999999:00:00:00", "too many frames to count exactly"],
    ])("%j (%s)", (text) => {
      expect(parseTimecode(text, 24)).toEqual(error);
    });

    test("with the last frame number at the project's rate", () => {
      expect(parseTimecode("00:00:00:25", 25)).toEqual({
        ok: false,
        error: {
          code: "invalid-timecode",
          message: "Use HH:MM:SS:FF. Seconds go up to 59, frames up to 24.",
        },
      });
      expect(parseTimecode("00:00:00:30", 30)).toEqual({
        ok: false,
        error: {
          code: "invalid-timecode",
          message: "Use HH:MM:SS:FF. Seconds go up to 59, frames up to 29.",
        },
      });
    });
  });
});

describe("sourceFrameAt", () => {
  // 07-medium from 00:00:04:00 (frame 96), three seconds long, starting one second into its source.
  const clip: Clip = { id: "b", assetId: "07-medium", start: 96, in: 24, duration: 72 };

  test("a clip shows source frame in + (t − start)", () => {
    expect(sourceFrameAt(clip, 96)).toBe(24); // its first frame shows the in point
    expect(sourceFrameAt(clip, 100)).toBe(28);
    expect(sourceFrameAt(clip, 167)).toBe(95); // its last frame
  });

  test("shows nothing outside the clip", () => {
    expect(sourceFrameAt(clip, 95)).toBeNull();
    expect(sourceFrameAt(clip, 168)).toBeNull(); // where the clip ends, the next one can start
  });
});
