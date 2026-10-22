// The inspector's exact frame: the selected clip's in point, decoded by the
// decode worker at the preview's size, as the monitor's frames are. The preview shows the nearest
// thumbnail until it's in. Its own slot, "inspector", so the monitor's requests never cancel it;
// latest wins within it, and a frame replaced or no longer wanted is closed.

import { create } from "zustand";
import { previewLocation } from "../engine/picture.ts";
import { sourceSeconds } from "../engine/time.ts";
import type { Asset, Fps, Frames } from "../engine/types.ts";
import { type DecodeEvent, decodeWorker } from "./decode-client.ts";
import { LatestWins } from "./latest-wins.ts";

const SLOT = "inspector";

interface InspectorStill {
  /** Which frame `bitmap` is: the asset, its source frame and the size. */
  key: string | null;
  bitmap: ImageBitmap | null;
}

export const useInspectorStill = create<InspectorStill>(() => ({ key: null, bitmap: null }));

const latest = new LatestWins<string>();
/** The request being decoded, if any: its sequence number and the frame it's for. */
let pending: { seq: number; key: string } | null = null;
let listening = false;

export function stillKey(
  assetId: string,
  sourceFrame: Frames,
  fps: Fps,
  width: number,
  height: number,
) {
  return `${assetId}:${sourceFrame}@${fps}:${width}x${height}`;
}

/**
 * Asks for an asset's frame at the preview's size in device pixels, unless it's the one shown or
 * the one already being decoded. Back on the frame shown, a request for another is dropped.
 */
export function requestInspectorStill(
  asset: Asset,
  sourceFrame: Frames,
  fps: Fps,
  size: { width: number; height: number },
): void {
  const key = stillKey(asset.id, sourceFrame, fps, size.width, size.height);
  if (useInspectorStill.getState().key === key) {
    if (pending) latest.cancel(SLOT);
    pending = null;
    return;
  }
  if (pending?.key === key) return;
  if (!listening) {
    listening = true;
    decodeWorker.listen(receive);
  }
  const seq = latest.request(SLOT);
  pending = { seq, key };
  decodeWorker.still({
    slot: SLOT,
    seq,
    assetId: asset.id,
    location: previewLocation(asset),
    seconds: sourceSeconds(sourceFrame, fps),
    ...size,
  });
}

function receive(event: DecodeEvent): void {
  if ((event.type !== "still" && event.type !== "still-failed") || event.slot !== SLOT) return;
  const bitmap = event.type === "still" ? event.bitmap : null;
  const answered = pending?.seq === event.seq && latest.isLatest(SLOT, event.seq) ? pending : null;
  if (answered) pending = null;
  if (!answered || !bitmap) {
    // Stale, or no frame: the thumbnail stays.
    bitmap?.close();
    return;
  }
  useInspectorStill.getState().bitmap?.close();
  useInspectorStill.setState({ key: answered.key, bitmap });
}
