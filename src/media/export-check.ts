// The output check (spec section 4.7): once the file is made, the export worker decodes its first
// and last frames and measures how long its picture lasts. It passes when both frames decode and
// that length is the cut's, within one frame. (An AAC track ends a frame or two of silence later:
// AAC packets are 1,024 samples, and an encoder pads its last one.) Pure, so the worker's
// measurement and the dialog share it.

import type { Fps, Frames } from "../engine/types.ts";

/** What the worker read back from the finished file. */
export interface Measured {
  /** Its picture's length in seconds, its video track's; null when it couldn't be read. */
  durationSec: number | null;
  firstFrame: boolean;
  lastFrame: boolean;
}

export interface OutputCheck extends Measured {
  /** Its length is the cut's, within one frame. */
  lengthMatches: boolean;
  ok: boolean;
}

/** Float error in a container's seconds, far below a frame. */
const EPSILON_SEC = 1e-6;

export function compareOutput(measured: Measured, frames: Frames, fps: Fps): OutputCheck {
  const lengthMatches =
    measured.durationSec !== null &&
    Math.abs(measured.durationSec - frames / fps) <= 1 / fps + EPSILON_SEC;
  return {
    ...measured,
    lengthMatches,
    ok: measured.firstFrame && measured.lastFrame && lengthMatches,
  };
}
