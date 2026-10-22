// Where the tracks are on the page, for turning a pointer's position into a frame and a row. The
// timeline registers its visible area; drags that start elsewhere, such as a card in the media
// bin, and the + and − keys, which zoom around the pointer, read it here.

let lanes: HTMLElement | null = null;
let hoverClientX: number | null = null;

/** The timeline calls this with its tracks' visible area, and with null when it goes away. */
export function registerLanes(element: HTMLElement | null): void {
  lanes = element;
}

export interface LanesPoint {
  /** From the left edge of the tracks. */
  x: number;
  /** From the top of the ruler. */
  y: number;
  /** Whether the point is over the ruler or the tracks. */
  inside: boolean;
}

/** Where the tracks' visible area is on the page; null before the timeline is drawn. */
export function lanesRect(): DOMRect | null {
  return lanes?.getBoundingClientRect() ?? null;
}

/** A point on the page, from the top-left corner of `rect`, the tracks' visible area. */
export function pointIn(rect: DOMRect, clientX: number, clientY: number): LanesPoint {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return { x, y, inside: x >= 0 && x < rect.width && y >= 0 && y < rect.height };
}

/** A point on the page, from the tracks' top-left corner; null before the timeline is drawn. */
export function lanesPoint(clientX: number, clientY: number): LanesPoint | null {
  const rect = lanesRect();
  return rect && pointIn(rect, clientX, clientY);
}

/**
 * Remembers where the pointer is over the tracks, as a page position (so moving the pointer never
 * has to measure the page), or null once it leaves them.
 */
export function setHoverClientX(clientX: number | null): void {
  hoverClientX = clientX;
}

/** Where the pointer is over the tracks, from their left edge, or null when it isn't. */
export function pointerOverLanes(): number | null {
  const rect = lanesRect();
  return hoverClientX === null || !rect ? null : hoverClientX - rect.left;
}
