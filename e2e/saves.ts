// Saving in the end-to-end tests (spec section 3.5): reading the page's own storage (OPFS) for the
// newest save and the Feed clips kept, importing fixture files, making storage full for the save
// worker's writes, and holding a thumbnail's file so the import worker's write to it fails.

// The functions passed to page.evaluate and page.addInitScript run in the page, with the DOM.
/// <reference lib="dom" />

import { join } from "node:path";
import type { Page } from "@playwright/test";

const FIXTURES = join(import.meta.dirname, "fixtures");

/** What a save holds that the tests look at. */
export interface StoredSave {
  seq: number;
  view: { playhead: number; pxPerFrame: number; scrollX: number };
  /** Each clip's id, by track. */
  clips: Record<string, string[]>;
}

/** The newest save that reads back in the page's storage, or null when there's none. */
export function newestSave(page: Page): Promise<StoredSave | null> {
  return page.evaluate(async () => {
    try {
      const saves = await (await navigator.storage.getDirectory()).getDirectoryHandle("saves");
      let newest: StoredSave | null = null;
      for (const name of ["slot-a.json", "slot-b.json"]) {
        try {
          const text = await (await (await saves.getFileHandle(name)).getFile()).text();
          const save = JSON.parse(text) as {
            seq: number;
            view: StoredSave["view"];
            project: { tracks: { id: string; clips: { id: string }[] }[] };
          };
          if (newest && newest.seq > save.seq) continue;
          const clips = Object.fromEntries(
            save.project.tracks.map((track) => [track.id, track.clips.map((clip) => clip.id)]),
          );
          newest = { seq: save.seq, view: save.view, clips };
        } catch {
          // A slot that isn't there, or doesn't read back.
        }
      }
      return newest;
    } catch {
      return null;
    }
  });
}

/** The folders at the root of the page's storage. */
export function storageFolders(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names: string[] = [];
    for await (const [name] of (await navigator.storage.getDirectory()).entries()) names.push(name);
    return names.sort();
  });
}

/** Picks fixture files with the bin's file picker and waits until they're imported. */
export async function importFiles(page: Page, ...names: string[]): Promise<void> {
  const before = await page.evaluate(() => performance.getEntriesByName("import:ready").length);
  await page.locator('input[type="file"]').setInputFiles(names.map((name) => join(FIXTURES, name)));
  await page.waitForFunction(
    (count) => performance.getEntriesByName("import:ready").length === count,
    before + names.length,
  );
}

/**
 * From when `window.storageFull` is set in the page, the save worker's writes fail as a full
 * storage fails them (QuotaExceededError): the worker never gets them, and answers that it's full.
 */
export async function storageFullOnCue(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FullStorage extends Worker {
      private readonly saves: boolean;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.saves = options?.name === "save";
      }

      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const write =
          this.saves &&
          typeof message === "object" &&
          message !== null &&
          Reflect.get(message, "type") === "write";
        if (write && Reflect.get(window, "storageFull") === true) {
          const id: unknown = Reflect.get(message, "id");
          const full = { type: "error", id, failure: "quota", detail: "QuotaExceededError" };
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: full })), 0);
          return;
        }
        super.postMessage(message, options as StructuredSerializeOptions);
      }
    }
    window.Worker = FullStorage;
  });
}

/** The Feed clips whose thumbnails are kept for later sessions: those with a meta.json. */
export function keptFeedClips(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const kept: string[] = [];
    try {
      const remote = await (await navigator.storage.getDirectory()).getDirectoryHandle("remote");
      for await (const [id, folder] of remote.entries()) {
        if (folder.kind !== "directory") continue;
        const meta = await folder.getFileHandle("meta.json").then(
          () => true,
          () => false,
        );
        if (meta) kept.push(id);
      }
    } catch {
      // No Feed clip stored yet.
    }
    return kept.sort();
  });
}

/**
 * Holds a Feed clip's thumbnail file at `index` open with a sync access handle, in a worker of the
 * test's own: a file takes one such handle at a time, so the import worker's writes to it fail
 * until `releaseThumbnailFile`. Both of its names, since WebKit stores JPEG where Chrome stores
 * WebP. Resolves with "held", or with the error.
 */
export function holdThumbnailFile(page: Page, assetId: string, index: number): Promise<string> {
  return page.evaluate(
    async ({ assetId, index }) => {
      const code = `
        const handles = [];
        onmessage = async ({ data }) => {
          try {
            if (data === "release") {
              for (const handle of handles) handle.close();
              postMessage("released");
              return;
            }
            const root = await navigator.storage.getDirectory();
            const remote = await root.getDirectoryHandle("remote", { create: true });
            const folder = await remote.getDirectoryHandle(data.assetId, { create: true });
            const thumbs = await folder.getDirectoryHandle("thumbs", { create: true });
            for (const extension of ["webp", "jpg"]) {
              const name = data.index + "." + extension;
              const file = await thumbs.getFileHandle(name, { create: true });
              handles.push(await file.createSyncAccessHandle());
            }
            postMessage("held");
          } catch (error) {
            postMessage(String(error));
          }
        };
      `;
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      const holder = new Worker(url);
      Reflect.set(window, "thumbnailHolder", holder);
      return new Promise<string>((resolve) => {
        holder.onmessage = (event: MessageEvent<string>) => {
          resolve(event.data);
        };
        holder.postMessage({ assetId, index });
      });
    },
    { assetId, index },
  );
}

/** Lets go of the file `holdThumbnailFile` holds. Resolves with "released", or with the error. */
export function releaseThumbnailFile(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const holder = Reflect.get(window, "thumbnailHolder") as Worker;
    const answer = await new Promise<string>((resolve) => {
      holder.onmessage = (event: MessageEvent<string>) => {
        resolve(event.data);
      };
      holder.postMessage("release");
    });
    holder.terminate();
    return answer;
  });
}
