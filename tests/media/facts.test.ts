import { describe, expect, test } from "vitest";
import {
  audioFormatLabel,
  channelsLabel,
  formatFps,
  formatLength,
  metaLine,
} from "../../src/media/facts.ts";

describe("a bin row's meta line, as the board writes it", () => {
  test("a video: length, size and frame rate", () => {
    expect(
      metaLine({
        kind: "video",
        durationSec: 5,
        container: "MP4",
        codec: "avc",
        width: 1920,
        height: 1080,
        fps: 24,
      }),
    ).toBe("0:05 · 1920 × 1080 · 24 fps");
  });

  test("a video whose frames keep no steady rate leaves the rate out", () => {
    expect(
      metaLine({
        kind: "video",
        durationSec: 12.4,
        container: "MP4",
        codec: "avc",
        width: 1080,
        height: 1920,
        fps: null,
      }),
    ).toBe("0:12 · 1080 × 1920");
  });

  test("music: length, format and channels", () => {
    expect(
      metaLine({
        kind: "audio",
        durationSec: 48.2,
        container: "MP3",
        codec: "mp3",
        channels: 2,
        sampleRate: 44_100,
      }),
    ).toBe("0:48 · MP3 · stereo");
  });
});

test("lengths round to the second, with hours when there are some", () => {
  expect(formatLength(0)).toBe("0:00");
  expect(formatLength(4.6)).toBe("0:05");
  expect(formatLength(59.4)).toBe("0:59");
  expect(formatLength(750)).toBe("12:30");
  expect(formatLength(3_723)).toBe("1:02:03");
});

test("frame rates keep two decimals at most", () => {
  expect(formatFps(24)).toBe("24 fps");
  expect(formatFps(24_000 / 1_001)).toBe("23.98 fps");
  expect(formatFps(30_000 / 1_001)).toBe("29.97 fps");
  expect(formatFps(25)).toBe("25 fps");
});

test("channels in words", () => {
  expect(channelsLabel(1)).toBe("mono");
  expect(channelsLabel(2)).toBe("stereo");
  expect(channelsLabel(6)).toBe("5.1");
  expect(channelsLabel(4)).toBe("4 channels");
});

test("audio formats as people call them: WAV for PCM in a WAVE file", () => {
  expect(audioFormatLabel({ codec: "pcm-s16", container: "WAVE" })).toBe("WAV");
  expect(audioFormatLabel({ codec: "pcm-s16", container: "QuickTime File Format" })).toBe("PCM");
  expect(audioFormatLabel({ codec: "aac", container: "MP4" })).toBe("AAC");
  expect(audioFormatLabel({ codec: "opus", container: "WebM" })).toBe("Opus");
  expect(audioFormatLabel({ codec: null, container: "WAVE" })).toBe("WAVE");
});
