// The main thread's side of the import worker (spec section 4.5). The worker, and Mediabunny with
// it, loads on the first import or Feed clip: an editor that never uses either never downloads
// them. Each call is one request, answered once; copying and thumbnails report progress on the way.

import type { FailureKind } from "./import-state.ts";
import type { StoredMedia } from "./opfs.ts";
import type { Peaks } from "./peaks.ts";
import type {
  Analysis,
  RemoteThumbnails,
  Thumbnail,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.ts";

/** What the import needs from the worker; the tests give the import a fake one. */
export interface ImportWorker {
  /** Reads a file's media and checks that this browser decodes it. */
  analyze: (file: File) => Promise<Analysis>;
  /** Waveform peaks from decoded audio channels, which are handed over, not copied. */
  peaks: (channels: Float32Array<ArrayBuffer>[], sampleRate: number) => Promise<Peaks>;
  /** Copies a file into its asset's folder in OPFS, with its peaks if given, then its meta.json. */
  store: (
    request: {
      assetId: string;
      file: File;
      source: string;
      peaks: Peaks | null;
      meta: StoredMedia;
    },
    onProgress: (fraction: number) => void,
  ) => Promise<void>;
  /** Makes a stored video's thumbnails, each handed over as it's made, then its thumbnails.json. */
  thumbnails: (
    meta: StoredMedia,
    onThumbnail: (index: number, thumbnail: Thumbnail) => void,
  ) => Promise<void>;
  /** Reads a remote video's facts with range requests, and checks that this browser decodes it. */
  probe: (url: string) => Promise<Analysis>;
  /** Makes a remote video's thumbnails, each handed over as it's made, kept in OPFS if it can. */
  remoteThumbnails: (
    request: RemoteThumbnails,
    onThumbnail: (index: number, thumbnail: Thumbnail) => void,
  ) => Promise<void>;
}

/** A request the worker couldn't carry out, and why. */
export class ImportFailure extends Error {
  readonly kind: FailureKind;

  constructor(kind: FailureKind, detail: string) {
    super(detail);
    this.kind = kind;
  }
}

/** Everything a request listens for until its answer. */
interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (fraction: number) => void;
  onThumbnail?: (index: number, thumbnail: Thumbnail) => void;
  /** When the worker last said anything about it (performance.now()). */
  heard: number;
}

/**
 * A request the worker says nothing about for this long fails, and the worker starts again: a
 * decoder that hangs, or a worker that died without a word, mustn't hold up every file after it.
 * Copying and thumbnails report far more often than this; reading a file takes well under it.
 */
const SILENCE_MS = 60_000;

let worker: Worker | null = null;
let lastId = 0;
const pending = new Map<number, Pending>();
let watchdog: ReturnType<typeof setInterval> | null = null;

function started(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./import.worker.ts", import.meta.url), {
    type: "module",
    name: "import",
  });
  created.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    receive(event.data);
  });
  created.addEventListener("error", (event) => {
    // The worker itself broke (it failed to load, say): every request waiting on it fails.
    event.preventDefault();
    stop(event.message);
  });
  worker = created;
  return created;
}

/** Fails every request waiting on the worker and ends it; the next request starts a new one. */
function stop(reason: string): void {
  for (const request of pending.values()) request.reject(new ImportFailure("other", reason));
  pending.clear();
  worker?.terminate();
  worker = null;
}

/**
 * New project: ends the worker and fails what it was doing, so a copy under way lets go of its
 * file before the project's folders are deleted. The next request starts a new worker.
 */
export function stopImportWorker(): void {
  stop("New project");
}

/** Checks on the waiting requests every few seconds while there are any. */
function watch(): void {
  watchdog ??= setInterval(() => {
    const now = performance.now();
    if ([...pending.values()].some((request) => now - request.heard > SILENCE_MS)) {
      stop("The import worker stopped answering.");
    }
    if (pending.size === 0 && watchdog !== null) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }, 5_000);
}

function receive(response: WorkerResponse): void {
  const request = pending.get(response.id);
  if (!request) return;
  request.heard = performance.now();
  switch (response.type) {
    case "progress":
      request.onProgress?.(response.fraction);
      return;
    case "thumbnail":
      request.onThumbnail?.(response.index, response.thumbnail);
      return;
    case "error":
      pending.delete(response.id);
      request.reject(new ImportFailure(response.kind, response.detail));
      return;
    default:
      pending.delete(response.id);
      request.resolve(response);
  }
}

/** Sends a request and waits for its answer, which must be of the type expected. */
function ask<T extends WorkerResponse["type"]>(
  request: WorkerRequest,
  answer: T,
  listeners: Pick<Pending, "onProgress" | "onThumbnail"> = {},
  transfer: Transferable[] = [],
): Promise<Extract<WorkerResponse, { type: T }>> {
  return new Promise((resolve, reject) => {
    pending.set(request.id, {
      ...listeners,
      heard: performance.now(),
      reject,
      resolve: (response) => {
        if (response.type === answer) resolve(response as Extract<WorkerResponse, { type: T }>);
        else reject(new ImportFailure("other", `Expected ${answer}, got ${response.type}`));
      },
    });
    try {
      started().postMessage(request, transfer);
      watch();
    } catch (error) {
      // No worker here (or one that won't take the message): the request fails at once.
      pending.delete(request.id);
      reject(new ImportFailure("other", String(error)));
    }
  });
}

function nextId(): number {
  lastId += 1;
  return lastId;
}

/** The import worker, started on its first request. */
export const importWorker: ImportWorker = {
  async analyze(file) {
    return (await ask({ type: "analyze", id: nextId(), file }, "analyzed")).analysis;
  },
  async peaks(channels, sampleRate) {
    const request: WorkerRequest = { type: "peaks", id: nextId(), channels, sampleRate };
    const buffers = channels.map((channel) => channel.buffer);
    return (await ask(request, "peaks", {}, buffers)).peaks;
  },
  async store(request, onProgress) {
    await ask({ type: "store", id: nextId(), ...request }, "done", { onProgress });
  },
  async thumbnails(meta, onThumbnail) {
    await ask({ type: "thumbnails", id: nextId(), meta }, "done", { onThumbnail });
  },
  async probe(url) {
    return (await ask({ type: "probe", id: nextId(), url }, "analyzed")).analysis;
  },
  async remoteThumbnails(request, onThumbnail) {
    await ask({ type: "remote-thumbnails", id: nextId(), ...request }, "done", { onThumbnail });
  },
};
