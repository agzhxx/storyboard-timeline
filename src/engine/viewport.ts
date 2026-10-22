// Where frames are on screen (spec section 4.4). The tracks draw frame f at x = f × pxPerFrame −
// scrollX, with x measured from the left edge of the tracks. Zoom and scroll are view state, so
// fractions are fine here; anything that goes into the document is rounded to whole frames first,
// the way time.ts rounds.

import { floorToFrame } from "./time.ts";
import type { Fps, Frames } from "./types.ts";

export interface View {
  /** The zoom: how many pixels one frame takes. */
  pxPerFrame: number;
  /** How far the tracks are scrolled, in pixels. */
  scrollX: number;
}

/** The closest zoom: one frame 48 px wide. */
export const MAX_PX_PER_FRAME = 48;

/** Room after the cut's last frame, in pixels, so its end can be seen and grabbed. */
export const END_PADDING_PX = 24;

/** Fit never zooms in closer than showing this many seconds, so a short cut has room to grow. */
export const MIN_FIT_SECONDS = 10;

/** One press of + or − zooms by this factor; two presses double or halve the zoom. */
export const ZOOM_STEP = Math.SQRT2;

/** Where a frame starts on screen. */
export function xOf(frame: Frames, view: View): number {
  return frame * view.pxPerFrame - view.scrollX;
}

/** The position in frames under a point, between frames if the point is: for drags and snaps. */
export function positionAt(x: number, view: View): number {
  return (x + view.scrollX) / view.pxPerFrame;
}

/** The frame a point falls in, such as the one a click on the ruler moves the playhead to. */
export function frameAt(x: number, view: View): Frames {
  return floorToFrame(positionAt(x, view));
}

/**
 * The view zoomed to `pxPerFrame` around a point: scrolled so that the position under `anchorX`
 * stays under it. The scroll can come out negative or past the end; the caller clamps it.
 */
export function zoomAround(view: View, pxPerFrame: number, anchorX: number): View {
  return { pxPerFrame, scrollX: positionAt(anchorX, view) * pxPerFrame - anchorX };
}

/**
 * How much a wheel event zooms, from its vertical delta in pixels: a mouse wheel's notch (100 px)
 * zooms by √2, like + and −, and a trackpad pinch's small deltas zoom smoothly.
 */
export function wheelZoomFactor(deltaY: number): number {
  return 2 ** (-deltaY / 200);
}

/**
 * The zoom that shows the whole cut across the visible width, with room after its end. A cut
 * under 10 seconds, or none, fits as 10 seconds, and no fit is closer than 48 px per frame.
 */
export function fitZoom(duration: Frames, fps: Fps, viewportWidth: number): number {
  const frames = Math.max(duration, MIN_FIT_SECONDS * fps);
  return Math.min(MAX_PX_PER_FRAME, Math.max(1, viewportWidth - END_PADDING_PX) / frames);
}

export interface ZoomRange {
  /** The most zoomed-out: the whole cut fits. */
  min: number;
  /** The closest: 48 px per frame. */
  max: number;
}

export function zoomRange(duration: Frames, fps: Fps, viewportWidth: number): ZoomRange {
  return { min: fitZoom(duration, fps, viewportWidth), max: MAX_PX_PER_FRAME };
}

export function clampZoom(pxPerFrame: number, range: ZoomRange): number {
  return Math.min(range.max, Math.max(range.min, pxPerFrame));
}

/** How wide the tracks' content is: the cut plus room after it, never narrower than the view. */
export function contentWidth(duration: Frames, pxPerFrame: number, viewportWidth: number): number {
  return Math.max(viewportWidth, duration * pxPerFrame + END_PADDING_PX);
}

/** The scroll kept between the start and where the content's end meets the view's right edge. */
export function clampScrollX(
  scrollX: number,
  duration: Frames,
  pxPerFrame: number,
  viewportWidth: number,
): number {
  const maxScroll = contentWidth(duration, pxPerFrame, viewportWidth) - viewportWidth;
  return Math.min(maxScroll, Math.max(0, scrollX));
}

/** Where a zoom sits on the slider, from 0 (fit) to 1 (closest), on a log scale. */
export function zoomToSlider(pxPerFrame: number, range: ZoomRange): number {
  if (range.max <= range.min) return 0;
  const t = Math.log(pxPerFrame / range.min) / Math.log(range.max / range.min);
  return Math.min(1, Math.max(0, t));
}

/** The zoom at a point on the slider, from 0 (fit) to 1 (closest). */
export function sliderToZoom(t: number, range: ZoomRange): number {
  if (range.max <= range.min) return range.min;
  if (t >= 1) return range.max;
  return range.min * (range.max / range.min) ** Math.max(0, t);
}
