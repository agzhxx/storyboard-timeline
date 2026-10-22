// A 2D canvas for jsdom, which has none: each canvas gets a context that writes down what's drawn
// on it, "image s2" for a picture whose id is s2, "bar" for a waveform bar, "clear" for a fresh
// start. Call `recordCanvases()` before rendering; `vi.restoreAllMocks()` puts getContext back.

import { vi } from "vitest";

let drawings = new WeakMap<HTMLCanvasElement, string[]>();

function contextOf(canvas: HTMLCanvasElement) {
  const log = drawings.get(canvas) ?? [];
  drawings.set(canvas, log);
  return {
    fillStyle: "",
    setTransform: () => undefined,
    clearRect: () => log.push("clear"),
    fillRect: () => log.push("bar"),
    drawImage: (image: { id?: string }) =>
      log.push(image.id === undefined ? "image" : `image ${image.id}`),
  };
}

export function recordCanvases(): void {
  drawings = new WeakMap();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return contextOf(this) as unknown as CanvasRenderingContext2D;
  });
}

/** What the canvases inside an element show now: each one's calls since it was last cleared. */
export function drawnIn(element: Element): string[] {
  return [...element.querySelectorAll("canvas")].flatMap((canvas) => {
    const log = drawings.get(canvas) ?? [];
    return log.slice(log.lastIndexOf("clear") + 1);
  });
}

/** Stands in for an ImageBitmap: a canvas only needs its size, and the tests its id. */
export function picture(id: string): ImageBitmap {
  return { id, width: 160, height: 90, close: () => undefined } as unknown as ImageBitmap;
}
