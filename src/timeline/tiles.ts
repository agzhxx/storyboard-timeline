// Where a clip's filmstrip or waveform is drawn (spec section 4.4). A clip
// at 48 px per frame can be hundreds of thousands of pixels wide, past what any canvas can hold, so
// it's drawn in tiles: canvases 1,024 device pixels wide, mounted only near the visible part of the
// tracks. Scrolling stays a transform of the clip layer; a tile mounts or unmounts only when the
// view crosses into another one.
//
// Both are laid out along the source, from its first frame, at the zoom: a clip shows the part of
// that strip between its in and out points. So a trim reveals or covers frames and nothing slides
// (as the Clip states board draws a trim), the two halves of a split line up, and trimming or
// moving a clip never redraws a tile; only the zoom and newly made thumbnails do. A filmstrip's
// slots are as wide as a thumbnail at the clip's height, each showing the thumbnail of the second
// its left edge falls in, so zoomed in, one thumbnail repeats. A waveform's bars are 2 px wide
// every 3 px, each the peak of the source time under it.

import { thumbnailIndexAt } from "../media/thumbnails.ts";

/**
 * A tile's canvas is at most this many device pixels wide: far inside every browser's canvas
 * limits, and narrow enough that a zoom step redraws little past the view. With 4,096 px tiles,
 * zooming over filmstrips dropped a frame in every run; with these, none (docs/PERF.md, M3).
 */
export const MAX_TILE_DEVICE_PX = 1024;

/** How far past the visible tracks tiles are drawn, so a scroll finds them ready. */
export const TILE_MARGIN_PX = 512;

/** A tile's width in CSS pixels at a device pixel ratio. */
export function tileWidthFor(devicePixelRatio: number): number {
  return Math.floor(MAX_TILE_DEVICE_PX / (devicePixelRatio > 0 ? devicePixelRatio : 1));
}

export interface TileView {
  /** The clip's left edge and width, in pixels on the tracks. */
  clipLeft: number;
  clipWidth: number;
  /** Where the clip's in point is along the source strip, in pixels: in × pixels per frame. */
  inX: number;
  /** The tracks' scroll and visible width, in pixels. */
  scrollX: number;
  viewportWidth: number;
  tileWidth: number;
}

/**
 * The first and last tiles of the source strip that the clip shows near the view, or null when
 * none of the clip is near it. Tile k covers k × tileWidth to (k + 1) × tileWidth along the source,
 * and sits at k × tileWidth − inX from the clip's left edge.
 */
export function tilesInView({
  clipLeft,
  clipWidth,
  inX,
  scrollX,
  viewportWidth,
  tileWidth,
}: TileView): { first: number; last: number } | null {
  const from = Math.max(0, scrollX - TILE_MARGIN_PX - clipLeft);
  const to = Math.min(clipWidth, scrollX + viewportWidth + TILE_MARGIN_PX - clipLeft);
  if (to <= from) return null;
  return {
    first: Math.floor((inX + from) / tileWidth),
    last: Math.ceil((inX + to) / tileWidth) - 1,
  };
}

export interface Slot {
  /** Along the source strip. */
  x: number;
  /** Which thumbnail it shows: the one taken at or before the source time at x. */
  index: number;
}

/**
 * The filmstrip slots that overlap `from` to `to` along the source strip, where a pixel is
 * `secondsPerPixel` of source time: 1 / (pixels per frame × frames per second).
 */
export function filmstripSlots(
  from: number,
  to: number,
  {
    slotWidth,
    count,
    secondsPerPixel,
  }: { slotWidth: number; count: number; secondsPerPixel: number },
): Slot[] {
  if (count === 0 || slotWidth <= 0 || to <= from) return [];
  const slots: Slot[] = [];
  for (let slot = Math.floor(from / slotWidth); slot * slotWidth < to; slot += 1) {
    const x = slot * slotWidth;
    slots.push({ x, index: thumbnailIndexAt(x * secondsPerPixel, count) });
  }
  return slots;
}

/** A waveform bar is this wide, one every this many pixels. */
export const BAR_WIDTH = 2;
export const BAR_STEP = 3;

export interface Bar {
  /** Along the source strip. */
  x: number;
  /** The source time under it, in seconds. */
  start: number;
  end: number;
}

/** The waveform bars that overlap `from` to `to` along the source strip. */
export function waveformBars(from: number, to: number, secondsPerPixel: number): Bar[] {
  const bars: Bar[] = [];
  for (let bar = Math.floor(from / BAR_STEP); bar * BAR_STEP < to; bar += 1) {
    const x = bar * BAR_STEP;
    bars.push({ x, start: x * secondsPerPixel, end: (x + BAR_STEP) * secondsPerPixel });
  }
  return bars;
}
