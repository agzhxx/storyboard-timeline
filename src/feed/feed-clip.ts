// A video from the Feed, and the asset it becomes in the document (spec sections 4.3 and 4.9).
// No zod here: the bin and the story use these, and only the Feed client brings the schema.

import type { Asset } from "../engine/types.ts";
import { MEDIA_ORIGIN, mediaUrl, originalKey } from "./feed-urls.ts";
import type { MediaItem } from "./media-item.ts";

/** A Feed item that's a video, with the fields the schema promises every video has. */
export type FeedClip = MediaItem & { kind: "video"; videoKey: string; durationSec: number };

export function isFeedClip(item: MediaItem): item is FeedClip {
  return item.kind === "video" && item.videoKey !== undefined && item.durationSec !== undefined;
}

/** What the import worker reads from a clip's file: its length and frame rate. */
export interface FeedClipFacts {
  durationSec: number;
  /** Null when its frames follow no steady rate. */
  fps: number | null;
}

/**
 * What a clip is called in the bin and on the timeline: its shot ("07-medium"), its camera move
 * ("whip-pan"), or the first words of its prompt ("The glowing whale swims slowly…").
 */
export function feedClipName(item: MediaItem): string {
  if (item.shot !== undefined) return item.shot;
  if (item.cameraMove !== undefined) return item.cameraMove;
  const clause = item.prompt.split(",")[0]?.trim() ?? item.prompt;
  const words = clause.split(/\s+/);
  return words.length <= 5 ? clause : `${words.slice(0, 5).join(" ")}…`;
}

/**
 * The asset's id: the item and the version of its media, from its storage key ("v1" in
 * "m/<id>/v1"). The same clip added twice is one asset; a version the Feed made again is another.
 */
export function feedAssetId(item: MediaItem): string {
  const version =
    item.posterKey
      .split("/")
      .at(-1)
      ?.replace(/[^a-z0-9]/gi, "") || "v0";
  return `feed-${item.id}-${version}`;
}

/**
 * The asset for a Feed clip: read from its address, never copied. Its size is the original's,
 * which export uses; its length and frame rate are what its file says (they match the original's).
 */
export function feedAsset(item: FeedClip, facts: FeedClipFacts): Asset {
  return {
    id: feedAssetId(item),
    kind: "video",
    name: feedClipName(item),
    source: {
      type: "feed",
      itemId: item.id,
      url: mediaUrl(MEDIA_ORIGIN, originalKey(item)),
      videoUrl: mediaUrl(MEDIA_ORIGIN, item.videoKey),
      ...(item.previewKey === undefined
        ? {}
        : { previewUrl: mediaUrl(MEDIA_ORIGIN, item.previewKey) }),
      model: item.model,
    },
    durationSec: facts.durationSec,
    width: item.width,
    height: item.height,
    ...(facts.fps === null ? {} : { fps: facts.fps }),
  };
}

/** Shot order, "01-wide" to "15-wide"; clips without a shot after them, as they came. */
export function byShot(a: FeedClip, b: FeedClip): number {
  // "~" sorts after every character a shot's name can have.
  const shotA = a.shot ?? "~";
  const shotB = b.shot ?? "~";
  return shotA < shotB ? -1 : shotA > shotB ? 1 : 0;
}

/** The story's clips in shot order: the order of the cut (spec 4.10). */
export function inShotOrder(items: readonly FeedClip[]): FeedClip[] {
  return items.filter((item) => item.shot !== undefined).toSorted(byShot);
}
