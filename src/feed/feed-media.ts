// A Feed clip's facts, before it goes on the timeline (spec section 4.5): its length and frame rate
// as its file says. The Feed's own `durationSec` is rounded (a "5 s" clip is 121 frames, 5.04 s),
// and the frame rate isn't in the API at all, so an empty project could take it (spec 4.10). They
// come back from storage when an earlier session kept them with the clip's thumbnails
// (src/media/remote-media.ts); else the import worker reads the Feed's 720p file's header with a
// range request. Once per clip a session; a clip that couldn't be read is tried again next time.

import type { Asset } from "../engine/types.ts";
import { importWorker } from "../media/import-client.ts";
import { storedRemoteMeta } from "../media/remote-media.ts";
import {
  type FeedClip,
  type FeedClipFacts,
  feedAsset,
  feedAssetId,
  feedClipName,
} from "./feed-clip.ts";
import { MEDIA_ORIGIN, mediaUrl } from "./feed-urls.ts";

/**
 * A clip that can't go on the timeline, and the sentence that says why. `unreachable`: its file
 * didn't answer, so a later try may work; otherwise this browser can't decode it.
 */
export class FeedClipError extends Error {
  readonly unreachable: boolean;

  constructor(message: string, unreachable: boolean) {
    super(message);
    this.unreachable = unreachable;
  }
}

const probing = new Map<string, Promise<FeedClipFacts>>();
/** The facts in hand, for code that can't wait (a drag's ghost). */
const known = new Map<string, FeedClipFacts>();

/** A clip's facts: kept, read back from storage, or read from its file. */
export function feedFacts(item: FeedClip): Promise<FeedClipFacts> {
  const assetId = feedAssetId(item);
  let facts = probing.get(assetId);
  if (!facts) {
    facts = readFacts(item, assetId);
    probing.set(assetId, facts);
    facts.then(
      (found) => known.set(assetId, found),
      () => probing.delete(assetId),
    );
  }
  return facts;
}

async function readFacts(item: FeedClip, assetId: string): Promise<FeedClipFacts> {
  const stored = await storedRemoteMeta(assetId);
  if (stored) return { durationSec: stored.facts.durationSec, fps: stored.facts.fps };
  const name = feedClipName(item);
  const url = mediaUrl(MEDIA_ORIGIN, item.videoKey);
  const analysis = await importWorker.probe(url).catch(() => null);
  if (analysis === null) {
    throw new FeedClipError(
      `Couldn't add ${name}: the Feed's file didn't answer. Check your connection and try again.`,
      true,
    );
  }
  if (!analysis.ok || analysis.facts.kind !== "video") {
    throw new FeedClipError(
      `Can't play ${name} in this browser: its video doesn't decode here.`,
      false,
    );
  }
  return { durationSec: analysis.facts.durationSec, fps: analysis.facts.fps };
}

/**
 * Whether a clip can go on the timeline without the network: its file's facts are in hand, or an
 * earlier session stored them with its thumbnails. Offline, the Feed tab dims the rest.
 */
export async function factsAtHand(item: FeedClip): Promise<boolean> {
  const assetId = feedAssetId(item);
  return known.has(assetId) || (await storedRemoteMeta(assetId)) !== null;
}

/** A clip as an asset, with its file's facts, ready to place. */
export async function feedAssetFor(item: FeedClip): Promise<Asset> {
  return feedAsset(item, await feedFacts(item));
}

/**
 * A clip as an asset right now, for a drag's ghost: with its file's facts once they're in, else
 * with the Feed's rounded length and no frame rate. The drop places `feedAssetFor`'s.
 */
export function feedAssetNow(item: FeedClip): Asset {
  return feedAsset(
    item,
    known.get(feedAssetId(item)) ?? { durationSec: item.durationSec, fps: null },
  );
}
