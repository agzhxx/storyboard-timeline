// The export dialog's words and numbers (Export boards): the format, sizes in megabytes as Finder
// counts them (1 MB is a million bytes), the file's name from the project's, the time left, how
// fast the export ran against the cut's length, the output check's result, and why an export
// stopped. Pure, for the tests.

import { formatTimecode, secondsToFrames } from "../engine/time.ts";
import type { Asset, Fps, Frames } from "../engine/types.ts";
import type { OutputCheck } from "../media/export-check.ts";
import {
  type Encoders,
  type ExportFormat,
  type ExportSize,
  SIZES,
} from "../media/export-format.ts";
import type { ExportFailure } from "../media/export-protocol.ts";

const count = new Intl.NumberFormat("en-US");

const CODEC_NAMES: Record<ExportFormat, { container: string; video: string; audio: string }> = {
  mp4: { container: "MP4", video: "H.264", audio: "AAC" },
  webm: { container: "WebM", video: "VP9", audio: "Opus" },
};

/** "MP4 · H.264 video, AAC audio"; without music, "MP4 · H.264 video". */
export function formatLabel(format: ExportFormat, hasAudio: boolean): string {
  const { container, video, audio } = CODEC_NAMES[format];
  return `${container} · ${video} video${hasAudio ? `, ${audio} audio` : ""}`;
}

/** "MP4", "WebM": the container's name, as in "Export WebM". */
export function containerName(format: ExportFormat): string {
  return CODEC_NAMES[format].container;
}

/** "1920 × 1080". */
export function dimensions(size: ExportSize): string {
  return `${SIZES[size].width} × ${SIZES[size].height}`;
}

