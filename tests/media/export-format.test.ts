import { describe, expect, test } from "vitest";
import {
  chooseFormat,
  type Encoders,
  estimateBytes,
  FORMATS,
  SIZES,
} from "../../src/media/export-format.ts";

const none: Encoders = { avc: false, aac: false, vp9: false, opus: false };

describe("chooseFormat", () => {
  // What each kind of browser answers when asked, stubbed: the choice never reads its name.
  test.each([
    ["Chrome or Edge: everything", { avc: true, aac: true, vp9: true, opus: true }, "mp4"],
    ["Safari: H.264 and AAC, no VP9", { avc: true, aac: true, vp9: false, opus: true }, "mp4"],
    [
      "H.264 but no AAC, as in Firefox: WebM",
      { avc: true, aac: false, vp9: true, opus: true },
      "webm",
    ],
    ["no H.264 encoder: WebM", { avc: false, aac: true, vp9: true, opus: true }, "webm"],
    [
      "VP9 without Opus, and H.264 without AAC: nothing",
      { avc: true, aac: false, vp9: true, opus: false },
      null,
    ],
    ["audio encoders only: nothing", { avc: false, aac: true, vp9: false, opus: true }, null],
    ["no encoders at all: nothing", none, null],
  ] satisfies [string, Encoders, string | null][])("%s", (_, encoders, format) => {
    expect(chooseFormat(encoders, true)).toBe(format);
  });

  test("a cut without music needs only a video encoder", () => {
    expect(chooseFormat({ ...none, avc: true }, false)).toBe("mp4");
    expect(chooseFormat({ ...none, vp9: true }, false)).toBe("webm");
    expect(chooseFormat({ ...none, aac: true, opus: true }, false)).toBeNull();
  });

  test("MP4 is H.264 and AAC; WebM is VP9 and Opus", () => {
    expect(FORMATS.mp4).toMatchObject({ video: "avc", audio: "aac", extension: "mp4" });
    expect(FORMATS.webm).toMatchObject({ video: "vp9", audio: "opus", extension: "webm" });
  });
});

describe("estimateBytes", () => {
  test("the robot story at 1080p: (6.5 Mbit/s + 160 kbit/s) × 45 s, about 37.5 MB", () => {
    expect(estimateBytes("mp4", "1080p", 45, true)).toBe(37_462_500);
  });

  test("720p at 3 Mbit/s, WebM's Opus at 128 kbit/s", () => {
    expect(estimateBytes("webm", "720p", 45, true)).toBe(17_595_000);
  });

  test("a cut without music has no audio track to count", () => {
    expect(estimateBytes("mp4", "1080p", 45, false)).toBe(36_562_500);
  });

  test("the sizes are 1920 × 1080 and 1280 × 720", () => {
    expect(SIZES["1080p"]).toMatchObject({ width: 1920, height: 1080 });
    expect(SIZES["720p"]).toMatchObject({ width: 1280, height: 720 });
  });
});
