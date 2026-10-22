// What an export makes (spec section 3.4): its size, its format, and the
// file's estimated size. The format comes from asking the browser what it can encode, never from
// its name: MP4 (H.264 video, AAC audio) where both encode, else WebM (VP9 video, Opus audio)
// where both do, else no export here. The bitrates are fixed per size, so the estimate holds.
// Pure, so the dialog, the worker and the tests share it.

export type ExportSize = "1080p" | "720p";

export interface SizeSpec {
  width: number;
  height: number;
  /** The video's bitrate, in bits per second. */
  videoBitrate: number;
}

export const SIZES: Record<ExportSize, SizeSpec> = {
  "1080p": { width: 1920, height: 1080, videoBitrate: 6_500_000 },
  "720p": { width: 1280, height: 720, videoBitrate: 3_000_000 },
};

export type ExportFormat = "mp4" | "webm";

export interface FormatSpec {
  /** Mediabunny's names for the codecs. */
  video: "avc" | "vp9";
  audio: "aac" | "opus";
  /** The audio's bitrate, in bits per second. */
  audioBitrate: number;
  extension: string;
  mimeType: string;
  /** What the dialog's Format row says. */
  label: string;
}

export const FORMATS: Record<ExportFormat, FormatSpec> = {
  mp4: {
    video: "avc",
    audio: "aac",
    audioBitrate: 160_000,
    extension: "mp4",
    mimeType: "video/mp4",
    label: "MP4 · H.264 video, AAC audio",
  },
  webm: {
    video: "vp9",
    audio: "opus",
    audioBitrate: 128_000,
    extension: "webm",
    mimeType: "video/webm",
    label: "WebM · VP9 video, Opus audio",
  },
};

/**
 * The music's mix: 48 kHz stereo, which AAC and Opus both take, with a whole number of samples
 * per frame at 24, 25 and 30 fps (2,000, 1,920 and 1,600).
 */
export const MIX_SAMPLE_RATE = 48_000;
export const MIX_CHANNELS = 2;

/** Which codecs this browser encodes at a size and its bitrate, as the export worker asks it. */
export interface Encoders {
  avc: boolean;
  aac: boolean;
  vp9: boolean;
  opus: boolean;
}

/**
 * The format to export: MP4 where H.264 and AAC both encode, else WebM where VP9 and Opus both
 * do, else null (no export here). A cut without music has no audio track, so only its video
 * codec counts.
 */
export function chooseFormat(encoders: Encoders, hasAudio: boolean): ExportFormat | null {
  if (encoders.avc && (encoders.aac || !hasAudio)) return "mp4";
  if (encoders.vp9 && (encoders.opus || !hasAudio)) return "webm";
  return null;
}

/** The file's size in bytes: (video + audio bitrate) × length. Containers add well under 1 %. */
export function estimateBytes(
  format: ExportFormat,
  size: ExportSize,
  durationSec: number,
  hasAudio: boolean,
): number {
  const bitrate = SIZES[size].videoBitrate + (hasAudio ? FORMATS[format].audioBitrate : 0);
  return Math.round((bitrate * durationSec) / 8);
}
