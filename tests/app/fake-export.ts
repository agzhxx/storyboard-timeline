// An export worker for component tests, which mock src/media/export-client.ts with it: it answers
// what encodes (everything, unless a test says otherwise), writes down every export started and
// canceled, and the test sends the worker's news for it.
//
//   vi.mock("../../src/media/export-client.ts", async (importOriginal) => ({
//     ...(await importOriginal<typeof import("../../src/media/export-client.ts")>()),
//     exportWorker: (await import("./fake-export.ts")).fakeExport.worker,
//   }));

import type { ExportEvent, ExportWorker } from "../../src/media/export-client.ts";
import type { Encoders, ExportSize } from "../../src/media/export-format.ts";
import type { ExportJob } from "../../src/media/export-protocol.ts";

export const EVERYTHING: Encoders = { avc: true, aac: true, vp9: true, opus: true };

interface Started {
  run: number;
  job: ExportJob;
  listener: (event: ExportEvent) => void;
}

/** Omit for each member of a union: an event without its export's number. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface FakeExport {
  /** What the browser answers per size; everything encodes by default. */
  answers: Map<ExportSize, Encoders>;
  asked: { size: ExportSize; fps: number }[];
  started: Started[];
  canceled: number[];
  worker: ExportWorker;
  /** The newest export's news, as the worker would send it; `run` is filled in. */
  emit: (event: DistributiveOmit<ExportEvent, "run">) => void;
  reset: () => void;
}

let lastRun = 0;

export const fakeExport: FakeExport = {
  answers: new Map(),
  asked: [],
  started: [],
  canceled: [],
  worker: {
    encoders: (size, fps) => {
      fakeExport.asked.push({ size, fps });
      return Promise.resolve(fakeExport.answers.get(size) ?? EVERYTHING);
    },
    start: (job, listener) => {
      lastRun += 1;
      fakeExport.started.push({ run: lastRun, job, listener });
      return lastRun;
    },
    cancel: (run) => {
      fakeExport.canceled.push(run);
    },
  },
  emit(event) {
    const started = fakeExport.started.at(-1);
    if (!started) throw new Error("No export was started");
    started.listener({ ...event, run: started.run });
  },
  reset() {
    fakeExport.answers.clear();
    fakeExport.asked.length = 0;
    fakeExport.started.length = 0;
    fakeExport.canceled.length = 0;
  },
};
