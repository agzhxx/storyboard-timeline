import { describe, expect, test, vi } from "vitest";
import type { AudioFacts, VideoFacts } from "../../src/media/facts.ts";
import { ImportFailure, type ImportWorker } from "../../src/media/import-client.ts";
import { type ImportDeps, runImport } from "../../src/media/import-pipeline.ts";
import {
  FAILURE_MESSAGES,
  type ImportEntry,
  type ImportEvent,
  importReducer,
} from "../../src/media/import-state.ts";
import type { Peaks } from "../../src/media/peaks.ts";
import type { Analysis } from "../../src/media/protocol.ts";

const video: VideoFacts = {
  kind: "video",
  durationSec: 3,
  container: "MP4",
  codec: "avc",
  width: 1920,
  height: 1080,
  fps: 24,
};

const audio: AudioFacts = {
  kind: "audio",
  durationSec: 3,
  container: "MP3",
  codec: "mp3",
  channels: 2,
  sampleRate: 44_100,
};

const peaks: Peaks = { sampleRate: 48_000, samplesPerBucket: 48, data: new Int8Array(6) };
/** Stands in for the AudioBuffer decodeAudioData gives back. */
const music = { duration: 3 } as AudioBuffer;
const poster = { blob: new Blob(["poster"], { type: "image/webp" }), type: "image/webp" as const };

/** A worker that answers each request as given, recording what it was asked. */
function fakeWorker(analysis: Analysis, overrides: Partial<ImportWorker> = {}) {
  const worker: ImportWorker = {
    analyze: vi.fn(() => Promise.resolve(analysis)),
    peaks: vi.fn(() => Promise.resolve(peaks)),
    store: vi.fn((_request, onProgress: (fraction: number) => void) => {
      onProgress(0.5);
      onProgress(1);
      return Promise.resolve();
    }),
    thumbnails: vi.fn((_meta, onThumbnail: (index: number, thumbnail: typeof poster) => void) => {
      for (const index of [0, 1, 2]) onThumbnail(index, poster);
      return Promise.resolve();
    }),
    // The Feed's clips aren't imported.
    probe: vi.fn(() => Promise.reject(new Error("Not a Feed clip"))),
    remoteThumbnails: vi.fn(() => Promise.reject(new Error("Not a Feed clip"))),
    ...overrides,
  };
  return worker;
}

/** What the import asked the worker to store. */
function storeRequest(worker: ImportWorker) {
  return vi.mocked(worker.store).mock.calls[0]?.[0];
}

/** Runs one import against fakes and gives back what it did. */
async function run(name: string, worker: ImportWorker, decoded = true) {
  const entry: ImportEntry = {
    id: "a",
    name,
    size: 10,
    lastModified: 1,
    importedAt: 1,
    status: { step: "queued" },
    facts: null,
    thumbnails: null,
  };
  const events: ImportEvent[] = [];
  const deps: ImportDeps = {
    worker,
    decodeAudio: vi.fn(() =>
      Promise.resolve(
        decoded ? { buffer: music, channels: [new Float32Array(4)], sampleRate: 48_000 } : null,
      ),
    ),
    dispatch: (event) => events.push(event),
    keepThumbnail: vi.fn(),
    keepPeaks: vi.fn(),
    keepAudio: vi.fn(),
    discard: vi.fn(() => Promise.resolve()),
  };
  await runImport(entry, new File(["…"], name), deps);
  const [final] = events.reduce(importReducer, [entry]);
  return { events: events.map((event) => event.type), final, deps };
}

