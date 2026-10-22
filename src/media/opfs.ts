// Where imported files live: the browser's origin private file system
// (OPFS), which only this site can read. Each file gets a folder:
//
//   assets/<asset id>/source.mp4        the copy, with the file's own extension
//                     peaks.bin         an audio file's waveform peaks
//                     meta.json         what the import learned, written with the copy
//                     thumbs/0.webp …   one thumbnail per second of a video (or .jpg)
//                     thumbnails.json   how many there are, written once they're made
//
// A folder without meta.json is a copy that never finished. Once copied, a file can go on the
// timeline, so meta.json comes with the copy and is never written again: a tab that closes while
// the thumbnails are made loses only them, and the next start makes them again (builds before M7
// wrote meta.json last, with the thumbnails' count in it). The media bin rebuilds "My files" from
// the meta.json files at startup, on the main thread and without the worker.
//
// The Feed's clips aren't copied (spec section 4.5), but their thumbnails are kept, so filmstrips
// come back after a reload without fetching the clips again:
//
//   remote/<asset id>/thumbs/0.webp …   (the asset id names the Feed item and its version)
//                     meta.json         the video's facts, written once every thumbnail is in
//
// The worker does all the writing, with sync access handles; the main thread only reads and
// deletes. Both go through `Folder`, which the tests fake in memory.

import type { MediaFacts, VideoFacts } from "./facts.ts";
import { THUMBNAIL_EXTENSIONS, type ThumbnailType } from "./thumbnails.ts";

export const ASSETS_FOLDER = "assets";
export const REMOTE_FOLDER = "remote";
export const META_FILE = "meta.json";
export const THUMBNAILS_FOLDER = "thumbs";
export const THUMBNAILS_FILE = "thumbnails.json";
export const PEAKS_FILE = "peaks.bin";

/** What tells two files apart for importing: the same name, size and last change is the same file. */
export interface FileKey {
  name: string;
  size: number;
  lastModified: number;
}

/** Whether two files are one: a second import reuses the first. */
export function sameFile(a: FileKey, b: FileKey): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

/** A video's thumbnails in storage: how many there are, and their type. */
export interface StoredThumbnails {
  count: number;
  type: ThumbnailType;
}

/** meta.json: everything the bin and the timeline need, without reading the media again. */
export type StoredMedia = FileKey &
  MediaFacts & {
    version: 1;
    id: string;
    /** The copy's file name in the asset's folder, such as "source.mp4". */
    source: string;
    /** When the import started, which keeps the bin in import order after a reload. */
    importedAt: number;
    /** A video's thumbnails, read from thumbnails.json (or from meta.json, before M7). */
    thumbnails?: StoredThumbnails;
  };

/** "source.mp4" for "05-wide.MP4": the extension in lowercase, if it's a plain one. */
export function sourceFileName(name: string): string {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
  return extension === undefined ? "source" : `source.${extension.toLowerCase()}`;
}

export function thumbnailFileName(index: number, type: ThumbnailType): string {
  return `${index}.${THUMBNAIL_EXTENSIONS[type]}`;
}

/** The copy's path from the OPFS root, for the asset's `source.opfsPath`. */
export function sourcePath(media: Pick<StoredMedia, "id" | "source">): string {
  return `${ASSETS_FOLDER}/${media.id}/${media.source}`;
}

/** meta.json read back, or null when it isn't one this version wrote. */
export function parseStoredMedia(json: unknown): StoredMedia | null {
  if (typeof json !== "object" || json === null) return null;
  const value = json as Record<string, unknown>;
  const text = (key: string) => typeof value[key] === "string";
  const number = (key: string) => typeof value[key] === "number" && Number.isFinite(value[key]);
  const common =
    value.version === 1 &&
    ["id", "source", "name", "container"].every(text) &&
    ["size", "lastModified", "importedAt", "durationSec"].every(number) &&
    (value.codec === null || text("codec"));
  if (!common) return null;
  if (value.kind === "audio") {
    return number("channels") && number("sampleRate") ? (json as StoredMedia) : null;
  }
  if (value.kind !== "video" || !number("width") || !number("height")) return null;
  if (value.fps !== null && !number("fps")) return null;
  const typed = value.thumbnails === undefined || parseThumbnails(value.thumbnails) !== null;
  return typed ? (json as StoredMedia) : null;
}

/** thumbnails.json read back, or null when it isn't one. */
export function parseThumbnails(json: unknown): StoredThumbnails | null {
  if (typeof json !== "object" || json === null) return null;
  const { count, type } = json as Record<string, unknown>;
  if (typeof count !== "number" || !Number.isSafeInteger(count)) return null;
  return type === "image/webp" || type === "image/jpeg" ? { count, type } : null;
}

/** remote/<asset id>/meta.json: a remote video's facts and its thumbnails in storage. */
export interface RemoteMeta {
  version: 1;
  id: string;
  facts: VideoFacts;
  thumbnails: { count: number; type: ThumbnailType };
}

/** A remote video's meta.json read back, or null when it isn't one this version wrote. */
export function parseRemoteMeta(json: unknown): RemoteMeta | null {
  if (typeof json !== "object" || json === null) return null;
  const value = json as Record<string, unknown>;
  if (value.version !== 1 || typeof value.id !== "string") return null;
  const facts = value.facts as Record<string, unknown> | null | undefined;
  const thumbnails = value.thumbnails as Record<string, unknown> | null | undefined;
  const finite = (number: unknown) => typeof number === "number" && Number.isFinite(number);
  const factsOk =
    typeof facts === "object" &&
    facts !== null &&
    facts.kind === "video" &&
    finite(facts.durationSec) &&
    finite(facts.width) &&
    finite(facts.height) &&
    (facts.fps === null || finite(facts.fps));
  const thumbnailsOk =
    typeof thumbnails === "object" &&
    thumbnails !== null &&
    typeof thumbnails.count === "number" &&
    Number.isSafeInteger(thumbnails.count) &&
    (thumbnails.type === "image/webp" || thumbnails.type === "image/jpeg");
  return factsOk && thumbnailsOk ? (json as RemoteMeta) : null;
}

