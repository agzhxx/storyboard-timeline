// The import of each file in "My files" (spec section 3.6), as a pure state machine. The media
// bin's rows render from it:
//
//   queued → analyzing → copying → thumbnails (videos only) → ready
//
// and from any step before ready, unsupported (the browser can't open it) or failed (it couldn't
// be read or stored). A file is read before it's copied, so a file the browser can't open is never
// copied. It can go on the timeline once it's copied: its length is known
// and its media is on this device. Its thumbnails then fill its filmstrip as they're made.

import type { Asset } from "../engine/types.ts";
import type { MediaFacts } from "./facts.ts";
import { type FileKey, sameFile, sourceFileName, sourcePath, type StoredMedia } from "./opfs.ts";
import { thumbnailCount, type ThumbnailType } from "./thumbnails.ts";

export type ImportStep =
  | { step: "queued" }
  | { step: "analyzing" }
  | { step: "copying"; progress: number }
  | { step: "thumbnails"; done: number; total: number }
  | { step: "ready" }
  | { step: "unsupported"; message: string }
  | { step: "failed"; message: string };

export interface ImportEntry extends FileKey {
  id: string;
  /** When it was added: the bin's order, also after a reload. */
  importedAt: number;
  status: ImportStep;
  /** What reading the file found; null until it's been read. */
  facts: MediaFacts | null;
  /** A video's thumbnails in storage, for loading them after a reload. */
  thumbnails: { count: number; type: ThumbnailType } | null;
}

export type ImportEvent =
  | { type: "added"; entries: (FileKey & { id: string; importedAt: number })[] }
  | { type: "restored"; media: StoredMedia[] }
  | { type: "started"; id: string }
  | { type: "analyzed"; id: string; facts: MediaFacts }
  | { type: "copy-progress"; id: string; progress: number }
  | { type: "copied"; id: string }
  | { type: "thumbnail-made"; id: string; imageType: ThumbnailType }
  | { type: "finished"; id: string }
  | { type: "unsupported"; id: string; message: string }
  | { type: "failed"; id: string; message: string }
  | { type: "removed"; id: string };

/** Applies one event. Events that don't fit the entry's step, or name no entry, change nothing. */
export function importReducer(entries: ImportEntry[], event: ImportEvent): ImportEntry[] {
  switch (event.type) {
    case "added": {
      const known = new Set(entries.map((entry) => entry.id));
      const added = event.entries
        .filter((file) => !known.has(file.id))
        .map((file): ImportEntry => ({
          ...file,
          status: { step: "queued" },
          facts: null,
          thumbnails: null,
        }));
      return added.length === 0 ? entries : [...entries, ...added];
    }
    case "restored": {
      const restored = event.media.map((media): ImportEntry => ({
        id: media.id,
        name: media.name,
        size: media.size,
        lastModified: media.lastModified,
        importedAt: media.importedAt,
        status: { step: "ready" },
        facts: factsOf(media),
        thumbnails: media.thumbnails ?? null,
      }));
      const ids = new Set(restored.map((entry) => entry.id));
      return [...restored, ...entries.filter((entry) => !ids.has(entry.id))];
    }
    case "removed":
      return entries.some((entry) => entry.id === event.id)
        ? entries.filter((entry) => entry.id !== event.id)
        : entries;
    default:
      return update(entries, event.id, (entry) => step(entry, event));
  }
}

function update(
  entries: ImportEntry[],
  id: string,
  change: (entry: ImportEntry) => ImportEntry,
): ImportEntry[] {
  const index = entries.findIndex((entry) => entry.id === id);
  const entry = entries[index];
  if (!entry) return entries;
  const updated = change(entry);
  return updated === entry ? entries : entries.toSpliced(index, 1, updated);
}

