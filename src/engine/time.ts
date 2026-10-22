// The time model (spec section 4.2). The timeline counts whole frames at the project's rate.
// Seconds (Mediabunny) and microseconds (WebCodecs) appear only at the decode and export
// boundary, and every conversion between them happens here.

import type { Asset, Clip, Fps, Frames } from "./types.ts";

const MICROSECONDS_PER_SECOND = 1_000_000;

/**
 * A time this many microseconds before a frame starts still counts as that frame. Frames at 24
 * and 30 fps start between whole microseconds (frame 1 at 24 fps starts at 41,666.67 µs), so a
 * timestamp rounded to whole microseconds can be up to 1 µs early, and float math adds its own
 * tiny error: 1.16 s × 25 is 28.999999999999996, not 29.
 */
const TOLERANCE_US = 1;

/**
 * How far float error can push a position in frames that was worked out from pixels, such as
 * `x / pxPerFrame` at 3 px per frame: far below any real difference between two positions.
 */
export const FRAME_TOLERANCE = 1e-9;

/**
 * The frame a position in frames falls in, such as `x / pxPerFrame` under the pointer: rounded
 * down like every time, with `FRAME_TOLERANCE` for float error. At 1.1 px per frame, a pointer
 * at 3.3 px is on frame 3, though 3.3 / 1.1 is 2.9999999999999996.
 */
export function floorToFrame(position: number): Frames {
  return Math.floor(position + FRAME_TOLERANCE);
}

/** Where a frame starts, in seconds. */
export function framesToSeconds(frames: Frames, fps: Fps): number {
  return frames / fps;
}

/** The frame showing at a time in seconds: the last one that starts at or before it. */
export function secondsToFrames(seconds: number, fps: Fps): Frames {
  return microsecondsToFrames(seconds * MICROSECONDS_PER_SECOND, fps);
}

/** Where a frame starts, in whole microseconds (WebCodecs timestamps), rounded to the nearest. */
export function framesToMicroseconds(frames: Frames, fps: Fps): number {
  return Math.round((frames * MICROSECONDS_PER_SECOND) / fps);
}

/** The frame showing at a time in microseconds: the last one that starts at or before it. */
export function microsecondsToFrames(microseconds: number, fps: Fps): Frames {
  return Math.floor(((microseconds + TOLERANCE_US) * fps) / MICROSECONDS_PER_SECOND);
}

/** The rates a project can have, fastest first, so a tie goes to the faster one. */
const PROJECT_RATES: readonly Fps[] = [30, 25, 24];

/**
 * The project rate for a source's frame rate, such as the first video placed on an empty project:
 * the nearest of 24, 25 and 30, a tie going to the faster one. A high rate is halved first, until
 * it's 45 or less, since it shows every second frame of a rate the project can have: 50 → 25,
 * 59.94 → 29.97 → 30, 120 → 30. So 23.976 → 24 and 29.97 → 30. Null when the rate isn't a real
 * one (0, negative, NaN, infinite).
 */
export function projectRateFor(sourceFps: number): Fps | null {
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) return null;
  let rate = sourceFps;
  while (rate > 45) rate /= 2;
  let best: Fps = 30;
  for (const candidate of PROJECT_RATES) {
    if (Math.abs(rate - candidate) < Math.abs(rate - best)) best = candidate;
  }
  return best;
}

/**
 * How many whole frames of an asset's source a clip can use at the project's rate. A duration
 * that isn't a real length (NaN, negative, infinite) gives 0, so no clip can use the asset.
 */
export function assetDurationFrames(asset: Asset, fps: Fps): Frames {
  const frames = secondsToFrames(asset.durationSec, fps);
  return Number.isSafeInteger(frames) && frames > 0 ? frames : 0;
}

/**
 * `HH:MM:SS:FF`, non-drop-frame (24, 25 and 30 fps are whole rates), computed with integers
 * only. Hours grow past two digits if they must.
 */
export function formatTimecode(frames: Frames, fps: Fps): string {
  if (!Number.isSafeInteger(frames) || frames < 0) {
    throw new RangeError(`A timecode needs a whole, non-negative number of frames, not ${frames}`);
  }
  const ff = frames % fps;
  const totalSeconds = (frames - ff) / fps;
  const ss = totalSeconds % 60;
  const totalMinutes = (totalSeconds - ss) / 60;
  const mm = totalMinutes % 60;
  const hh = (totalMinutes - mm) / 60;
  return [hh, mm, ss, ff].map((part) => String(part).padStart(2, "0")).join(":");
}

export type TimecodeResult =
  | { ok: true; frames: Frames }
  | { ok: false; error: { code: "invalid-timecode"; message: string } };

/** [[[HH:]MM:]SS:]FF: groups left out on the left are zero; hours can have any number of digits. */
const TIMECODE = /^(?:(?:(?:(\d+):)?(\d{1,2}):)?(\d{1,2}):)?(\d{1,2})$/;

/** Reads a timecode someone typed, such as `00:00:19:06` or just `19:06`. */
export function parseTimecode(text: string, fps: Fps): TimecodeResult {
  const match = TIMECODE.exec(text.trim());
  if (match) {
    const group = (index: number) => Number(match[index] ?? 0);
    const [hh, mm, ss, ff] = [group(1), group(2), group(3), group(4)];
    const frames = ((hh * 60 + mm) * 60 + ss) * fps + ff;
    if (mm < 60 && ss < 60 && ff < fps && Number.isSafeInteger(frames)) return { ok: true, frames };
  }
  return {
    ok: false,
    error: {
      code: "invalid-timecode",
      message: `Use HH:MM:SS:FF. Seconds go up to 59, frames up to ${fps - 1}.`,
    },
  };
}

/**
 * The source frame a clip shows at a timeline frame, `in + (frame − start)`, or null where the
 * clip isn't. It counts project frames into the source: `sourceSeconds` turns it into the source
 * time to decode, and the decoder shows the last source frame at or before that time.
 */
export function sourceFrameAt(clip: Clip, frame: Frames): Frames | null {
  const offset = frame - clip.start;
  return offset >= 0 && offset < clip.duration ? clip.in + offset : null;
}

/**
 * How late a source frame's stored time can be and still count as the frame at a time: 1 ms.
 * Containers store times in their own units, rounded: WebM in whole milliseconds, so at 24 and
 * 30 fps one frame in three is stored up to half a millisecond after it starts (frame 2 at 30 fps,
 * 66.67 ms, is stored as 67 ms), and units as coarse as QuickTime's 600 a second are up to
 * 0.83 ms off. Looked up at its time plus this, a frame is never mistaken for the one before it.
 * It's far below a frame's length, so it never shows the next frame early.
 */
export const SOURCE_TOLERANCE_US = 1000;

/** `SOURCE_TOLERANCE_US` in seconds, for Mediabunny's times. */
export const SOURCE_TOLERANCE_SEC = SOURCE_TOLERANCE_US / MICROSECONDS_PER_SECOND;

/**
 * Where to look a source frame up in its file, in seconds: where it starts, plus the tolerance
 * for rounded container times. The decoder returns the last frame that starts at or before it, so
 * a source at another rate than the project shows its nearest earlier frame.
 */
export function sourceSeconds(sourceFrame: Frames, fps: Fps): number {
  return sourceFrame / fps + SOURCE_TOLERANCE_SEC;
}
