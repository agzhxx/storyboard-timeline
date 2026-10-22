// The media bin's "From the Feed" tab (spec section 3.1; Media bin states board): the Collection
// picker, the story first, and the collection's videos as cards: poster, the "AI" badge, length,
// shot name and model. Enter or a click adds a clip at the playhead and a card can be dragged onto
// a track, as in My files. Under them, the Feed's state: loading, every clip in, more to come
// (the next page loads as the list reaches its end), or "Can't reach the Feed" with Retry, while
// My files and the timeline keep working. Offline, the board's note says what still works, and
// the clips this browser can't add without the network are dimmed and marked "Offline"; when the
// connection comes back, a page that didn't come loads (src/app/online.ts).

import { useEffect, useRef, useState } from "react";
import { type GetMediaUrl, MediaCard } from "@/components/ui/media-card/media-card";
import { COLLECTION_LABELS, type Collection, VIDEO_COLLECTIONS } from "../feed/collections.ts";
import { byShot, type FeedClip, feedClipName } from "../feed/feed-clip.ts";
import { factsAtHand, feedAssetNow, feedFacts } from "../feed/feed-media.ts";
import {
  chooseCollection,
  type CollectionClips,
  clipsOf,
  complete,
  loadNextPage,
  useFeedTab,
} from "../feed/feed-store.ts";
import { MEDIA_ORIGIN, posterUrl } from "../feed/feed-urls.ts";
import { formatLength } from "../media/facts.ts";
import { pressAsset } from "../timeline/gestures.ts";
import { addFeedClip, addFeedClipAt } from "./actions.ts";
import { announce } from "./announcer.ts";
import { ChevronDownIcon, OfflineIcon, RetryIcon, SpinnerIcon, WarningIcon } from "./icons.tsx";
import { useOnline } from "./online.ts";
import { AiBadge, SecondaryButton } from "./ui.tsx";

/** A card's poster is about 134 CSS pixels wide: the 320 px WebP covers screens up to 2×. */
const POSTER_WIDTHS = [320];
const POSTER_FORMATS = ["webp"] as const;
const POSTER_SIZES = "134px";

type FeedCardItem = FeedClip & { alt: string };

/** The Feed's posters, from the bucket; the bin plays no previews. */
const posterUrls: GetMediaUrl<FeedCardItem> = (item, request) =>
  request.type === "poster" && request.format === "webp"
    ? posterUrl(MEDIA_ORIGIN, item, request.width, request.format)
    : undefined;

export function FeedClips() {
  const collection = useFeedTab((state) => state.collection);
  const clips = useFeedTab((state) => clipsOf(state, collection));
  const online = useOnline((state) => state.online);
  const { items, total } = clips;
  // Each change of what's loaded is said by the app's live region.
  const said = announcement(clips);
  useEffect(() => {
    if (said !== "") announce(said);
  }, [said]);
  const body =
    items.length > 0 ? (
      <Cards clips={clips} items={shown(collection, items)} />
    ) : !online ? null : clips.failed ? (
      <Unreachable />
    ) : total === 0 ? (
      <NoClips />
    ) : (
      <Loading />
    );
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <CollectionPicker collection={collection} />
        {total !== null && (
          <span className="text-xs text-fg-subtle">
            {total === 1 ? "1 clip" : `${total} clips`}
          </span>
        )}
      </div>
      {!online && <Offline />}
      {body}
    </>
  );
}

/** The connection went: what still works. */
function Offline() {
  return (
    <div className="mx-3 mb-3 flex items-start gap-2 rounded-control bg-surface-raised px-2.5 py-2">
      <span className="mt-px text-fg-muted">
        <OfflineIcon />
      </span>
      <p className="text-xs text-fg">
        You&rsquo;re offline. Clips this browser already cached keep working; the rest need a
        connection.
      </p>
    </div>
  );
}

/** What a screen reader hears as the clips load; a failure is an alert of its own. */
function announcement(clips: CollectionClips): string {
  const { items, total, loading, failed } = clips;
  if (failed) return "";
  if (loading) return items.length === 0 ? "Loading clips from the Feed…" : "Loading more clips…";
  if (total === null) return "";
  if (total === 0) return "No clips in this collection yet.";
  if (!complete(clips)) return `${String(items.length)} of ${String(total)} clips loaded.`;
  return items.length === 1 ? "1 clip loaded." : `All ${String(items.length)} clips loaded.`;
}