/** "About 37 MB", or "About 1.2 MB" under 10 MB, for the estimate. */
export function aboutSize(bytes: number): string {
  const megabytes = bytes / 1e6;
  return `About ${megabytes < 9.95 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

/** "38.2 MB", for the file that was made; "25 KB" under a megabyte. */
export function fileSize(bytes: number): string {
  if (bytes < 999_500) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/**
 * The file's name: the project's, in lower case, with every run of other characters than letters
 * and digits as one hyphen: "The robot story" → "the-robot-story.mp4". Letters of any script stay.
 */
export function fileName(projectName: string, extension: string): string {
  const stem = projectName
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return `${stem === "" ? "untitled-project" : stem}.${extension}`;
}

/** "Frame 691 of 1,080": a frame's position in the cut, counted from 0 like its timecode. */
export function frameOf(frame: Frames, frames: Frames): string {
  return `Frame ${count.format(frame)} of ${count.format(frames)}`;
}

/** "About 8 s left", "About 2 min left"; "Starting…" before there's an estimate. */
export function timeLeftText(seconds: number | null): string {
  if (seconds === null) return "Starting…";
  if (seconds < 59.5) return `About ${Math.max(1, Math.round(seconds))} s left`;
  return `About ${Math.round(seconds / 60)} min left`;
}

/** "21.4 s", or "1 min 32 s" from a minute on. */
function duration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 59.95) return `${seconds.toFixed(1)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

/** "Exported in 21.4 s, 2.1× faster than real time": the cut's length over the time it took. */
export function speedText(elapsedMs: number, cutSec: number): string {
  const speed = Math.round((cutSec / (elapsedMs / 1000)) * 10) / 10;
  const pace =
    speed > 1
      ? `${speed.toFixed(1)}× faster than real time`
      : speed === 1
        ? "as fast as real time"
        : `${speed.toFixed(1)}× real time`;
  return `Exported in ${duration(elapsedMs)}, ${pace}`;
}

/** The done screen's line under the file: what the output check found. */
export function checkText(check: OutputCheck, frames: Frames, fps: Fps): string {
  if (check.ok) return "Checked: first and last frames decode; length matches the cut";
  if (!check.firstFrame) return "Check failed: its first frame doesn't decode";
  if (!check.lastFrame) return "Check failed: its last frame doesn't decode";
  if (check.durationSec === null) return "Check failed: its length couldn't be read";
  const length = formatTimecode(secondsToFrames(check.durationSec, fps), fps);
  return `Check failed: it's ${length} long, and the cut is ${formatTimecode(frames, fps)}`;
}

/** The perf overlay's debug line: "ok · 45.000 s of 45.000 s". */
export function checkLine(check: OutputCheck, frames: Frames, fps: Fps): string {
  const failed = [
    check.firstFrame ? null : "first frame",
    check.lastFrame ? null : "last frame",
    check.lengthMatches ? null : "length",
  ].filter((part) => part !== null);
  const length = check.durationSec === null ? "?" : check.durationSec.toFixed(3);
  const verdict = failed.length === 0 ? "ok" : `failed: ${failed.join(", ")}`;
  return `${verdict} · ${length} s of ${(frames / fps).toFixed(3)} s`;
}

/** What the export was making, for the words about why it stopped. */
export interface Made {
  size: ExportSize;
  fps: Fps;
  frames: Frames;
  /** The asset whose media failed, when one did. */
  asset: Asset | null;
}

/**
 * The failed dialog's sentence, as parts: what stopped and where, the frame's timecode (shown in
 * the monospace font), and the details for a bug report.
 */
export function failureParts(
  failure: Exclude<ExportFailure, { kind: "unreachable" }>,
  made: Made,
): { lead: string; timecode: string | null; details: string } {
  const at = (frame: Frames) => `frame ${count.format(frame)} of ${count.format(made.frames)}`;
  switch (failure.kind) {
    case "encoder": {
      const what = failure.track === "video" ? "video" : "audio";
      const settings =
        failure.track === "video" ? `${dimensions(made.size)} · ${made.fps} fps` : "48 kHz stereo";
      return {
        lead: `The ${what} encoder stopped at frame ${count.format(failure.frame)}`,
        timecode: formatTimecode(failure.frame, made.fps),
        details: `${failure.message}\n${failure.codec} · ${settings} · ${at(failure.frame)}`,
      };
    }
    case "decode": {
      const name = made.asset?.name ?? "A clip";
      return {
        lead: `${name} couldn't be decoded at frame ${count.format(failure.frame)}`,
        timecode: formatTimecode(failure.frame, made.fps),
        details: `${failure.message}\n${name} · ${origin(made.asset)} · ${at(failure.frame)}`,
      };
    }
    case "output":
      return { lead: "The file couldn't be finished", timecode: null, details: failure.message };
    case "music": {
      const name = made.asset?.name ?? "The music";
      const what = failure.reason === "unreadable" ? "read" : "decoded";
      return {
        lead: `${name} couldn't be ${what}`,
        timecode: null,
        details: `${name} · ${origin(made.asset)} · couldn't be ${what}`,
      };
    }
  }
}

function origin(asset: Asset | null): string {
  switch (asset?.source.type) {
    case "feed":
      return "from the Feed";
    case "file":
      return "from My files";
    case "url":
      return "comes with the app";
    case undefined:
      return "not in the project";
  }
}

/** The toast for media that didn't load: "Export stopped: 07-medium couldn't be read…" */
export function stoppedText(asset: Asset | null): string {
  const name = asset?.name ?? "A clip";
  const from = asset?.source.type === "feed" ? " from the Feed" : "";
  return `Export stopped: ${name} couldn't be read${from}. Check your connection, then try again.`;
}

/** Why the film will be WebM: the board's note when H.264 is missing, or AAC's when only it is. */
export function webmNote(encoders: Encoders): string {
  const missing = encoders.avc ? "MP4's AAC audio" : "MP4 (H.264)";
  const codec = encoders.avc ? "AAC" : "H.264";
  return (
    `This browser can't encode ${missing}, so the film will be WebM. Most players open it. ` +
    `For an MP4, export in a browser that can encode ${codec}, such as Chrome or Edge.`
  );
}

/** Why there's no export at a size: neither format encodes here. */
export function noFormatNote(size: ExportSize): string {
  const instead = size === "1080p" ? "Try 720p, or export" : "Export";
  return (
    `This browser can't encode MP4 or WebM at ${dimensions(size)}. ` +
    `${instead} in a current Chrome, Edge, Safari or Firefox.`
  );
}
