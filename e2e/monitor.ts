// Reading the program monitor in the end-to-end tests: which frame of a frame-index fixture it
// shows, and the frame its timecode says.

// The functions passed to page.evaluate run in the page, with the DOM.
/// <reference lib="dom" />

import type { Page } from "@playwright/test";
import { playheadTimecode } from "./editor.ts";

/**
 * The frame index the monitor shows: the frame-index fixtures (frame-index.mp4, story-shot.mp4)
 * paint bit k of it as block k of a 4 × 2 grid, white for 1. -1 when the canvas can't be read.
 */
export function frameIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'section[aria-label="Program monitor"] canvas',
    );
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return -1;
    let index = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      const x = Math.floor((((bit % 4) + 0.5) * canvas.width) / 4);
      const y = Math.floor(((Math.floor(bit / 4) + 0.5) * canvas.height) / 2);
      const [luma = 0] = context.getImageData(x, y, 1, 1).data;
      if (luma > 128) index += 1 << bit;
    }
    return index;
  });
}

/** The frame the monitor's timecode shows, at 24 fps. */
export async function timecodeFrame(page: Page): Promise<number> {
  const text = (await playheadTimecode(page).textContent()) ?? "";
  const [hh = 0, mm = 0, ss = 0, ff = 0] = text.split(":").map(Number);
  return ((hh * 60 + mm) * 60 + ss) * 24 + ff;
}
