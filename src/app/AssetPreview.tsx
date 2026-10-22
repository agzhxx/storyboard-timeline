// An asset's picture in the inspector: a video's frame at a source frame (the clip's in point), or
// a note for music. A video shows its nearest thumbnail; with `exact`, the decode worker's exact
// frame replaces it once it's in (src/media/inspector-still.ts). The monitor draws its own,
// following the playhead.

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Asset, Fps, Frames } from "../engine/types.ts";
import { requestInspectorStill, stillKey, useInspectorStill } from "../media/inspector-still.ts";
import { requestMedia } from "../media/library.ts";
import { useThumbnails } from "../media/media-cache.ts";
import { thumbnailCount, thumbnailIndexAt } from "../media/thumbnails.ts";
import { canvasContext, devicePixels, drawContained } from "../timeline/draw.ts";
import { MusicIcon } from "./icons.tsx";

export function AssetPreview({
  asset,
  sourceFrame,
  fps,
  exact = false,
  className,
}: {
  asset: Asset;
  /** The source frame to show, in project frames from the source's start. */
  sourceFrame: Frames;
  fps: Fps;
  /** Whether to decode the exact frame, for a preview big enough to tell it from the thumbnail. */
  exact?: boolean;
  /** Its size and corners. */
  className: string;
}) {
  if (asset.kind === "audio") {
    return (
      <div
        aria-hidden="true"
        className={`flex items-center justify-center bg-skeleton text-fg-muted ${className}`}
      >
        <MusicIcon />
      </div>
    );
  }
  return (
    <FrameCanvas
      asset={asset}
      count={thumbnailCount(asset.durationSec)}
      sourceFrame={sourceFrame}
      fps={fps}
      exact={exact}
      className={className}
    />
  );
}

/**
 * A video's frame, fitted to the canvas's box: the thumbnail taken at or before it, then, when
 * `exact`, the exact frame once the decode worker has it.
 */
function FrameCanvas({
  asset,
  count,
  sourceFrame,
  fps,
  exact,
  className,
}: {
  asset: Asset;
  /** How many thumbnails the video has, made or not. */
  count: number;
  sourceFrame: Frames;
  fps: Fps;
  exact: boolean;
  className: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const assetId = asset.id;
  const thumbnails = useThumbnails(assetId);
  const still = useInspectorStill((state) => (exact ? state : null));
  useEffect(() => {
    requestMedia(asset);
  }, [asset]);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { clientWidth: width, clientHeight: height } = canvas;
    const pixels = devicePixels(width, height);
    if (exact) requestInspectorStill(asset, sourceFrame, fps, pixels);
    const context = canvasContext(canvas, width, height);
    const key = stillKey(assetId, sourceFrame, fps, pixels.width, pixels.height);
    const image =
      (still?.key === key ? still.bitmap : null) ??
      thumbnails[thumbnailIndexAt(sourceFrame / fps, count)];
    // Until a picture is in, the box is black, not another clip's.
    if (!context) return;
    if (image) drawContained(context, image, width, height);
    else context.clearRect(0, 0, width, height);
  }, [asset, assetId, count, exact, fps, sourceFrame, still, thumbnails]);
  return <canvas ref={ref} aria-hidden="true" className={`bg-monitor ${className}`} />;
}
