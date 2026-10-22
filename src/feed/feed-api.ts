// The Feed's API client (spec section 4.9): pages of a collection's videos from
// `GET {FEED}/api/media`, each answer checked against the schema copied from the Feed. It brings
// zod, so it's loaded on its own, the first time the Feed tab opens or the robot story loads
// (src/feed/load-feed-api.ts): the app shell never carries either.
//
// Like the editing commands, it never throws: a page comes back, or why it didn't.

import { z } from "zod";
import type { Collection } from "./collections.ts";
import { type FeedClip, isFeedClip } from "./feed-clip.ts";
import { feedPageUrl } from "./feed-urls.ts";
import { mediaItemSchema } from "./media-item.ts";

export interface FeedPage {
  items: FeedClip[];
  /** Send back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
  /** The collection's videos, across all pages. */
  total: number;
}

/**
 * Why a page didn't load: no answer (offline, the address unreachable, or the browser blocked the
 * answer), no answer in time, an error status, or an answer that isn't what the schema says.
 */
export type FeedFailure =
  | { reason: "network" }
  | { reason: "timeout" }
  | { reason: "status"; status: number }
  | { reason: "invalid"; detail: string };

export type FeedResult<T> = { ok: true; value: T } | { ok: false; failure: FeedFailure };

/** How long a page may take. The Feed's CDN answers in well under a second. */
export const FEED_TIMEOUT_MS = 15_000;

/** The fields the copied schema knows. */
const KNOWN_FIELDS = new Set(Object.keys(mediaItemSchema.shape));

/**
 * An item as the API sends it. Fields this copy of the schema doesn't know are dropped before
 * the strict schema checks the rest, so the Feed can add a field without breaking the Timeline;
 * a field the Timeline reads that's missing or changed is still an error.
 */
const apiItemSchema = z.preprocess(
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([key]) => KNOWN_FIELDS.has(key)))
      : value,
  mediaItemSchema,
);

const pageSchema = z.object({
  items: z.array(apiItemSchema),
  nextCursor: z.string().min(1).nullable(),
  total: z.int().nonnegative(),
});

/** Checks an answer's body: a page of videos, or why it isn't one. */
export function parseFeedPage(body: unknown): FeedResult<FeedPage> {
  const parsed = pageSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, failure: { reason: "invalid", detail: z.prettifyError(parsed.error) } };
  }
  const { items, nextCursor, total } = parsed.data;
  const notVideo = items.find((item) => !isFeedClip(item));
  if (notVideo) {
    return { ok: false, failure: { reason: "invalid", detail: `${notVideo.id} isn't a video` } };
  }
  return { ok: true, value: { items: items.filter(isFeedClip), nextCursor, total } };
}

/** One page of a collection's videos, after `cursor` (the first page for null). */
export async function fetchFeedPage(
  collection: Collection,
  { limit, cursor = null }: { limit: number; cursor?: string | null },
): Promise<FeedResult<FeedPage>> {
  let response: Response;
  try {
    response = await fetch(feedPageUrl(collection, limit, cursor), {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, failure: { reason: timedOut ? "timeout" : "network" } };
  }
  if (!response.ok) return { ok: false, failure: { reason: "status", status: response.status } };
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // The body stopped coming in time, or isn't JSON.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { ok: false, failure: { reason: "timeout" } };
    }
    return { ok: false, failure: { reason: "invalid", detail: "The answer isn't JSON." } };
  }
  return parseFeedPage(body);
}

/** How many pages `fetchWholeCollection` follows before it gives up on the cursor. */
const MAX_PAGES = 20;

/** Every video in a collection, following `nextCursor` from page to page. */
export async function fetchWholeCollection(
  collection: Collection,
  limit: number,
): Promise<FeedResult<FeedClip[]>> {
  const items: FeedClip[] = [];
  const ids = new Set<string>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchFeedPage(collection, { limit, cursor });
    if (!result.ok) return result;
    // An item that comes again on a later page (the Feed changed in between) counts once.
    for (const item of result.value.items) {
      if (ids.has(item.id)) continue;
      ids.add(item.id);
      items.push(item);
    }
    cursor = result.value.nextCursor;
    if (cursor === null) return { ok: true, value: items };
    // A cursor that comes back again would loop forever.
    if (seen.has(cursor)) break;
    seen.add(cursor);
  }
  return { ok: false, failure: { reason: "invalid", detail: "The pages never end." } };
}