/** One entry's next state, or the entry itself when the event doesn't fit its step. */
function step(
  entry: ImportEntry,
  event: Exclude<ImportEvent, { type: "added" | "restored" | "removed" }>,
) {
  const { status } = entry;
  switch (event.type) {
    case "started":
      return status.step === "queued"
        ? { ...entry, status: { step: "analyzing" as const } }
        : entry;
    case "analyzed":
      return status.step === "analyzing"
        ? { ...entry, facts: event.facts, status: { step: "copying" as const, progress: 0 } }
        : entry;
    case "copy-progress": {
      if (status.step !== "copying") return entry;
      const progress = Math.max(status.progress, Math.min(1, event.progress));
      return progress === status.progress
        ? entry
        : { ...entry, status: { step: "copying" as const, progress } };
    }
    case "copied": {
      if (status.step !== "copying" || !entry.facts) return entry;
      if (entry.facts.kind === "audio") return { ...entry, status: { step: "ready" as const } };
      const total = thumbnailCount(entry.facts.durationSec);
      return { ...entry, status: { step: "thumbnails" as const, done: 0, total } };
    }
    case "thumbnail-made": {
      if (status.step !== "thumbnails") return entry;
      const done = Math.min(status.total, status.done + 1);
      return {
        ...entry,
        status: { ...status, done },
        thumbnails: { count: status.total, type: event.imageType },
      };
    }
    case "finished":
      return status.step === "thumbnails"
        ? { ...entry, status: { step: "ready" as const } }
        : entry;
    case "unsupported":
    case "failed":
      return settled(status)
        ? entry
        : { ...entry, status: { step: event.type, message: event.message } };
  }
}

/** Whether an import has stopped: it's ready, or it can't go further. */
export function settled(status: ImportStep): boolean {
  return status.step === "ready" || status.step === "unsupported" || status.step === "failed";
}

/** Whether a file can go on the timeline: it's been read and copied. */
export function canPlace(entry: ImportEntry): boolean {
  return (
    entry.facts !== null && (entry.status.step === "thumbnails" || entry.status.step === "ready")
  );
}

/**
 * An earlier import of the same file, which a new import reuses with its
 * copy and caches. One that failed doesn't count: importing it again is how to retry.
 */
export function duplicateOf(
  entries: readonly ImportEntry[],
  file: FileKey,
): ImportEntry | undefined {
  return entries.find((entry) => entry.status.step !== "failed" && sameFile(entry, file));
}

function factsOf(media: StoredMedia): MediaFacts {
  const { durationSec, container, codec } = media;
  if (media.kind === "audio") {
    const { channels, sampleRate } = media;
    return { kind: "audio" as const, durationSec, container, codec, channels, sampleRate };
  }
  const { width, height, fps } = media;
  return { kind: "video" as const, durationSec, container, codec, width, height, fps };
}

/** What meta.json records for an import, once its facts are known. */
export function storedMedia(entry: ImportEntry, facts: MediaFacts): StoredMedia {
  const { id, name, size, lastModified, importedAt } = entry;
  return {
    version: 1,
    id,
    name,
    size,
    lastModified,
    importedAt,
    source: sourceFileName(name),
    ...facts,
  };
}

/** The document's asset for a file in "My files": the same id, and its copy in storage. */
export function assetOf(entry: ImportEntry & { facts: MediaFacts }): Asset {
  const { id, name, facts } = entry;
  const source = {
    type: "file" as const,
    opfsPath: sourcePath({ id, source: sourceFileName(name) }),
  };
  if (facts.kind === "audio")
    return { id, kind: "audio", name, source, durationSec: facts.durationSec };
  const { width, height, fps, durationSec } = facts;
  return {
    id,
    kind: "video",
    name,
    source,
    durationSec,
    width,
    height,
    ...(fps === null ? {} : { fps }),
  };
}

/** The file types the bin takes: by extension, or by type when the name has none it knows. */
const EXTENSIONS = new Set(["mp4", "mov", "webm", "mp3", "m4a", "wav"]);
const TYPES = /^(video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|x-m4a|wav|x-wav|wave|webm))$/;

/** The file picker's `accept`: the same list. */
export const ACCEPTED_FILES =
  ".mp4,.mov,.webm,.mp3,.m4a,.wav,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/wav";

export function acceptsFile({ name, type }: { name: string; type: string }): boolean {
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return (extension !== undefined && EXTENSIONS.has(extension)) || TYPES.test(type);
}

export const NOT_ACCEPTED =
  "Can't add this file: only MP4, MOV, WebM, MP3, M4A and WAV files work here.";

/** Why reading or storing a file failed, as the worker reports it. */
export type FailureKind = "quota" | "storage" | "unreadable" | "other";

/** The message a failed row shows: what happened, and what to do. */
export const FAILURE_MESSAGES: Record<FailureKind, string> = {
  quota:
    "Couldn't copy this file: the browser's storage for this site is full. Free up space, then add it again.",
  storage:
    "Couldn't copy this file: this browser won't let the site store files. Private windows often can't; try a normal one.",
  unreadable: "Couldn't read this file. Check that it's still where it was, then add it again.",
  other: "Something went wrong while adding this file. Try adding it again.",
};