describe("runImport", () => {
  test("a video: read, copied with progress, then a thumbnail a second, each kept", async () => {
    const worker = fakeWorker({ ok: true, facts: video, poster });
    const { events, final, deps } = await run("05-wide.mp4", worker);

    expect(events).toEqual([
      "started",
      "analyzed",
      "copy-progress",
      "copy-progress",
      "copied",
      "thumbnail-made",
      "thumbnail-made",
      "thumbnail-made",
      "finished",
    ]);
    expect(final?.status).toEqual({ step: "ready" });
    expect(deps.discard).not.toHaveBeenCalled();
    // The poster first, then the thumbnails as they come.
    expect(deps.keepThumbnail).toHaveBeenCalledTimes(4);
    expect(deps.keepThumbnail).toHaveBeenNthCalledWith(1, "a", 0, poster.blob);
    // meta.json comes with the copy, since the file can be placed from then on.
    expect(storeRequest(worker)).toMatchObject({
      assetId: "a",
      source: "source.mp4",
      peaks: null,
      meta: { id: "a", kind: "video", source: "source.mp4" },
    });
    expect(deps.decodeAudio).not.toHaveBeenCalled();
  });

  test("music: decoded as playback will, its peaks kept and stored with its meta.json", async () => {
    const worker = fakeWorker({ ok: true, facts: audio, poster: null });
    const { events, final, deps } = await run("music.mp3", worker);

    expect(events).toEqual(["started", "analyzed", "copy-progress", "copy-progress", "copied"]);
    expect(final?.status).toEqual({ step: "ready" });
    expect(deps.keepPeaks).toHaveBeenCalledWith("a", peaks);
    // Kept for playback once it's stored, so the first play doesn't decode it again.
    expect(deps.keepAudio).toHaveBeenCalledWith("a", music);
    expect(storeRequest(worker)).toMatchObject({
      peaks,
      meta: { id: "a", kind: "audio", source: "source.mp3" },
    });
    expect(worker.thumbnails).not.toHaveBeenCalled();
  });

  test("a file the browser can't open is never copied", async () => {
    const worker = fakeWorker({ ok: false, problem: { kind: "not-media" } });
    const { events, final } = await run("not-video.mp4", worker);

    expect(events).toEqual(["started", "unsupported"]);
    expect(final?.status).toEqual({
      step: "unsupported",
      message: "Can't open this file: there's no video or audio in it.",
    });
    expect(worker.store).not.toHaveBeenCalled();
  });

  test("music that decodeAudioData refuses is unsupported, named by its codec", async () => {
    const worker = fakeWorker({ ok: true, facts: { ...audio, codec: "ac3" }, poster: null });
    const { final } = await run("surround.m4a", worker, false);

    expect(final?.status.step).toBe("unsupported");
    expect(JSON.stringify(final?.status)).toContain("it's Dolby Digital (AC-3) audio");
    expect(worker.peaks).not.toHaveBeenCalled();
    expect(worker.store).not.toHaveBeenCalled();
  });

  test("a full storage fails the file with a message, and goes no further", async () => {
    const worker = fakeWorker(
      { ok: true, facts: video, poster },
      { store: () => Promise.reject(new ImportFailure("quota", "QuotaExceededError")) },
    );
    const { events, final, deps } = await run("big.mov", worker);

    expect(events).toEqual(["started", "analyzed", "failed"]);
    expect(final?.status).toEqual({ step: "failed", message: FAILURE_MESSAGES.quota });
    expect(worker.thumbnails).not.toHaveBeenCalled();
    expect(deps.discard).toHaveBeenCalledWith("a");
  });

  test("thumbnails that fail after the copy keep it: the file may be on the timeline", async () => {
    const worker = fakeWorker(
      { ok: true, facts: video, poster },
      { thumbnails: () => Promise.reject(new ImportFailure("quota", "QuotaExceededError")) },
    );
    const { events, final, deps } = await run("05-wide.mp4", worker);

    expect(events.slice(-2)).toEqual(["copied", "finished"]);
    expect(final?.status).toEqual({ step: "ready" });
    expect(deps.discard).not.toHaveBeenCalled();
  });

  test("a file that went away while music was read says so", async () => {
    const worker = fakeWorker({ ok: true, facts: audio, poster: null });
    const entryEvents: ImportEvent[] = [];
    await runImport(
      {
        id: "a",
        name: "music.mp3",
        size: 1,
        lastModified: 1,
        importedAt: 1,
        status: { step: "queued" },
        facts: null,
        thumbnails: null,
      },
      new File(["…"], "music.mp3"),
      {
        worker,
        decodeAudio: () => Promise.reject(new DOMException("gone", "NotReadableError")),
        dispatch: (event) => entryEvents.push(event),
        keepThumbnail: () => undefined,
        keepPeaks: () => undefined,
        keepAudio: () => undefined,
        discard: () => Promise.resolve(),
      },
    );
    expect(entryEvents.at(-1)).toEqual({
      type: "failed",
      id: "a",
      message: FAILURE_MESSAGES.unreadable,
    });
  });
});
