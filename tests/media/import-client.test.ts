// The main thread's side of the import worker, against a fake Worker: answers reach their request,
// a broken worker fails what's waiting on it, and a silent one is given up on.

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { StoredMedia } from "../../src/media/opfs.ts";
import type { WorkerRequest, WorkerResponse } from "../../src/media/protocol.ts";

/** A Worker that records what it's sent and answers only when a test makes it. */
class FakeWorker {
  static created: FakeWorker[] = [];
  readonly sent: WorkerRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    FakeWorker.created.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(request: WorkerRequest): void {
    this.sent.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(response: WorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data: response });
  }

  fail(message: string): void {
    const event = { message, preventDefault: () => undefined };
    for (const listener of this.listeners.get("error") ?? []) listener(event);
  }
}

/** The client module, fresh for each test, so no worker or request carries over. */
async function client() {
  vi.resetModules();
  return import("../../src/media/import-client.ts");
}

function lastWorker(): FakeWorker {
  const worker = FakeWorker.created.at(-1);
  if (!worker) throw new Error("No worker was started");
  return worker;
}

const file = new File(["…"], "05-wide.mp4");
const meta: StoredMedia = {
  version: 1,
  id: "a",
  name: "05-wide.mp4",
  size: 1,
  lastModified: 1,
  importedAt: 1,
  source: "source.mp4",
  kind: "video",
  durationSec: 5,
  container: "MP4",
  codec: "avc",
  width: 1920,
  height: 1080,
  fps: 24,
};

beforeEach(() => {
  FakeWorker.created = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("starts the worker on the first request, and sends progress and the answer to it", async () => {
  const { importWorker } = await client();
  expect(FakeWorker.created).toHaveLength(0);

  const progress: number[] = [];
  const stored = importWorker.store(
    { assetId: "a", file, source: "source.mp4", peaks: null, meta },
    (fraction) => progress.push(fraction),
  );
  const worker = lastWorker();
  const [request] = worker.sent;
  if (request?.type !== "store") throw new Error("Expected a store request");
  worker.answer({ type: "progress", id: request.id, fraction: 0.62 });
  worker.answer({ type: "done", id: request.id });

  await expect(stored).resolves.toBeUndefined();
  expect(progress).toEqual([0.62]);
});

test("an error from the worker fails that request with its kind", async () => {
  const { importWorker, ImportFailure } = await client();

  const stored = importWorker.store(
    { assetId: "a", file, source: "source.mp4", peaks: null, meta },
    () => undefined,
  );
  const id = lastWorker().sent[0]?.id ?? 0;
  lastWorker().answer({ type: "error", id, kind: "quota", detail: "QuotaExceededError" });

  await expect(stored).rejects.toEqual(new ImportFailure("quota", "QuotaExceededError"));
});

test("a worker that breaks fails every waiting request, and the next request starts another", async () => {
  const { importWorker, ImportFailure } = await client();

  const analyzed = importWorker.analyze(file);
  const broken = lastWorker();
  broken.fail("The script failed to load");

  await expect(analyzed).rejects.toBeInstanceOf(ImportFailure);
  expect(broken.terminated).toBe(true);
  void importWorker.analyze(file);
  expect(FakeWorker.created).toHaveLength(2);
});

test("a request the worker says nothing about for a minute fails, and the worker starts again", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const { importWorker, ImportFailure } = await client();

  const progress: number[] = [];
  const stored = importWorker.store(
    { assetId: "a", file, source: "source.mp4", peaks: null, meta },
    (fraction) => progress.push(fraction),
  );
  const outcome = stored.then(
    () => "done",
    (error: unknown) => error,
  );
  const silent = lastWorker();
  const id = silent.sent[0]?.id ?? 0;

  // Progress keeps a long copy alive.
  await vi.advanceTimersByTimeAsync(50_000);
  silent.answer({ type: "progress", id, fraction: 0.5 });
  await vi.advanceTimersByTimeAsync(50_000);
  expect(silent.terminated).toBe(false);

  // Then a minute of silence.
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await outcome).toEqual(new ImportFailure("other", "The import worker stopped answering."));
  expect(silent.terminated).toBe(true);
  expect(progress).toEqual([0.5]);
});
