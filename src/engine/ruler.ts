// The ruler's spacing (spec section 4.4): minor ticks about 24 px apart and a timecode wherever
// one fits, so labels never collide at any zoom. Both steps come from one list of round times, so
// labels land on equal parts of a second, whole seconds or minutes, and always on a tick.

import type { Fps, Frames } from "./types.ts";

/** Minor ticks are at least this far apart, in pixels. */
export const MIN_TICK_GAP_PX = 24;

/**
 * Labels are at least this far apart, in pixels: an `HH:MM:SS:FF` label is about 73 px wide in
 * the 11 px monospace font and starts 4 px right of its tick, and the next one needs a gap.
 */
export const MIN_LABEL_GAP_PX = 84;

/**
 * Steps shorter than a second, in frames. Each splits a second into equal parts, and the list
 * leaves out the ones that would label odd fractions: at 24 fps, labels every 4 frames (sixths of
 * a second) read worse than every 6 (quarters).
 */
const SUB_SECOND_STEPS: Record<Fps, readonly Frames[]> = {
  24: [1, 2, 3, 6, 12],
  25: [1, 5],
  30: [1, 2, 3, 5, 6, 10, 15],
};

/** Steps of a second or more, in seconds. Each one divides the last, 10 hours. */
const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 36000];

export interface RulerSteps {
  /** Frames between minor ticks. */
  tick: Frames;
  /** Frames between labels, each on a major tick: a multiple of `tick`. */
  label: Frames;
}

/**
 * The ruler's steps at a zoom: the shortest round step whose ticks are 24 px apart, and the
 * shortest multiple of it whose labels are 84 px apart. Designed cases: at 24 fps, 2 px per frame
 * gives a tick every 12 frames and a label every 48 (2 s); 24 px per frame, a tick per frame and a
 * label every 6.
 */
export function rulerSteps(pxPerFrame: number, fps: Fps): RulerSteps {
  if (!(pxPerFrame > 0)) throw new RangeError(`The zoom must be above 0, not ${pxPerFrame}`);
  const steps = [...SUB_SECOND_STEPS[fps], ...SECOND_STEPS.map((seconds) => seconds * fps)];
  const tick = shortest(steps, (step) => step * pxPerFrame >= MIN_TICK_GAP_PX);
  const label = shortest(
    steps,
    (step) => step % tick === 0 && step * pxPerFrame >= MIN_LABEL_GAP_PX,
  );
  return { tick, label };
}

/** The first step that fits, or past the list, the longest step doubled until one does. */
function shortest(steps: readonly Frames[], fits: (step: Frames) => boolean): Frames {
  const found = steps.find(fits);
  if (found !== undefined) return found;
  let step = steps.at(-1) ?? 1;
  while (!fits(step)) step *= 2;
  return step;
}
