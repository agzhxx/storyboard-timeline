import { describe, expect, test } from "vitest";
import { audioCodecName, cantOpenMessage, isHighBitDepth } from "../../src/media/codecs.ts";

/** The message for a video the browser said it can't decode. */
function video(
  codec: string | null,
  codecString: string | null,
  more: { containerCodec?: string; decodesHevc?: boolean } = {},
) {
  return cantOpenMessage({ kind: "video", codec, codecString, containerCodec: null, ...more });
}

const HEVC =
  "Can't open this file in this browser: it's HEVC (H.265) video. Convert it to H.264 and add it again.";
const TEN_BIT = "Can't open this file in this browser: 10-bit video isn't supported here.";

describe("isHighBitDepth reads the bit depth from the codec string", () => {
  test.each([
    ["avc1.6E0028", true], // High 10
    ["avc1.7A0028", true], // High 4:2:2
    ["avc1.F40028", true], // High 4:4:4 Predictive
    ["avc1.640028", false], // High
    ["avc1.42E01E", false], // Baseline
    ["avc3.6e0028", true],
    ["hvc1.2.4.L120.B0", true], // Main 10
    ["hev1.A2.4.L120.B0", true],
    ["hvc1.1.6.L93.B0", false], // Main
    ["vp09.02.10.10.01.09.16.09.01", true], // profile 2
    ["vp09.00.10.10", true], // a 10-bit depth field
    ["vp09.00.10.08", false],
    ["av01.0.04M.10", true],
    ["av01.0.08M.08", false],
    ["vp8", false],
    ["", false],
  ])("%s → %s", (codecString, expected) => {
    expect(isHighBitDepth(codecString)).toBe(expected);
  });
});

describe("cantOpenMessage", () => {
  test("HEVC gets the HEVC message, whatever its profile", () => {
    expect(video("hevc", "hvc1.1.6.L93.B0")).toBe(HEVC);
    expect(video("hevc", "hev1.2.4.L120.B0")).toBe(HEVC);
    // Known from the codec string alone too.
    expect(video(null, "hvc1.1.6.L93.B0")).toBe(HEVC);
  });

  test("10-bit HEVC gets the 10-bit message where 8-bit HEVC decodes", () => {
    expect(video("hevc", "hvc1.2.4.L120.B0", { decodesHevc: true })).toBe(TEN_BIT);
    expect(video("hevc", "hvc1.2.4.L120.B0", { decodesHevc: false })).toBe(HEVC);
    expect(video("hevc", "hvc1.1.6.L93.B0", { decodesHevc: true })).toBe(HEVC);
  });

  test("10-bit H.264, VP9 and AV1 get the 10-bit message", () => {
    expect(video("avc", "avc1.6E0028")).toBe(TEN_BIT);
    expect(video("vp9", "vp09.02.10.10")).toBe(TEN_BIT);
    expect(video("av1", "av01.0.04M.10")).toBe(TEN_BIT);
  });

  test("other codecs are named, with what to do", () => {
    expect(video("prores", "apcn")).toBe(
      "Can't open this file in this browser: it's Apple ProRes video. Convert it to H.264 and add it again.",
    );
    expect(video("av1", "av01.0.04M.08")).toBe(
      "Can't open this file in this browser: it's AV1 video. Convert it to H.264 and add it again.",
    );
    expect(video("vp8", "vp8")).toContain("it's VP8 video.");
    expect(video("vp9", "vp09.00.10.08")).toContain("it's VP9 video.");
  });

  test("8-bit H.264 that doesn't decode points at the browser", () => {
    expect(video("avc", "avc1.640028")).toBe(
      "Can't open this file in this browser: H.264 video doesn't decode here. Try another browser.",
    );
  });

  test("a codec Mediabunny doesn't know is named by the container", () => {
    expect(video(null, null, { containerCodec: "mp4v" })).toBe(
      "Can't open this file in this browser: its video codec, mp4v, doesn't decode here. Convert it to H.264 and add it again.",
    );
    expect(video(null, null)).toBe(
      "Can't open this file in this browser: its video codec doesn't decode here. Convert it to H.264 and add it again.",
    );
  });

  test("a file that isn't media, is damaged or whose first frame won't decode says so", () => {
    expect(cantOpenMessage({ kind: "not-media" })).toBe(
      "Can't open this file: there's no video or audio in it.",
    );
    expect(cantOpenMessage({ kind: "damaged" })).toBe(
      "Can't open this file: it looks damaged. Export it again and add it.",
    );
    expect(cantOpenMessage({ kind: "first-frame" })).toBe(
      "Can't open this file in this browser: its first frame won't decode. The file may be damaged; export it again and add it.",
    );
  });

  test("audio names its codec: convert the unusual ones, try another browser for the usual", () => {
    expect(cantOpenMessage({ kind: "audio", codec: "ac3" })).toBe(
      "Can't open this file in this browser: it's Dolby Digital (AC-3) audio, which doesn't decode here. Convert it to MP3 or AAC and add it again.",
    );
    expect(cantOpenMessage({ kind: "audio", codec: "aac" })).toBe(
      "Can't open this file in this browser: it's AAC audio, which doesn't decode here. Try another browser.",
    );
    expect(cantOpenMessage({ kind: "audio", codec: "pcm-s24" })).toContain("it's PCM audio");
    expect(cantOpenMessage({ kind: "audio", codec: null })).toBe(
      "Can't open this file in this browser: its audio codec doesn't decode here. Convert it to MP3 or AAC and add it again.",
    );
  });
});

test("audioCodecName calls every kind of raw samples PCM", () => {
  expect(audioCodecName("pcm-s16")).toBe("PCM");
  expect(audioCodecName("pcm-f32be")).toBe("PCM");
  expect(audioCodecName("mp3")).toBe("MP3");
  expect(audioCodecName("opus")).toBe("Opus");
  expect(audioCodecName("speex")).toBeUndefined();
});
