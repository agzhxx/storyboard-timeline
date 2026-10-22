// The pictures and peaks the editor draws imported files with, held in memory once made or read
// back: a video's thumbnails as ImageBitmaps (for the filmstrips, the monitor and the inspector),
// its first one also as an object URL (for the bin's <img>), and an audio file's peaks with their
// coarser levels. The import fills it as the worker makes them; after a reload, src/media/
// library.ts reads them back from OPFS when something first draws them. Each change is a new
// list or entry, so a component that draws an asset re-renders when its media changes.

import { create } from "zustand";
import {
  ASSETS_FOLDER,
  type Folder,
  PEAKS_FILE,
  readAssetFile,
  thumbnailFileName,
} from "./opfs.ts";
import { decodePeaks, peakLevels, type PeakLevels, type Peaks } from "./peaks.ts";
import type { ThumbnailType } from "./thumbnails.ts";

type Thumbnails = readonly (ImageBitmap | undefined)[];

interface MediaCache {
  /** Each video's thumbnails by second; a gap is one not made or read yet. */
  thumbnails: Record<string, Thumbnails | undefined>;
  /** Each video's first thumbnail, as an object URL. */
  posters: Record<string, string | undefined>;
  peaks: Record<string, PeakLevels | undefined>;
}

export const useMediaCache = create<MediaCache>(() => ({ thumbnails: {}, posters: {}, peaks: {} }));

const NONE: Thumbnails = [];

export function useThumbnails(assetId: string): Thumbnails {
  return useMediaCache((cache) => cache.thumbnails[assetId] ?? NONE);
}

export function usePoster(assetId: string): string | undefined {
  return useMediaCache((cache) => cache.posters[assetId]);
}

export function usePeaks(assetId: string): PeakLevels | undefined {
  return useMediaCache((cache) => cache.peaks[assetId]);
}

/** Keeps a thumbnail: decoded into a bitmap for drawing, and the first also as the poster. */
export async function addThumbnail(assetId: string, index: number, blob: Blob): Promise<void> {
  if (index === 0) {
    const previous = useMediaCache.getState().posters[assetId];
    if (previous !== undefined) URL.revokeObjectURL(previous);
    const poster = URL.createObjectURL(blob);
    useMediaCache.setState(({ posters }) => ({ posters: { ...posters, [assetId]: poster } }));
  }
  const bitmap = await createImageBitmap(blob);
  const list = [...(useMediaCache.getState().thumbnails[assetId] ?? NONE)];
  list[index]?.close();
  list[index] = bitmap;
  useMediaCache.setState(({ thumbnails }) => ({ thumbnails: { ...thumbnails, [assetId]: list } }));
}

export function addPeaks(assetId: string, computed: Peaks): void {
  useMediaCache.setState(({ peaks }) => ({ peaks: { ...peaks, [assetId]: peakLevels(computed) } }));
}

/**
 * Reads a stored video's thumbnails back, from `first` on (the poster is thumbnail 0), from its
 * folder in `parent`: "assets" for a file, "remote" for a Feed clip.
 */
export async function readThumbnails(
  root: Folder,
  assetId: string,
  { count, type }: { count: number; type: ThumbnailType },
  first = 0,
  parent = ASSETS_FOLDER,
): Promise<void> {
  for (let index = first; index < count; index += 1) {
    const name = thumbnailFileName(index, type);
    const blob = await readAssetFile(root, assetId, name, true, parent);
    if (blob) await addThumbnail(assetId, index, blob);
  }
}

/** Reads a stored audio file's peaks back; nothing when they're missing or unreadable. */
export async function readPeaks(root: Folder, assetId: string): Promise<void> {
  const blob = await readAssetFile(root, assetId, PEAKS_FILE);
  const stored = blob && decodePeaks(await blob.arrayBuffer());
  if (stored) addPeaks(assetId, stored);
}

/** New project: lets go of everything held for every asset. */
export function forgetAllMedia(): void {
  const { thumbnails, posters } = useMediaCache.getState();
  for (const list of Object.values(thumbnails)) for (const bitmap of list ?? NONE) bitmap?.close();
  for (const poster of Object.values(posters))
    if (poster !== undefined) URL.revokeObjectURL(poster);
  useMediaCache.setState({ thumbnails: {}, posters: {}, peaks: {} });
}

/** Lets go of everything held for an asset. */
export function forget(assetId: string): void {
  const { thumbnails, posters, peaks } = useMediaCache.getState();
  for (const bitmap of thumbnails[assetId] ?? NONE) bitmap?.close();
  const poster = posters[assetId];
  if (poster !== undefined) URL.revokeObjectURL(poster);
  const without = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => id !== assetId));
  useMediaCache.setState({
    thumbnails: without(thumbnails),
    posters: without(posters),
    peaks: without(peaks),
  });
}
