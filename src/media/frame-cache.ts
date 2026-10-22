// Exact frames the monitor has shown, as ImageBitmaps at its size in device pixels (spec section
// 4.5): a least-recently-used cache around the playhead, capped by memory. Scrubbing back over a
// frame, stepping to one, or an edit that leaves the picture as it was draws it at once. A bitmap
// that falls out, is replaced or is cleared away is closed, so its memory goes back at once.

export interface Bitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** How much the cache holds: about 15 frames at 1394 × 784 (the monitor on a 2× screen). */
export const FRAME_CACHE_BYTES = 64 * 1024 * 1024;

const bytesOf = (bitmap: Bitmap) => bitmap.width * bitmap.height * 4;

export class FrameCache<B extends Bitmap> {
  /** In use order: the first entry is the least recently used. */
  private readonly entries = new Map<string, B>();
  private total = 0;
  private readonly maxBytes: number;

  constructor(maxBytes = FRAME_CACHE_BYTES) {
    this.maxBytes = maxBytes;
  }

  /** How many bytes the bitmaps take. */
  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  /** A frame, which becomes the most recently used. */
  get(key: string): B | undefined {
    const bitmap = this.entries.get(key);
    if (bitmap === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, bitmap);
    return bitmap;
  }

  /** Keeps a frame, closing the least recently used ones while the cache holds too much. */
  set(key: string, bitmap: B): void {
    this.delete(key);
    this.entries.set(key, bitmap);
    this.total += bytesOf(bitmap);
    // The newest frame stays, even alone over the cap: it's the one on screen.
    for (const oldest of this.entries.keys()) {
      if (this.total <= this.maxBytes || oldest === key) break;
      this.delete(oldest);
    }
  }

  /** Closes and drops one frame. */
  delete(key: string): void {
    const bitmap = this.entries.get(key);
    if (bitmap === undefined) return;
    this.entries.delete(key);
    this.total -= bytesOf(bitmap);
    bitmap.close();
  }

  /** Closes and drops every frame whose key matches, such as an asset's. */
  deleteWhere(matches: (key: string) => boolean): void {
    for (const key of [...this.entries.keys()]) if (matches(key)) this.delete(key);
  }

  /** Closes every frame. */
  clear(): void {
    this.deleteWhere(() => true);
  }
}
