// The main thread's side of the decode worker (spec section 4.5). The worker, and Mediabunny with
// it, starts on the first request: a cut of placeholders never loads it. Requests go one way and
// answers come back to the listeners (the monitor's picture and playback), which match them to
// their own requests: an answer to a request that's no longer wanted is closed and dropped there.

import { counters } from "../perf/counters.ts";
import type { TrackPlan } from "../engine/schedule.ts";
import type { DecodeRequest, DecodeResponse, StillRequest } from "./decode-protocol.ts";

/** An answer from the worker, or the client's word that the worker broke. */
export type DecodeEvent = DecodeResponse | { type: "crashed" };

/** What the picture and playback need from the worker; the tests use a fake one. */
export interface DecodeWorker {
  still: (request: StillRequest) => void;
  play: (session: number, tracks: TrackPlan[], capacity: number) => void;
  ack: (session: number, trackId: string, count: number) => void;
  stop: (session: number) => void;
  /** Hears every answer; returns a function that stops listening. */
  listen: (listener: (event: DecodeEvent) => void) => () => void;
}

let worker: Worker | null = null;
const listeners = new Set<(event: DecodeEvent) => void>();

function emit(event: DecodeEvent): void {
  if (event.type !== "crashed") counters.openInWorker = event.open;
  for (const listener of listeners) listener(event);
}

function started(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./decode.worker.ts", import.meta.url), {
    type: "module",
    name: "decode",
  });
  created.addEventListener("message", (event: MessageEvent<DecodeResponse>) => {
    emit(event.data);
  });
  created.addEventListener("error", (event) => {
    // It broke (it failed to load, say): whatever it held is gone with it. The next request
    // starts a new one.
    event.preventDefault();
    created.terminate();
    worker = null;
    counters.openInWorker = 0;
    emit({ type: "crashed" });
  });
  worker = created;
  return created;
}

function send(request: DecodeRequest): void {
  try {
    started().postMessage(request);
  } catch {
    // No worker in this browser (or one that won't take the message): treat it as broken.
    emit({ type: "crashed" });
  }
}

/** The decode worker, started on its first request. */
export const decodeWorker: DecodeWorker = {
  still(request) {
    send({ type: "still", request });
  },
  play(session, tracks, capacity) {
    send({ type: "play", session, tracks, capacity });
  },
  ack(session, trackId, count) {
    // Only a running worker has frames to hand back.
    if (worker) send({ type: "ack", session, trackId, count });
  },
  stop(session) {
    if (worker) send({ type: "stop", session });
  },
  listen(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
