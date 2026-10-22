// The media bin's tabs (spec section 3.1; Media bin states board): "My files" or "From the Feed",
// the collection the Feed tab shows, and the pages of each collection's clips loaded so far, kept
// for the session. Pages come from the Feed's API through its lazily loaded client, one at a time:
// the first when a collection is first shown, the next when the list reaches its end. A page that
// doesn't come leaves what's loaded and says so, with Retry.

import { create } from "zustand";
import { type Collection, VIDEO_COLLECTIONS } from "./collections.ts";
import type { FeedClip } from "./feed-clip.ts";
import { loadFeedApi } from "./load-feed-api.ts";

/** How many clips a page asks for: about three screens of the bin's cards. */
export const PAGE_SIZE = 24;

export interface CollectionClips {
  items: FeedClip[];
  /** The collection's videos across all pages; null until a page is in. */
  total: number | null;
  /** For the next page; null before the first and after the last. */
  nextCursor: string | null;
  /** A page is on its way. */
  loading: boolean;
  /** The last page asked for didn't come. */
  failed: boolean;
}

interface FeedTabState {
  tab: "files" | "feed";
  collection: Collection;
  clips: Partial<Record<Collection, CollectionClips>>;
}

export const useFeedTab = create<FeedTabState>(() => ({
  tab: "files",
  collection: "story",
  clips: {},
}));

const EMPTY: CollectionClips = {
  items: [],
  total: null,
  nextCursor: null,
  loading: false,
  failed: false,
};

export function clipsOf(state: FeedTabState, collection: Collection): CollectionClips {
  return state.clips[collection] ?? EMPTY;
}

/** Whether every page of a collection is in. */
export function complete(clips: CollectionClips): boolean {
  return clips.total !== null && clips.nextCursor === null && !clips.failed;
}

/**
 * Each collection's generation: the story's whole collection starts a new one, so a page asked
 * for before it can't land on top of it.
 */
const generations = new Map<Collection, number>();

function generationOf(collection: Collection): number {
  return generations.get(collection) ?? 0;
}

function update(collection: Collection, change: Partial<CollectionClips>): void {
  useFeedTab.setState((state) => ({
    clips: { ...state.clips, [collection]: { ...clipsOf(state, collection), ...change } },
  }));
}

export function showFiles(): void {
  useFeedTab.setState({ tab: "files" });
}

/** Opens the Feed tab, loading its collection's first page if it has none yet. */
export function showFeed(): void {
  useFeedTab.setState({ tab: "feed" });
  const state = useFeedTab.getState();
  if (clipsOf(state, state.collection).total === null) void loadNextPage();
}

/**
 * The Collection picker's choice, as its value: one of the collections the tab offers, else
 * nothing happens. (The store owns that list, so it loads with the page, and the tab's lazily
 * loaded list and the Feed client never share a chunk for it.)
 */
export function chooseCollection(value: string): void {
  const collection = VIDEO_COLLECTIONS.find((offered) => offered === value);
  if (collection === undefined) return;
  useFeedTab.setState({ collection });
  if (clipsOf(useFeedTab.getState(), collection).total === null) void loadNextPage();
}

/**
 * Loads the shown collection's next page (its first, if none is in): when the list reaches its
 * end, and for Retry. Nothing happens while a page is on its way, or once every page is in.
 */
export async function loadNextPage(): Promise<void> {
  const { collection } = useFeedTab.getState();
  const current = clipsOf(useFeedTab.getState(), collection);
  if (current.loading || complete(current)) return;
  const generation = generationOf(collection);
  update(collection, { loading: true, failed: false });
  // The client can fail to load too (offline): that's a page that didn't come.
  const api = await loadFeedApi().catch(() => null);
  const result = api
    ? await api.fetchFeedPage(collection, { limit: PAGE_SIZE, cursor: current.nextCursor })
    : null;
  // The story filled the collection in the meantime: this page is old news.
  if (generationOf(collection) !== generation) return;
  if (!result?.ok) {
    update(collection, { loading: false, failed: true });
    return;
  }
  const { items, nextCursor, total } = result.value;
  const known = clipsOf(useFeedTab.getState(), collection).items;
  const ids = new Set(known.map((item) => item.id));
  update(collection, {
    items: [...known, ...items.filter((item) => !ids.has(item.id))],
    nextCursor,
    total,
    loading: false,
  });
}

/** The connection is back: a page of the shown collection that didn't come is asked for again. */
export function retryFeedAfterReconnect(): void {
  const state = useFeedTab.getState();
  if (clipsOf(state, state.collection).failed) void loadNextPage();
}

/**
 * A whole collection the robot story fetched: the tab shows it without asking again, as the
 * Main board draws the bin once the story is loaded.
 */
export function showWholeCollection(collection: Collection, items: FeedClip[]): void {
  generations.set(collection, generationOf(collection) + 1);
  update(collection, {
    items,
    total: items.length,
    nextCursor: null,
    loading: false,
    failed: false,
  });
  useFeedTab.setState({ tab: "feed", collection });
}
