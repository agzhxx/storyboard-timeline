// Persistent storage (spec section 3.5): by default a browser may clear a site's storage when the
// disk runs low, saves and copied files with it. Once there's real work to keep (a save with the
// story or a file in it, or a file imported), the app asks the browser once to keep the site's
// storage, with navigator.storage.persist(), and records the answer, so it never asks again:
// Chrome and Safari decide without a prompt, Firefox asks the person. A no changes nothing.

/** Where the answer is kept, per browser profile; New project doesn't clear it. */
export const PERSIST_KEY = "storyboard-timeline:persist";

/** What asking needs: the browser's storage manager and somewhere to note the answer. */
export interface PersistDeps {
  storage: Pick<StorageManager, "persist" | "persisted"> | undefined;
  memory: Pick<Storage, "getItem" | "setItem"> | undefined;
}

/**
 * Asks once for persistent storage, unless this browser already answered (or already keeps it).
 * Each call of the function it returns resolves with the answer, or null when it didn't ask.
 */
export function persister(deps: () => PersistDeps = defaults): () => Promise<boolean | null> {
  let asked = false;
  return async () => {
    if (asked) return null;
    asked = true;
    try {
      const { storage, memory } = deps();
      if (!storage || memory?.getItem(PERSIST_KEY) != null) return null;
      const granted = (await storage.persisted()) || (await storage.persist());
      memory?.setItem(PERSIST_KEY, granted ? "granted" : "denied");
      return granted;
    } catch {
      // No storage manager here, or no local storage to note the answer in (a sandboxed page).
      return null;
    }
  };
}

function defaults(): PersistDeps {
  return { storage: globalThis.navigator.storage, memory: globalThis.localStorage };
}

/** The app's: asked at most once a session, and once a browser. */
export const persistOnce = persister();
