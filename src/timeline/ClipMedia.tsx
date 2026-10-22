// What a clip shows (Clip states board): a video's frames as a filmstrip, or music's waveform from
// its peaks, drawn on canvases in tiles along the source near the view (src/timeline/tiles.ts). A
// tile redraws when the zoom or the asset's thumbnails or peaks change; scrolling, moving and
// trimming the clip only move it.

import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { useUiStore } from "../engine/store.ts";
import type { Asset, Fps, Frames } from "../engine/types.ts";
import { requestMedia } from "../media/library.ts";
import { usePeaks, useThumbnails } from "../media/media-cache.ts";
import { canvasContext, drawFilmstrip, drawWaveform, WAVEFORM_COLORS } from "./draw.ts";
import { filmstripSlots, tilesInView, tileWidthFor, waveformBars } from "./tiles.ts";

interface ClipMediaProps {
  asset: Asset;
  /** A video's width over its height, for its thumbnails' slots. */
  aspect: number;
  /** How many thumbnails the video has, made or not: a slot whose thumbnail isn't in yet stays empty. */
  thumbnailCount: number;
  /** Where the clip is drawn on the tracks, and how big. */
  left: number;
  width: number;
  height: number;
  /** The source frame at the clip's left edge (it moves while the clip's start is trimmed). */
  inPoint: Frames;
  /** How many frames the source has: where the strip ends. */
  sourceFrames: Frames;
  pxPerFrame: number;
  fps: Fps;
  selected: boolean;
  /** Its frames wouldn't decode: the picture shows at 40 %, under the error badge. */
  dimmed: boolean;
}

export const ClipMedia = memo(function ClipMedia({
  asset,
  left,
  width,
  inPoint,
  sourceFrames,
  pxPerFrame,
  ...tile
}: ClipMediaProps) {
  useEffect(() => {
    requestMedia(asset);
  }, [asset]);
  const tileWidth = tileWidthFor(window.devicePixelRatio);
  const inX = inPoint * pxPerFrame;
  // Re-renders only when another tile comes into view, not on every scroll.
  const range = useUiStore((state) => {
    const view = { clipLeft: left, clipWidth: width, inX, tileWidth };
    const tiles = tilesInView({
      ...view,
      scrollX: state.scrollX,
      viewportWidth: state.viewportWidth,
    });
    return tiles ? `${tiles.first}:${tiles.last}` : "";
  });
  if (range === "") return null;
  const [first = 0, last = -1] = range.split(":").map(Number);
  const stripWidth = sourceFrames * pxPerFrame;
  const tiles: number[] = [];
  for (let index = first; index <= last; index += 1) tiles.push(index);
  return tiles.map((index) => {
    const from = index * tileWidth;
    return (
      <MediaTile
        key={index}
        {...tile}
        assetId={asset.id}
        kind={asset.kind}
        pxPerFrame={pxPerFrame}
        from={from}
        tileWidth={Math.min(tileWidth, stripWidth - from)}
        left={from - inX}
      />
    );
  });
});

interface MediaTileProps {
  assetId: string;
  kind: "video" | "audio";
  aspect: number;
  thumbnailCount: number;
  height: number;
  pxPerFrame: number;
  fps: Fps;
  selected: boolean;
  dimmed: boolean;
  /** Where the tile starts along the source strip, and how wide it is. */
  from: number;
  tileWidth: number;
  /** Where it sits from the clip's left edge. */
  left: number;
}

const MediaTile = memo(function MediaTile({
  assetId,
  kind,
  aspect,
  thumbnailCount,
  height,
  pxPerFrame,
  fps,
  selected,
  dimmed,
  from,
  tileWidth: width,
  left,
}: MediaTileProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const thumbnails = useThumbnails(assetId);
  const peaks = usePeaks(assetId);
  // The waveform's color follows the selection; a filmstrip doesn't change with it.
  const color = kind === "audio" && selected ? WAVEFORM_COLORS.selected : WAVEFORM_COLORS.normal;

  useLayoutEffect(() => {
    const canvas = ref.current;
    const context = canvas && canvasContext(canvas, width, height);
    if (!context) return;
    const secondsPerPixel = 1 / (pxPerFrame * fps);
    if (kind === "video") {
      const slotWidth = height * aspect;
      const count = thumbnailCount;
      const slots = filmstripSlots(from, from + width, { slotWidth, count, secondsPerPixel });
      drawFilmstrip(context, { from, width, height, slots, slotWidth, thumbnails });
    } else if (peaks) {
      const bars = waveformBars(from, from + width, secondsPerPixel);
      drawWaveform(context, { from, width, height, bars, peaks, color });
    }
  }, [
    kind,
    aspect,
    thumbnailCount,
    from,
    width,
    height,
    pxPerFrame,
    fps,
    thumbnails,
    peaks,
    color,
  ]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute top-0 ${dimmed ? "opacity-40" : ""}`}
      style={{ left, width, height }}
    />
  );
});
