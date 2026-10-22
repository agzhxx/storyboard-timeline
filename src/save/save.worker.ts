// The save worker: it owns the saves in OPFS. It writes autosave's slots
// with sync access handles, the way the import worker copies files (src/media/import.worker.ts):
// they're the most widely supported way to write OPFS, Safari has no createWritable on the main
// thread, and sync handles exist only in workers. It reads the slots back at startup and checks
// them against the save's schema (src/save/read-saves.ts), so zod never loads in the page for it.
// It also deletes what New project clears. Requests are handled one at a time, in order, so a
// clear never lands in the middle of a write.

import { isQuotaError, openStorage, type SyncWriter, writeAll } from "../media/opfs.ts";
import { readSaves } from "./read-saves.ts";
import { SAVES_FOLDER } from "./save-file.ts";
import type { SaveFailure, SaveRequest, SaveResponse } from "./save-protocol.ts";

/** TypeScript's DOM types leave out this worker-only call. */
interface SyncFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle?: () => Promise<SyncWriter & { close(): void }>;
}

/** Storage this browser won't give the worker: no OPFS, or no sync access handles. */
class NoStorage extends Error {}

let queue: Promise<void> = Promise.resolve();

self.addEventListener("message", (event: MessageEvent<SaveRequest>) => {
  const request = event.data;
  queue = queue.then(() => handle(request));
});

function post(response: SaveResponse): void {
  self.postMessage(response);
}

async function handle(request: SaveRequest): Promise<void> {
  try {
    switch (request.type) {
      case "read": {
        const storage = await openStorage();
        if (!storage) throw new NoStorage();
        post({ type: "read", id: request.id, result: await readSaves(storage) });
        return;
      }
      case "write":
        await write(request.file, request.text);
        break;
      case "clear":
        await clear(request.folders);
        break;
    }
    post({ type: "done", id: request.id });
  } catch (error) {
    post({ type: "error", id: request.id, failure: failureOf(error), detail: String(error) });
  }
}

function failureOf(error: unknown): SaveFailure {
  if (isQuotaError(error)) return "quota";
  if (error instanceof NoStorage) return "unavailable";
  if (error instanceof DOMException) {
    // Another sync handle has the file: the other tab's worker, mid-write.
    if (error.name === "NoModificationAllowedError" || error.name === "InvalidStateError") {
      return "busy";
    }
    if (error.name === "SecurityError") return "unavailable";
  }
  return "other";
}

async function root(): Promise<FileSystemDirectoryHandle> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    throw new NoStorage();
  }
}

/**
 * Writes the text over the slot's file, then cuts it to the text's length and flushes. If storage
 * runs out partway, the slot is left damaged, which restoring skips: the other slot, the last good
 * save, is untouched.
 */
async function write(file: string, text: string): Promise<void> {
  const folder = await (await root()).getDirectoryHandle(SAVES_FOLDER, { create: true });
  const handle: SyncFileHandle = await folder.getFileHandle(file, { create: true });
  if (typeof handle.createSyncAccessHandle !== "function") throw new NoStorage();
  const access = await handle.createSyncAccessHandle();
  try {
    const bytes = new TextEncoder().encode(text);
    writeAll(access, bytes);
    access.truncate(bytes.length);
    access.flush();
  } finally {
    access.close();
  }
}

/** How often, and how far apart, a folder that's still in use is tried again. */
const CLEAR_TRIES = 10;
const CLEAR_RETRY_MS = 100;

/**
 * Deletes each folder with everything in it. A file another worker has open (an import that was
 * just stopped, whose handle the browser lets go of a moment later) is tried again; whatever is
 * left after that fails the request, once every folder has had its tries. Storage this browser
 * won't give (a private window) holds nothing to delete.
 */
async function clear(folders: readonly string[]): Promise<void> {
  const top = await root().catch(() => null);
  if (!top) return;
  let left: Error | null = null;
  for (const name of folders) {
    for (let tries = 1; ; tries += 1) {
      try {
        await top.removeEntry(name, { recursive: true });
        break;
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") break;
        if (tries >= CLEAR_TRIES) {
          left = error instanceof Error ? error : new Error(String(error));
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, CLEAR_RETRY_MS));
      }
    }
  }
  if (left) throw left;
}
