// The timeline's rows, as drawn at 1440 × 900 (docs/design/README.md): the ruler, then V2, V1 and
// A1. The heights match the `--spacing-ruler` and `--spacing-track-*` tokens, which the rows'
// backgrounds use (a test keeps the two equal); clips sit 4 px below a row's top, as tall as the
// design draws them.

import type { Frames, Track } from "../engine/types.ts";

export const RULER_HEIGHT = 28;

/** A clip is drawn at least this wide, so a one-frame clip can still be seen and clicked. */
export const MIN_CLIP_WIDTH = 4;

/** Narrower than this, a clip has no label or trim handles: it shows its name on hover. */
export const NARROW_CLIP_WIDTH = 24;

/** A clip's drawn width: its frames at the zoom, but never under 4 px. */
export function clipWidth(duration: Frames, pxPerFrame: number): number {
  return Math.max(MIN_CLIP_WIDTH, duration * pxPerFrame);
}

/** Each row's height (with its 1 px bottom border) and the height of the clips on it. */
const SIZES: Record<string, { height: number; clipHeight: number } | undefined> = {
  V2: { height: 72, clipHeight: 63 },
  V1: { height: 88, clipHeight: 78 },
  A1: { height: 72, clipHeight: 63 },
};

const CLIP_INSET = 4;

export interface RowLayout {
  trackId: string;
  kind: Track["kind"];
  /** The row's top, from the top of the ruler. */
  top: number;
  height: number;
  /** Where a clip on this row starts and how tall it is, from the top of the ruler. */
  clipTop: number;
  clipHeight: number;
}

/** The rows under the ruler, top to bottom. */
function rowLayouts(tracks: readonly Pick<Track, "id" | "kind">[]): RowLayout[] {
  let top = RULER_HEIGHT;
  return tracks.map((track) => {
    const size = SIZES[track.id] ?? { height: 72, clipHeight: 63 };
    const layout = {
      trackId: track.id,
      kind: track.kind,
      top,
      height: size.height,
      clipTop: top + CLIP_INSET,
      clipHeight: size.clipHeight,
    };
    top += size.height;
    return layout;
  });
}

/** The MVP's rows, V2, V1 and A1, which never change. */
export const ROWS: readonly RowLayout[] = rowLayouts([
  { id: "V2", kind: "video" },
  { id: "V1", kind: "video" },
  { id: "A1", kind: "audio" },
]);

/** The ruler and every row: how tall the playhead and a snap line are. */
export const TRACKS_HEIGHT = RULER_HEIGHT + ROWS.reduce((sum, row) => sum + row.height, 0);

export function rowOf(trackId: string): RowLayout | undefined {
  return ROWS.find((row) => row.trackId === trackId);
}

/**
 * The row of a kind nearest a point, measured from the top of the ruler: the row under the point
 * if it's of that kind, else the closest one that is. A video clip dragged down over A1 stays on
 * V1; one dragged up over the ruler goes to V2.
 */
export function nearestRow(kind: Track["kind"], y: number): RowLayout | undefined {
  let best: RowLayout | undefined;
  let bestDistance = Infinity;
  for (const row of ROWS) {
    if (row.kind !== kind) continue;
    const distance = Math.max(row.top - y, y - (row.top + row.height - 1), 0);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best;
}
