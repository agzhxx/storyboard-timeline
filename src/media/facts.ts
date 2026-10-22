// What the import learns about a file (spec section 4.5), and the line a bin row shows for it:
// "0:05 · 1920 × 1080 · 24 fps" for a video, "0:48 · MP3 · stereo" for music.

import { audioCodecName } from "./codecs.ts";

interface CommonFacts {
  /** Where the track ends, in seconds. */
  durationSec: number;
  /** Mediabunny's name for the container: "MP4", "QuickTime File Format", "WebM", "MP3", "WAVE". */
  container: string;
  /** Mediabunny's name for the codec ("avc", "aac", "pcm-s16"…), if it knows it. */
  codec: string | null;
}

export interface VideoFacts extends CommonFacts {
  kind: "video";
  /** As displayed: after the pixel aspect ratio and rotation. */
  width: number;
  height: number;
  /** Measured from the frames' timestamps; null when they follow no steady rate. */
  fps: number | null;
}

export interface AudioFacts extends CommonFacts {
  kind: "audio";
  channels: number;
  sampleRate: number;
}

/** A file's media: its video, whose own sound is left out (a spec non-goal), or its audio. */
export type MediaFacts = VideoFacts | AudioFacts;

/** "0:05", "12:30", "1:02:03": a length rounded to the second. */
export function formatLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const ss = String(whole % 60).padStart(2, "0");
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}:${ss}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${ss}`;
}

/** "24 fps", "23.98 fps", "29.97 fps": two decimals at most. */
export function formatFps(fps: number): string {
  return `${Number(fps.toFixed(2))} fps`;
}

/** "mono", "stereo", "5.1", "4 channels". */
export function channelsLabel(channels: number): string {
  if (channels === 1) return "mono";
  if (channels === 2) return "stereo";
  return channels === 6 ? "5.1" : `${channels} channels`;
}

/** What a person calls an audio file's format: "MP3", "AAC", "WAV" for PCM in a WAVE file. */
export function audioFormatLabel({ codec, container }: Pick<AudioFacts, "codec" | "container">) {
  const name = codec === null ? undefined : audioCodecName(codec);
  if (name === "PCM" && container === "WAVE") return "WAV";
  return name ?? container;
}

/** A bin row's second line. */
export function metaLine(facts: MediaFacts): string {
  const length = formatLength(facts.durationSec);
  if (facts.kind === "audio") {
    return `${length} · ${audioFormatLabel(facts)} · ${channelsLabel(facts.channels)}`;
  }
  const size = `${facts.width} × ${facts.height}`;
  return facts.fps === null
    ? `${length} · ${size}`
    : `${length} · ${size} · ${formatFps(facts.fps)}`;
}
