// Drawing a tile of a filmstrip or a waveform, and a single picture (the monitor's and the
// inspector's), on a 2D canvas. Pure apart from the context they're given, which the tests record.

import { peakBetween, type PeakLevels } from "../media/peaks.ts";
import { BAR_WIDTH, type Bar, type Slot } from "./tiles.ts";

/** The calls drawing makes on a CanvasRenderingContext2D. */
export interface Context2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  clearRect: (x: number, y: number, width: number, height: number) => void;
  fillRect: (x: number, y: number, width: number, height: number) => void;
  drawImage: (
    image: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
}

/**
 * The waveform's color, as the tokens say (`--color-waveform`, and `--color-waveform-selected` on
 * a selected clip; a test keeps them equal): a canvas can't read CSS variables cheaply.
 */
export const WAVEFORM_COLORS = { normal: "#8b8b94", selected: "#a8a8b0" } as const;

/** Room above and below the loudest bar, as drawn on the boards. */
const WAVEFORM_MARGIN = 4.5;
/** The shortest bar, so silence still shows as a line. */
const MIN_BAR_HEIGHT = 3;

/** A canvas's size in device pixels for a CSS size, at the screen's pixel ratio. */
export function devicePixels(width: number, height: number): { width: number; height: number } {
  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return {
    width: Math.max(1, Math.ceil(width * ratio)),
    height: Math.max(1, Math.ceil(height * ratio)),
  };
}

/**
 * Sizes a canvas for its CSS size at the screen's pixel ratio, and gives back its context scaled
 * to CSS pixels; null where there's no 2D context (as in jsdom without a stub).
 */
export function canvasContext(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const pixels = devicePixels(width, height);
  if (canvas.width !== pixels.width) canvas.width = pixels.width;
  if (canvas.height !== pixels.height) canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

/** One tile of a filmstrip: the thumbnails of its slots, from `from` px of the clip. */
export function drawFilmstrip(
  context: Context2D,
  {
    from,
    width,
    height,
    slots,
    slotWidth,
    thumbnails,
  }: {
    from: number;
    width: number;
    height: number;
    slots: readonly Slot[];
    slotWidth: number;
    thumbnails: readonly (CanvasImageSource | undefined)[];
  },
): void {
  context.clearRect(0, 0, width, height);
  for (const { x, index } of slots) {
    const thumbnail = thumbnails[index];
    if (thumbnail) context.drawImage(thumbnail, x - from, 0, slotWidth, height);
  }
}

/** One tile of a waveform: each bar from its lowest to its highest sample, from `from` px. */
export function drawWaveform(
  context: Context2D,
  {
    from,
    width,
    height,
    bars,
    peaks,
    color,
  }: {
    from: number;
    width: number;
    height: number;
    bars: readonly Bar[];
    peaks: PeakLevels;
    color: string;
  },
): void {
  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
  const middle = height / 2;
  const scale = middle - WAVEFORM_MARGIN;
  for (const { x, start, end } of bars) {
    const peak = peakBetween(peaks, start, end);
    if (!peak) continue;
    let top = middle - peak.high * scale;
    let bottom = middle - peak.low * scale;
    if (bottom - top < MIN_BAR_HEIGHT) {
      const center = (top + bottom) / 2;
      top = center - MIN_BAR_HEIGHT / 2;
      bottom = center + MIN_BAR_HEIGHT / 2;
    }
    context.fillRect(x - from, top, BAR_WIDTH, bottom - top);
  }
}

/** The calls drawing a turned picture adds to Context2D's. */
export interface TurningContext2D extends Context2D {
  save: () => void;
  restore: () => void;
  translate: (x: number, y: number) => void;
  rotate: (angle: number) => void;
  scale: (x: number, y: number) => void;
}

/** How a video file says its frames are turned: clockwise, then flipped sideways. */
export interface Turn {
  rotation: 0 | 90 | 180 | 270;
  flip: boolean;
}

/**
 * A picture fitted inside a box, centered with its shape kept, over what's drawn there: a video
 * frame, turned and flipped as its file says, so a phone's portrait video stands upright.
 */
export function drawFitted(
  context: TurningContext2D,
  image: CanvasImageSource,
  imageSize: { width: number; height: number },
  box: { width: number; height: number },
  { rotation, flip }: Turn = { rotation: 0, flip: false },
): void {
  const sideways = rotation === 90 || rotation === 270;
  const shownWidth = sideways ? imageSize.height : imageSize.width;
  const shownHeight = sideways ? imageSize.width : imageSize.height;
  const scale = Math.min(box.width / shownWidth, box.height / shownHeight);
  const width = imageSize.width * scale;
  const height = imageSize.height * scale;
  if (rotation === 0 && !flip) {
    context.drawImage(image, (box.width - width) / 2, (box.height - height) / 2, width, height);
    return;
  }
  // Transforms apply to the picture last call first: it's turned, then flipped, as Mediabunny does.
  context.save();
  context.translate(box.width / 2, box.height / 2);
  if (flip) context.scale(-1, 1);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();
}

/** A picture fitted inside a box with its shape kept, centered; the background shows around it. */
export function drawContained(
  context: Context2D,
  image: CanvasImageSource & { width: number; height: number },
  width: number,
  height: number,
): void {
  context.clearRect(0, 0, width, height);
  const scale = Math.min(width / image.width, height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  context.drawImage(
    image,
    (width - drawnWidth) / 2,
    (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
}