/** The story's clips in shot order, as the cut has them; other collections as the Feed sends them. */
function shown(collection: Collection, items: readonly FeedClip[]): readonly FeedClip[] {
  return collection === "story" ? items.toSorted(byShot) : items;
}

function CollectionPicker({ collection }: { collection: Collection }) {
  return (
    <label className="flex items-center gap-2 text-xs text-fg-subtle">
      Collection
      <span className="relative inline-flex">
        <select
          value={collection}
          className="h-8 appearance-none rounded-control bg-surface-raised pr-[30px] pl-2.5 text-sm text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
          onChange={(event) => {
            chooseCollection(event.currentTarget.value);
          }}
        >
          {VIDEO_COLLECTIONS.map((value) => (
            <option key={value} value={value}>
              {COLLECTION_LABELS[value]}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute top-[9px] right-2.5 text-fg-muted">
          <ChevronDownIcon size={14} />
        </span>
      </span>
    </label>
  );
}

/** The first page is on its way: two cards' shapes, and what's happening. */
function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2.5 px-3 pb-3">
      <div className="grid grid-cols-2 gap-x-2 gap-y-3">
        {[70, 60].map((width) => (
          <span key={width} className="flex flex-col gap-1.5">
            <span className="block aspect-video rounded-card bg-skeleton" />
            <span
              className="block h-2.5 rounded-badge bg-skeleton"
              style={{ width: `${width}%` }}
            />
            <span
              className="block h-2 rounded-badge bg-skeleton"
              style={{ width: `${width - 20}%` }}
            />
          </span>
        ))}
      </div>
      <p className="text-xs text-fg-subtle">Loading clips from the Feed…</p>
    </div>
  );
}

/** The first page didn't come: the rest of the editor still works. */
function Unreachable() {
  return (
    <div role="alert" className="flex flex-col items-start gap-2.5 px-3 py-4">
      <div className="flex items-center gap-2">
        <WarningIcon stroke="var(--color-danger)" />
        <h3 className="text-sm font-semibold">Can&rsquo;t reach the Feed</h3>
      </div>
      <p className="text-xs text-fg-muted">
        Its clips can&rsquo;t load right now. Your own files and the timeline keep working.
      </p>
      <RetryButton />
    </div>
  );
}

function RetryButton() {
  return (
    <SecondaryButton
      className="h-8 px-3"
      onClick={() => {
        void loadNextPage();
      }}
    >
      <RetryIcon size={14} />
      Retry
    </SecondaryButton>
  );
}

function NoClips() {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <p className="text-sm text-fg-subtle">No clips in this collection yet.</p>
    </div>
  );
}

function Cards({ clips, items }: { clips: CollectionClips; items: readonly FeedClip[] }) {
  const { total } = clips;
  const all = complete(clips);
  const count = items.length === 1 ? "1 clip" : `${items.length} clips`;
  const loaded = all
    ? items.length === 1
      ? "1 clip loaded"
      : `All ${count} loaded`
    : `${items.length} of ${total ?? items.length} clips loaded`;
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="grid grid-cols-2 gap-x-2 gap-y-3">
          {items.map((item) => (
            <li key={item.id} className="min-w-0">
              <FeedCard item={item} />
            </li>
          ))}
        </ul>
        {!all && <MoreClips clips={clips} />}
      </div>
      <p className="flex-none border-t border-line px-3 py-2.5 text-xs text-fg-subtle">
        {loaded} · AI-generated, from the Generation Feed
      </p>
    </>
  );
}

/**
 * The end of a list with more pages: the next one loads as this comes into view, or with the
 * button; one that didn't come says so, with Retry.
 */
function MoreClips({ clips }: { clips: CollectionClips }) {
  const ref = useRef<HTMLDivElement>(null);
  const { loading, failed } = clips;
  useEffect(() => {
    const element = ref.current;
    if (!element || failed || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadNextPage();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [failed, clips.items.length]);
  return (
    <div ref={ref} className="flex flex-col items-center gap-2 pt-3 text-center">
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-fg-subtle">
          <SpinnerIcon size={14} />
          Loading more clips…
        </p>
      ) : failed ? (
        <>
          <p role="alert" className="text-xs text-fg-muted">
            Couldn&rsquo;t load more clips.
          </p>
          <RetryButton />
        </>
      ) : (
        <SecondaryButton
          className="h-8 px-3"
          onClick={() => {
            void loadNextPage();
          }}
        >
          Load more clips
        </SecondaryButton>
      )}
    </div>
  );
}

