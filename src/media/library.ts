// "My files" (spec section 3.1): every file imported into this browser, with its import's state.
// Files go through a queue, one at a time (src/media/import-pipeline.ts). The list survives a
// reload: when the tab gets the project, it's rebuilt from the meta.json files in OPFS, without
// starting the worker, and the thumbnails and peaks are read back when something first draws them.
// Only a video whose thumbnails a closed tab cut short starts it, to make
// them again. New project empties the list, and its folders with it (src/app/new-project.ts).

import { create } from "zustand";
import { newId } from "../engine/store.ts";
import type { Asset } from "../engine/types.ts";
import { decodeAudio, forgetAudio, keepAudio } from "./audio.ts";
import { importWorker, stopImportWorker } from "./import-client.ts";
import { runImport } from "./import-pipeline.ts";
import {
  acceptsFile,
  duplicateOf,
  type ImportEntry,
  type ImportEvent,
  importReducer,
  NOT_ACCEPTED,
} from "./import-state.ts";
import { addPeaks, addThumbnail, forget, readPeaks, readThumbnails } from "./media-cache.ts";
import { ASSETS_FOLDER, type Folder, openStorage, readLibrary, type StoredMedia } from "./opfs.ts";
import { requestRemoteMedia } from "./remote-media.ts";

export const useLibrary = create<{ entries: ImportEntry[] }>(() => ({ entries: [] }));

function dispatch(event: ImportEvent): void {
  useLibrary.setState(({ entries }) => ({ entries: importReducer(entries, event) }));
}

/** The files waiting in the queue or being imported, by entry id. */
const files = new Map<string, File>();
let importing = false;

/** OPFS, opened once; null where the browser has none. */
let storage: Promise<Folder | null> | null = null;
function storageRoot(): Promise<Folder | null> {
  storage ??= openStorage();
  return storage;
}

/**
 * Adds files to "My files" and starts importing them, one at a time. A file that's already there
 * (the same name, size and last change) isn't imported again; their names come back, so the bin
 * can say so. A file of a type the bin doesn't take shows why at once. Files picked while the
 * stored ones are still being read at startup wait for them, so they're checked against them.
 */
export async function importFiles(list: Iterable<File>): Promise<{ duplicates: string[] }> {
  const picked = [...list];
  await restoring;
  const known = [...useLibrary.getState().entries];
  const duplicates: string[] = [];
  const added: ImportEntry[] = [];
  const now = Date.now();
  for (const file of picked) {
    if (duplicateOf(known, file)) {
      duplicates.push(file.name);
      continue;
    }
    const { name, size, lastModified } = file;
    const id = newId();
    const entry: ImportEntry = {
      id,
      name,
      size,
      lastModified,
      importedAt: now + added.length,
      status: { step: "queued" },
      facts: null,
      thumbnails: null,
    };
    known.push(entry);
    added.push(entry);
    if (acceptsFile(file)) files.set(id, file);
  }
  if (added.length > 0) dispatch({ type: "added", entries: added });
  for (const entry of added) {
    if (!files.has(entry.id))
      dispatch({ type: "unsupported", id: entry.id, message: NOT_ACCEPTED });
  }
  void drainQueue();
  return { duplicates };
}

/**
 * Deletes what storage holds for a file, if anything. One that can't be deleted now (another tab
 * still writing it, say) goes at a later start, since it has no meta.json.
 */
async function discard(assetId: string): Promise<void> {
  try {
    const assets = await (await storageRoot())?.folder(ASSETS_FOLDER);
    await assets?.remove(assetId);
  } catch {
    // Left for the next start.
  }
}

const deps = {
  worker: importWorker,
  decodeAudio,
  dispatch,
  keepThumbnail: (assetId: string, index: number, blob: Blob) => {
    void addThumbnail(assetId, index, blob);
  },
  keepPeaks: addPeaks,
  keepAudio,
  discard,
};

/** Imports queued files one after another until none is left. */
async function drainQueue(): Promise<void> {
  if (importing) return;
  importing = true;
  try {
    for (;;) {
      const next = useLibrary
        .getState()
        .entries.find((entry) => entry.status.step === "queued" && files.has(entry.id));
      const file = next && files.get(next.id);
      if (!next || !file) return;
      await whileLocked(next.id, () => runImport(next, file, deps));
      files.delete(next.id);
    }
  } finally {
    importing = false;
  }
}

