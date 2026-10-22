// Restoring the project at startup (spec section 3.5), before the editor shows. The main thread
// only looks whether a slot is there; when one is, or when the page couldn't open storage itself,
// the save worker reads both back and checks them (src/save/read-saves.ts), so the schema, and zod
// with it, stays out of the page. With nothing saved, the worker isn't started.

import type { Folder } from "../media/opfs.ts";
import { SaveError, type SaveWorker } from "./save-client.ts";
import { SAVES_FOLDER, SLOT_FILES } from "./save-file.ts";
import type { ReadResult } from "./save-protocol.ts";

export type Restored =
  | ReadResult
  /** This browser won't give the site storage (a private window, say): nothing saves here. */
  | { kind: "unavailable" }
  /** Storage couldn't be read just now: nothing is written, so the saves stay as they are. */
  | { kind: "failed" };

/**
 * The project to start with; `root` is OPFS as the page opened it, null when it couldn't. The
 * worker reads then: only it can tell a browser that won't store files (a private window) from
 * storage that failed to open just now, where starting afresh would write over the saves.
 */
export async function restore(root: Folder | null, worker: SaveWorker): Promise<Restored> {
  try {
    if (root) {
      const folder = await root.folder(SAVES_FOLDER);
      const slots = folder ? await Promise.all(SLOT_FILES.map((name) => folder.file(name))) : [];
      if (slots.every((slot) => slot === null)) return { kind: "none" };
    }
    return await worker.read();
  } catch (error) {
    return error instanceof SaveError && error.failure === "unavailable"
      ? { kind: "unavailable" }
      : { kind: "failed" };
  }
}

/** `restore` from storage as `openRoot` opens it, failed after `ms` if either hangs. */
export function restoreWithin(
  ms: number,
  openRoot: () => Promise<Folder | null>,
  worker: SaveWorker,
): Promise<Restored> {
  const timeout = new Promise<Restored>((resolve) => {
    setTimeout(resolve, ms, { kind: "failed" });
  });
  return Promise.race([openRoot().then((root) => restore(root, worker)), timeout]);
}
