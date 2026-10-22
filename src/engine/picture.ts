// What the program monitor shows at a timeline frame (spec sections 3.1 and 4.2): each video
// track's clip there, bottom first, so V2 draws over V1. A clip shows source time
// `in + (frame − start)`, and the frame shown is the last source frame that starts at or before it.
// Each asset's media is read from where `previewLocation` says.

import { clipAt, findAsset } from "./project.ts";
import { sourceFrameAt } from "./time.ts";
import type { Asset, Clip, Frames, Project } from "./types.ts";

/** One video track's picture at a frame. */
export interface Layer {
  trackId: string;
  clip: Clip;
  asset: Asset;
  /** The source frame it shows, counted in project frames from the source's start. */
  sourceFrame: Frames;
}

/** The video tracks' clips at a frame, bottom first: V1's, then V2's over it. */
export function layersAt(project: Project, frame: Frames): Layer[] {
  const layers: Layer[] = [];
  for (const track of project.tracks.toReversed()) {
    if (track.kind !== "video") continue;
    const clip = clipAt(track, frame);
    const asset = clip && findAsset(project, clip.assetId);
    const sourceFrame = clip ? sourceFrameAt(clip, frame) : null;
    if (clip && asset && sourceFrame !== null) {
      layers.push({ trackId: track.id, clip, asset, sourceFrame });
    }
  }
  return layers;
}

/** Where a decoder reads an asset's media: its copy in this browser's storage, or an address. */
export type MediaLocation = { type: "file"; opfsPath: string } | { type: "url"; url: string };

/**
 * Where the preview (the monitor, playback and the inspector) reads an asset's media. A Feed clip
 * previews from the Feed's 720p file, which decodes its exact frames in time over the network;
 * its 1080p original, ten times the size, is for export (docs/PERF.md, M5).
 */
export function previewLocation(asset: Asset): MediaLocation {
  switch (asset.source.type) {
    case "file":
      return { type: "file", opfsPath: asset.source.opfsPath };
    case "feed":
      return { type: "url", url: asset.source.videoUrl };
    case "url":
      return { type: "url", url: asset.source.url };
  }
}

/**
 * Where an export reads an asset's media. A Feed clip in a 1080p export is read from its 1080p
 * original, only the seconds the cut uses (range requests); in a 720p export, from the Feed's 720p
 * file, which is already that size. A file is read from its copy in storage, as for the preview.
 */
export function exportLocation(asset: Asset, height: number): MediaLocation {
  if (asset.source.type !== "feed") return previewLocation(asset);
  return { type: "url", url: height > 720 ? asset.source.url : asset.source.videoUrl };
}

/** A location as one string, to tell two apart. */
export function locationKey(location: MediaLocation): string {
  return location.type === "file" ? `file:${location.opfsPath}` : `url:${location.url}`;
}
