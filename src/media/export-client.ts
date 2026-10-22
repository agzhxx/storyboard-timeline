// The main thread's side of the export worker (spec section 4.7). The worker, and Mediabunny with
// it, starts the first time the export dialog asks what this browser can encode, so an editor that
// never exports never loads it. One export at a time: its news goes to the listener that started
// it, and the news of an export that was canceled is dropped here.

import type { Fps } from "../engine/types.ts";
import { counters } from "../perf/counters.ts";
import type { Encoders, ExportSize } from "./export-format.ts";
import type { ExportJob, ExportRequest, ExportResponse } from "./export-protocol.ts";

/** An export's news, or the client's word that the worker broke. */
export type ExportEvent =
  Exclude<ExportResponse, { type: "encoders" }> | { type: "crashed"; run: number };

/** What the export dialog needs from the worker; the tests use a fake one. */
export interface ExportWorker {
  /** Which codecs encode at a size, asked of this browser; rejects if the worker broke. */
  encoders: (size: ExportSize, fps: Fps) => Promise<Encoders>;
  /** Starts an export and returns its number; its news goes to `listener` until it ends. */
  start: (job: ExportJob, listener: (event: ExportEvent) => void) => number;
  cancel: (run: number) => void;
}

let worker: Worker | null = null;
let lastId = 0;
const asking = new Map<number, { answer: (encoders: Encoders) => void; fail: () => void }>();
const listeners = new Map<number, (event: ExportEvent) => void>();

/** Lets go of the pictures in news nobody will show: a canceled export's, say. */
export function discard(event: ExportEvent): void {
  if (event.type === "preview") event.bitmap.close();
  if (event.type === "done") event.firstFrame?.close();
}

function receive(response: ExportResponse): void {
  if (response.type === "encoders") {
    asking.get(response.id)?.answer(response.encoders);
    asking.delete(response.id);
    return;
  }
  counters.openInExport = response.open;
  const listener = listeners.get(response.run);
  if (response.type === "done" || response.type === "failed" || response.type === "canceled") {
    listeners.delete(response.run);
  }
  if (listener) listener(response);
  else discard(response);
}

function started(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./export.worker.ts", import.meta.url), {
    type: "module",
    name: "export",
  });
  created.addEventListener("message", (event: MessageEvent<ExportResponse>) => {
    receive(event.data);
  });
  created.addEventListener("error", (event) => {
    // It broke (it failed to load, say): whatever it held is gone with it, and every question
    // and export it had is answered here. The next request starts a new one.
    event.preventDefault();
    created.terminate();
    worker = null;
    counters.openInExport = 0;
    broke();
  });
  worker = created;
  return created;
}

function broke(): void {
  for (const { fail } of asking.values()) fail();
  asking.clear();
  const runs = [...listeners];
  listeners.clear();
  for (const [run, listener] of runs) listener({ type: "crashed", run });
}

function send(request: ExportRequest, transfer: Transferable[] = []): void {
  try {
    started().postMessage(request, { transfer });
  } catch {
    // No worker in this browser (or one that won't take the message): it can't export.
    broke();
  }
}

/** The export worker, started on the first question. */
export const exportWorker: ExportWorker = {
  encoders(size, fps) {
    lastId += 1;
    const id = lastId;
    return new Promise((resolve, reject) => {
      asking.set(id, {
        answer: resolve,
        fail: () => {
          reject(new Error("The export worker stopped before it answered."));
        },
      });
      send({ type: "encoders", id, size, fps });
    });
  },
  start(job, listener) {
    lastId += 1;
    const run = lastId;
    listeners.set(run, listener);
    // The music's samples move to the worker rather than being copied.
    send({ type: "start", run, job }, job.audio?.channels.map((channel) => channel.buffer) ?? []);
    return run;
  },
  cancel(run) {
    // Its news from now on, a "canceled" included, is no longer wanted.
    listeners.delete(run);
    if (worker) send({ type: "cancel", run });
  },
};
