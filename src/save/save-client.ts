// The main thread's side of the save worker (src/save/save.worker.ts), started on its first request
// as its own small chunk. A worker that fails to start (its chunk didn't load, offline) fails what
// was asked of it, and the next request starts a new one.

import type { ReadResult, SaveFailure, SaveRequest, SaveResponse } from "./save-protocol.ts";

/** What restoring, autosave and New project need from the worker; the tests give a fake one. */
export interface SaveWorker {
  /** Reads both slots back: the newest good save, if any. */
  read: () => Promise<ReadResult>;
  /** Writes a save over a slot's file. */
  write: (file: string, text: string) => Promise<void>;
  /** Deletes folders at the root of OPFS, with everything in them. */
  clear: (folders: string[]) => Promise<void>;
  /** Starts the worker now, ahead of the first save, so it's there if the connection goes. */
  warm: () => void;
  /** Ends the worker, and whatever it's writing: another tab has the project now. */
  stop: () => void;
}

/** A request the worker couldn't carry out, and why. */
export class SaveError extends Error {
  readonly failure: SaveFailure;

  constructor(failure: SaveFailure, detail: string) {
    super(detail);
    this.failure = failure;
  }
}

let worker: Worker | null = null;
let lastId = 0;
const pending = new Map<
  number,
  { resolve: (response: SaveResponse) => void; reject: (error: SaveError) => void }
>();

function failAll(detail: string): void {
  for (const request of pending.values()) request.reject(new SaveError("other", detail));
  pending.clear();
}

function started(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./save.worker.ts", import.meta.url), {
    type: "module",
    name: "save",
  });
  created.addEventListener("message", (event: MessageEvent<SaveResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.type === "error") request.reject(new SaveError(response.failure, response.detail));
    else request.resolve(response);
  });
  created.addEventListener("error", (event) => {
    // It broke, or never loaded: what it was asked fails, and the next request starts afresh.
    event.preventDefault();
    stopWorker();
    failAll(event.message || "The save worker didn't start.");
  });
  worker = created;
  return created;
}

function stopWorker(): void {
  worker?.terminate();
  worker = null;
}

/** A request before it gets its id. */
type Unnumbered<T> = T extends unknown ? Omit<T, "id"> : never;

function ask(request: Unnumbered<SaveRequest>): Promise<SaveResponse> {
  lastId += 1;
  const id = lastId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      const numbered: SaveRequest = { ...request, id };
      started().postMessage(numbered);
    } catch (error) {
      pending.delete(id);
      reject(new SaveError("other", String(error)));
    }
  });
}

/** The save worker, started on its first request. */
export const saveWorker: SaveWorker = {
  read: async () => {
    const response = await ask({ type: "read" });
    if (response.type !== "read")
      throw new SaveError("other", `Expected read, got ${response.type}`);
    return response.result;
  },
  write: async (file, text) => {
    await ask({ type: "write", file, text });
  },
  clear: async (folders) => {
    await ask({ type: "clear", folders });
  },
  warm: () => {
    started();
  },
  stop: () => {
    stopWorker();
    failAll("Stopped: another tab has the project.");
  },
};