/** Import locks: another tab that starts during an import leaves its half-written folder alone. */
const LOCK_PREFIX = "storyboard-import:";

function whileLocked(assetId: string, work: () => Promise<void>): Promise<void> {
  if (typeof navigator.locks === "undefined") return work();
  return navigator.locks.request(`${LOCK_PREFIX}${assetId}`, work);
}

async function lockedAssets(): Promise<Set<string>> {
  if (typeof navigator.locks === "undefined") return new Set();
  const { held = [] } = await navigator.locks.query();
  return new Set(
    held.flatMap(({ name }) =>
      name?.startsWith(LOCK_PREFIX) ? [name.slice(LOCK_PREFIX.length)] : [],
    ),
  );
}

/**
 * Takes a file off the list, with anything stored for it: one that couldn't be imported, or a ready
 * one no clip uses (the bin offers Remove for both).
 */
export function removeFile(id: string): void {
  files.delete(id);
  restored.delete(id);
  forget(id);
  forgetAudio(id);
  dispatch({ type: "removed", id });
  void discard(id);
}

/**
 * New project: every file goes from the list, an import under way stops with its worker, and what
 * they held in memory is let go of. Their folders are deleted with the rest of the project's.
 */
export function clearLibrary(): void {
  stopImportWorker();
  files.clear();
  restored.clear();
  for (const { id } of useLibrary.getState().entries) {
    forget(id);
    forgetAudio(id);
  }
  useLibrary.setState({ entries: [] });
}

/** The files restored from storage, whose thumbnails or peaks are read back when first drawn. */
const restored = new Set<string>();

/** The startup read of My files: imports wait for it. Done at once where it never ran. */
let restoring: Promise<void> = Promise.resolve();

/**
 * Rebuilds "My files" from OPFS when the tab gets the project: the main thread reads every stored
 * copy's meta.json and each video's first thumbnail for its poster. The worker isn't started,
 * unless a video's thumbnails were cut short. A ready file storage no longer has (another tab's
 * New project) leaves the list. If storage can't be read, My files stays as it is.
 */
export function restoreLibrary(): Promise<void> {
  restoring = readStoredFiles().catch(() => undefined);
  return restoring;
}

async function readStoredFiles(): Promise<void> {
  const root = await storageRoot();
  if (!root) return;
  const locked = await lockedAssets();
  const media = await readLibrary(root, (assetId) => locked.has(assetId));
  const stored = new Set(media.map(({ id }) => id));
  for (const { id, status } of useLibrary.getState().entries) {
    if (status.step !== "ready" || stored.has(id)) continue;
    forget(id);
    forgetAudio(id);
    dispatch({ type: "removed", id });
  }
  for (const { id } of media) restored.add(id);
  dispatch({ type: "restored", media });
  for (const stored of media) {
    const { id, thumbnails } = stored;
    if (thumbnails) await readThumbnails(root, id, { count: 1, type: thumbnails.type });
    else if (stored.kind === "video") void remakeThumbnails(stored);
  }
}

/**
 * A tab closed before a video's thumbnails were all made (its file may be on the timeline: it can
 * be placed once it's copied). They're made again from its copy, as the import makes them.
 */
async function remakeThumbnails(media: StoredMedia): Promise<void> {
  try {
    await importWorker.thumbnails(media, (index, thumbnail) => {
      void addThumbnail(media.id, index, thumbnail.blob);
    });
  } catch {
    // The filmstrip stays empty, and the next start tries again.
  }
}

/**
 * Something draws an asset's thumbnails or peaks: a restored file's are read back from storage the
 * first time, and a Feed clip's or the story music's are fetched (src/media/remote-media.ts).
 */
export function requestMedia(asset: Asset): void {
  if (asset.source.type !== "file") {
    requestRemoteMedia(asset);
    return;
  }
  const assetId = asset.id;
  // A restored project draws its files' clips before My files has been read back: wait for it.
  void restoring.then(async () => {
    if (!restored.delete(assetId)) return;
    const entry = useLibrary.getState().entries.find((candidate) => candidate.id === assetId);
    if (!entry?.facts) return;
    const { facts, thumbnails } = entry;
    const root = await storageRoot();
    if (!root) return;
    if (facts.kind === "audio") await readPeaks(root, assetId);
    else if (thumbnails) await readThumbnails(root, assetId, thumbnails, 1);
  });
}
