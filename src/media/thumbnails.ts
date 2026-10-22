// Thumbnails (spec section 4.5): one per second of a video's source, about 160 px wide, made in the
// import worker with Mediabunny's CanvasSink and saved to OPFS. They feed the filmstrips on the
// timeline, the posters in the media bin and, until M4 decodes frames, the monitor.

/** How wide a thumbnail is; its height follows the video's shape (90 px for 16:9). */
export const THUMBNAIL_WIDTH = 160;

/** WebP where the browser encodes it, JPEG elsewhere (Safari's OffscreenCanvas). */
export type ThumbnailType = "image/webp" | "image/jpeg";

export const THUMBNAIL_EXTENSIONS: Record<ThumbnailType, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

/**
 * When to take a video's thumbnails: at 0, 1, 2… seconds, every whole second before its end. The
 * first frame can come after 0; the first thumbnail waits for it.
 */
export function thumbnailTimestamps(durationSec: number, firstTimestamp = 0): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  return Array.from({ length: Math.ceil(durationSec) }, (_, second) =>
    Math.max(second, firstTimestamp),
  );
}

/**
 * The thumbnails of a clip with `count` of them that a preview of its first seconds can make: the
 * ones whose second starts before the preview ends (the Feed's previews are 2.5 s, so seconds 0, 1
 * and 2), taken as the clip's own are.
 */
export function previewTimestamps(count: number, previewSec: number, firstTimestamp = 0): number[] {
  return thumbnailTimestamps(previewSec, firstTimestamp).slice(0, count);
}

/**
 * How many thumbnails a video of this length has: the slots of its filmstrip, whether or not
 * they've been made or read back yet.
 */
export function thumbnailCount(durationSec: number): number {
  return thumbnailTimestamps(durationSec).length;
}

/**
 * The type of an encoded thumbnail: WebP only when the blob really is one. A browser that can't
 * encode WebP hands back a PNG instead, which the worker then re-encodes as JPEG.
 */
export function thumbnailTypeOf(blob: Blob): ThumbnailType | null {
  if (blob.type === "image/webp") return "image/webp";
  return blob.type === "image/jpeg" ? "image/jpeg" : null;
}

/**
 * The thumbnail to show for a time in the source: the one taken at or before it, as a decoder
 * shows the last frame at or before a time. Float error up to a microsecond is forgiven, like
 * every time in the engine (src/engine/time.ts).
 */
export function thumbnailIndexAt(seconds: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor(seconds + 1e-6)));
}