/**
 * A clip from the Feed, as drawn: named by its visible text ("07-medium Kling 2.5 Pro"), as axe
 * asks; that it's AI-generated, its length and what Enter does are its description. Its file's
 * facts are read from the press on, so they're usually in by the click or the drop, and a drag's
 * preview takes them up as they come. The card is the Genframe Kit's MediaCard (installed with
 * `shadcn add`): a button, its poster over the clip's ThumbHash, at 16:9.
 */
function FeedCard({ item }: { item: FeedClip }) {
  // A drag onto the tracks ends with a click on the card, which mustn't add the clip again.
  const dragged = useRef(false);
  const [adding, setAdding] = useState(false);
  const name = feedClipName(item);
  const seconds = Number(item.durationSec.toFixed(2));
  const online = useOnline((state) => state.online);
  const offline = useFactsAtHand(item, !online) === false;
  const shown = adding ? "opacity-100" : "opacity-0";
  return (
    <MediaCard
      // Named by its caption, the text it shows.
      item={{ ...item, alt: "" }}
      getMediaUrl={posterUrls}
      formats={POSTER_FORMATS}
      widths={POSTER_WIDTHS}
      sizes={POSTER_SIZES}
      ratio={16 / 9}
      className="cursor-grab"
      busy={adding}
      description={`AI-generated, ${String(seconds)} seconds. ${offline ? "It needs a connection: you're offline." : "Enter adds it at the playhead."}`}
      onPointerDown={(event) => {
        dragged.current = false;
        void feedFacts(item).catch(() => undefined);
        pressAsset(
          event,
          () => feedAssetNow(item),
          () => {
            dragged.current = true;
          },
          (trackId, start, duration) => void addFeedClipAt(item, trackId, start, duration),
        );
      }}
      onOpen={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        setAdding(true);
        void addFeedClip(item).finally(() => {
          setAdding(false);
        });
      }}
      caption={
        <span className="mt-1.5 block min-w-0">
          <span className="block truncate text-sm">{name}</span>{" "}
          <span className="block truncate text-2xs text-fg-subtle">{item.model}</span>
        </span>
      }
    >
      {/* Offline, the clips this browser can't add are dimmed. */}
      {offline && <span className="absolute inset-0 bg-bg/70" />}
      <span
        className={`absolute inset-0 bg-bg/45 group-hover/media-card:opacity-100 group-focus-visible/media-card:opacity-100 ${shown}`}
      />
      <span
        aria-hidden="true"
        className={`absolute top-1/2 left-1/2 inline-flex h-[26px] -translate-1/2 items-center gap-1.5 rounded-pill bg-fg px-2 text-xs font-semibold whitespace-nowrap text-bg group-hover/media-card:opacity-100 group-focus-visible/media-card:opacity-100 ${shown}`}
      >
        {adding ? <SpinnerIcon size={14} /> : "Add ↵"}
      </span>
      <AiBadge className="top-1 left-1" />
      {offline && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1 rounded-badge bg-scrim px-1 text-2xs text-fg-muted"
        >
          Offline
        </span>
      )}
      <span
        aria-hidden="true"
        className="absolute right-1 bottom-1 rounded-badge bg-scrim px-1 font-mono text-2xs group-hover/media-card:opacity-0 group-focus-visible/media-card:opacity-0"
      >
        {formatLength(item.durationSec)}
      </span>
    </MediaCard>
  );
}

/**
 * Offline, whether a clip can still go on the timeline (its facts are in this browser); null while
 * that's being looked up, and online.
 */
function useFactsAtHand(item: FeedClip, check: boolean): boolean | null {
  const [atHand, setAtHand] = useState<boolean | null>(null);
  useEffect(() => {
    if (!check) return;
    let current = true;
    void factsAtHand(item).then((found) => {
      if (current) setAtHand(found);
    });
    return () => {
      current = false;
    };
  }, [item, check]);
  return check ? atHand : null;
}
