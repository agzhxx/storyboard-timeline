// Why a file can't be opened in this browser. Whether it can is asked of
// the browser itself, never read from its name: the import worker asks Mediabunny's canDecode()
// and decodes a first frame, and the main thread decodes audio the way playback will. When the
// answer is no, these functions explain it from what the file holds: its codec, and the profile
// and bit depth in its codec string. Pure, so the worker and the tests share them.

/** A video track the browser can't decode, as Mediabunny reads it. */
export interface UndecodableVideo {
  /** Mediabunny's name for the codec ("avc", "hevc", "vp9", "av1", "vp8", "prores"), if known. */
  codec: string | null;
  /** The full codec string, such as "avc1.64001f" or "hvc1.2.4.L120.B0", if known. */
  codecString: string | null;
  /** What the container calls a codec Mediabunny doesn't know, such as "mp4v". */
  containerCodec: string | null;
  /**
   * For a 10-bit HEVC file: whether this browser decodes 8-bit HEVC. If it does, 10-bit is the
   * problem; if it doesn't, HEVC is, and converting to H.264 is the fix.
   */
  decodesHevc?: boolean;
}

/** An audio track `decodeAudioData` refused, as Mediabunny reads it. */
export interface UndecodableAudio {
  codec: string | null;
}

/** Why a file can't be opened. */
export type CantOpen =
  | { kind: "not-media" }
  | { kind: "damaged" }
  | ({ kind: "video" } & UndecodableVideo)
  | { kind: "first-frame" }
  | ({ kind: "audio" } & UndecodableAudio);

const IN_THIS_BROWSER = "Can't open this file in this browser:";
const TO_H264 = "Convert it to H.264 and add it again.";

/** The message a file's row in the media bin shows. */
export function cantOpenMessage(problem: CantOpen): string {
  switch (problem.kind) {
    case "not-media":
      return "Can't open this file: there's no video or audio in it.";
    case "damaged":
      return "Can't open this file: it looks damaged. Export it again and add it.";
    case "video":
      return videoMessage(problem);
    case "first-frame":
      return `${IN_THIS_BROWSER} its first frame won't decode. The file may be damaged; export it again and add it.`;
    case "audio":
      return audioMessage(problem);
  }
}

function videoMessage({ codec, codecString, containerCodec, decodesHevc }: UndecodableVideo) {
  const hevc = codec === "hevc" || /^(hvc1|hev1)\./.test(codecString ?? "");
  const highBitDepth = codecString !== null && isHighBitDepth(codecString);
  if (hevc && !(highBitDepth && decodesHevc === true)) {
    return `${IN_THIS_BROWSER} it's HEVC (H.265) video. ${TO_H264}`;
  }
  if (highBitDepth) return `${IN_THIS_BROWSER} 10-bit video isn't supported here.`;
  if (codec === "avc")
    return `${IN_THIS_BROWSER} H.264 video doesn't decode here. Try another browser.`;
  const name = codec === null ? undefined : VIDEO_CODEC_NAMES[codec];
  if (name !== undefined) return `${IN_THIS_BROWSER} it's ${name} video. ${TO_H264}`;
  const unknown = codec ?? containerCodec;
  return unknown === null
    ? `${IN_THIS_BROWSER} its video codec doesn't decode here. ${TO_H264}`
    : `${IN_THIS_BROWSER} its video codec, ${unknown}, doesn't decode here. ${TO_H264}`;
}

function audioMessage({ codec }: UndecodableAudio) {
  const name = codec === null ? undefined : audioCodecName(codec);
  if (name === undefined) {
    return `${IN_THIS_BROWSER} its audio codec doesn't decode here. Convert it to MP3 or AAC and add it again.`;
  }
  // The formats the bin asks for should decode everywhere; when one doesn't, the browser is why.
  const advice = SUPPORTED_AUDIO.has(name)
    ? "Try another browser."
    : "Convert it to MP3 or AAC and add it again.";
  return `${IN_THIS_BROWSER} it's ${name} audio, which doesn't decode here. ${advice}`;
}

const VIDEO_CODEC_NAMES: Record<string, string | undefined> = {
  avc: "H.264",
  hevc: "HEVC (H.265)",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  prores: "Apple ProRes",
};

const AUDIO_CODEC_NAMES: Record<string, string | undefined> = {
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC",
  ac3: "Dolby Digital (AC-3)",
  eac3: "Dolby Digital Plus (E-AC-3)",
  dts: "DTS",
  ulaw: "μ-law",
  alaw: "A-law",
};

/** The names of the audio formats the bin accepts: MP3, M4A (AAC) and WAV (PCM). */
const SUPPORTED_AUDIO = new Set(["MP3", "AAC", "PCM"]);

/** A person's name for an audio codec: "AAC", "Opus", "PCM" for every kind of raw samples. */
export function audioCodecName(codec: string): string | undefined {
  return codec.startsWith("pcm-") ? "PCM" : AUDIO_CODEC_NAMES[codec];
}

/**
 * Whether a codec string asks for more than 8 bits per sample: H.264's High 10, High 4:2:2 and
 * High 4:4:4 profiles (avc1.6E…, 7A…, F4…), HEVC Main 10 (hvc1.2…), VP9 profiles 2 and 3 or a bit
 * depth over 8 (vp09.02.10.10), and AV1 with a bit depth over 8 (av01.0.04M.10).
 */
export function isHighBitDepth(codecString: string): boolean {
  const [fourcc, ...fields] = codecString.split(".");
  switch (fourcc) {
    case "avc1":
    case "avc3": {
      const profile = Number.parseInt(fields[0]?.slice(0, 2) ?? "", 16);
      return profile === 110 || profile === 122 || profile === 244;
    }
    case "hvc1":
    case "hev1": {
      // The profile can follow a profile-space letter (A, B or C).
      const profile = /^[A-C]?(\d+)$/i.exec(fields[0] ?? "")?.[1];
      return profile === "2";
    }
    case "vp09":
      return Number(fields[0]) >= 2 || Number(fields[2]) > 8;
    case "av01":
      return Number(fields[2]) > 8;
    default:
      return false;
  }
}
