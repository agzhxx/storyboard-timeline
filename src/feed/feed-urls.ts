// Where the Feed and its media live (spec section 4.9). The first part is copied from the Feed's
// lib/media-urls.ts at generation-feed@65a0341: the storage keys and the URL helpers the Timeline
// needs. Change them in the Feed first, then copy them here, until the UI Kit (project 3) owns
// them. The rest is the Timeline's own: its two settings and the API's address.

import type { Collection } from "./collections.ts";
import type { MediaItem } from "./media-item.ts";

/** Poster widths that scripts/ingest.ts makes, in AVIF and WebP. */
export const POSTER_WIDTHS = [320, 480, 640, 960, 1280, 1920] as const;
export type PosterFormat = "avif" | "webp";

/** Poster widths that exist for a source: never upscaled, but the smallest always exists. */
export function posterWidths(sourceWidth: number): number[] {
  const widths = POSTER_WIDTHS.filter((width) => width <= sourceWidth);
  return widths.length > 0 ? widths : [POSTER_WIDTHS[0]];
}

export function posterFileKey(posterKey: string, width: number, format: PosterFormat): string {
  return `${posterKey}/${width}.${format}`;
}

/** The original at full quality, for later projects: an image as WebP, a video as delivered. */
export function originalKey(item: Pick<MediaItem, "id" | "kind">): string {
  return `originals/${item.id}.${item.kind === "image" ? "webp" : "mp4"}`;
}

export function mediaUrl(origin: string, key: string): string {
  return `${origin.replace(/\/+$/, "")}/${key}`;
}

/** The smallest poster at least `width` wide, or the largest one there is. */
export function posterUrl(
  origin: string,
  item: MediaItem,
  width: number,
  format: PosterFormat,
): string {
  const widths = posterWidths(item.width);
  const chosen = widths.find((candidate) => candidate >= width) ?? widths[widths.length - 1];
  return mediaUrl(origin, posterFileKey(item.posterKey, chosen ?? POSTER_WIDTHS[0], format));
}

export function videoUrl(origin: string, item: MediaItem): string | undefined {
  return item.videoKey === undefined ? undefined : mediaUrl(origin, item.videoKey);
}

// The Timeline's own ------------------------------------------------------------------------

/** A setting from the build's environment, or its default when it's missing or empty. */
function setting(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}

/** The Feed's address: the `VITE_FEED_ORIGIN` setting, or the live Feed. */
export const FEED_ORIGIN = setting(
  import.meta.env.VITE_FEED_ORIGIN,
  "https://generation-feed.vercel.app",
);

/**
 * Where the Feed's media is stored: the `VITE_MEDIA_ORIGIN` setting, or today the Feed's R2
 * bucket at its r2.dev address (a custom domain replaces it later, spec section 4.9).
 */
export const MEDIA_ORIGIN = setting(
  import.meta.env.VITE_MEDIA_ORIGIN,
  "https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev",
);

/** One page of a collection's videos: `GET /api/media?collection&kind=video&limit[&cursor]`. */
export function feedPageUrl(collection: Collection, limit: number, cursor: string | null): string {
  const params = new URLSearchParams({ collection, kind: "video", limit: String(limit) });
  if (cursor !== null) params.set("cursor", cursor);
  return mediaUrl(FEED_ORIGIN, `api/media?${params.toString()}`);
}