/** A folder in OPFS, or in memory in the tests: only what reading and deleting need. */
export interface Folder {
  /** The names of the folders in it. */
  folders(): Promise<string[]>;
  /** A folder in it; null when there's none by that name. */
  folder(name: string): Promise<Folder | null>;
  /** A file in it; null when there's none by that name. */
  file(name: string): Promise<Blob | null>;
  /** Deletes a file or a folder in it, with everything inside; nothing when it isn't there. */
  remove(name: string): Promise<void>;
}

/** OPFS's root as a `Folder`; null where the browser has none or won't open it (private windows). */
export async function openStorage(): Promise<Folder | null> {
  try {
    return opfsFolder(await navigator.storage.getDirectory());
  } catch {
    return null;
  }
}

function opfsFolder(handle: FileSystemDirectoryHandle): Folder {
  const notFound = (error: unknown) =>
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "TypeMismatchError");
  return {
    async folders() {
      const names: string[] = [];
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === "directory") names.push(name);
      }
      return names;
    },
    async folder(name) {
      try {
        return opfsFolder(await handle.getDirectoryHandle(name));
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    async file(name) {
      try {
        return await (await handle.getFileHandle(name)).getFile();
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    async remove(name) {
      try {
        await handle.removeEntry(name, { recursive: true });
      } catch (error) {
        if (!notFound(error)) throw error;
      }
    },
  };
}

/**
 * Every stored copy, oldest first, with its video's thumbnails if they were all made. A folder
 * without a readable meta.json is a copy that stopped halfway, such as when the tab closed during
 * it: it's deleted, unless `keep` says another tab may still be writing it.
 */
export async function readLibrary(
  root: Folder,
  keep: (assetId: string) => boolean = () => false,
): Promise<StoredMedia[]> {
  const assets = await root.folder(ASSETS_FOLDER);
  if (!assets) return [];
  const found: StoredMedia[] = [];
  for (const id of await assets.folders()) {
    try {
      const folder = await assets.folder(id);
      const meta = await folder?.file(META_FILE);
      const media = meta ? parseStoredMedia(parseJson(await meta.text())) : null;
      if (folder && media?.id === id) found.push(await withThumbnails(folder, media));
      else if (!keep(id)) await assets.remove(id);
    } catch {
      // A folder this browser won't read or delete right now waits for the next start; the rest
      // of My files still comes back.
    }
  }
  return found.sort((a, b) => a.importedAt - b.importedAt);
}

/**
 * A video's thumbnails from its thumbnails.json, unless its meta.json has them (before M7). One
 * that can't be read leaves them out, which only means they're made again: the copy is listed.
 */
async function withThumbnails(folder: Folder, media: StoredMedia): Promise<StoredMedia> {
  if (media.kind !== "video" || media.thumbnails) return media;
  try {
    const record = await folder.file(THUMBNAILS_FILE);
    const thumbnails = record ? parseThumbnails(parseJson(await record.text())) : null;
    return thumbnails ? { ...media, thumbnails } : media;
  } catch {
    return media;
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A file by its path from the root, such as an asset's `opfsPath`; null when it's missing. */
export async function readPath(root: Folder, path: string): Promise<Blob | null> {
  const parts = path.split("/");
  const name = parts.pop();
  let folder: Folder | null = root;
  for (const part of parts) folder = (await folder?.folder(part)) ?? null;
  return name === undefined ? null : ((await folder?.file(name)) ?? null);
}

/** A file in an asset's folder, or in its thumbs folder; null when it's missing. */
export async function readAssetFile(
  root: Folder,
  assetId: string,
  name: string,
  inThumbnails = false,
  parent = ASSETS_FOLDER,
): Promise<Blob | null> {
  let folder = await (await root.folder(parent))?.folder(assetId);
  if (inThumbnails) folder = await folder?.folder(THUMBNAILS_FOLDER);
  return (await folder?.file(name)) ?? null;
}

/** The part of a FileSystemSyncAccessHandle that writing a file uses. */
export interface SyncWriter {
  write: (buffer: Uint8Array, options: { at: number }) => number;
  truncate: (size: number) => void;
  flush: () => void;
}

/** How much of a file the copy reads and writes at a time. */
export const COPY_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * Copies a file into OPFS through a sync access handle, one chunk at a time so a large file never
 * sits in memory whole, reporting the share copied after each chunk. When storage runs out,
 * `write` throws a QuotaExceededError, which this lets through.
 */
export async function copyInChunks(
  file: Blob,
  writer: SyncWriter,
  onProgress: (fraction: number) => void,
  chunkBytes = COPY_CHUNK_BYTES,
): Promise<void> {
  writer.truncate(0);
  for (let at = 0; at < file.size; at += chunkBytes) {
    const chunk = new Uint8Array(await file.slice(at, at + chunkBytes).arrayBuffer());
    writeAll(writer, chunk, at);
    onProgress(Math.min(file.size, at + chunkBytes) / file.size);
  }
  writer.flush();
}

/** Writes all of `bytes` at a position, however many calls that takes. */
export function writeAll(writer: SyncWriter, bytes: Uint8Array, at = 0): void {
  for (let done = 0; done < bytes.length;) {
    const written = writer.write(bytes.subarray(done), { at: at + done });
    if (written <= 0) throw new Error("The file stopped taking data.");
    done += written;
  }
}

/** Whether an error says the browser's storage for this site is full. */
export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}
