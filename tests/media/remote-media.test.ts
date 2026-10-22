// What the editor draws for media read from an address: a Feed clip's thumbnails, back from
// storage or made by the import worker, once a session, one job at a time: every clip's preview
// before any clip's 720p file; and the demo music's waveform. Storage, the worker and decoding are
// faked.

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Asset } from "../../src/engine/types.ts";
import type { ImportWorker } from "../../src/media/import-client.ts";
import type { Thumbnail } from "../../src/media/protocol.ts";
import {
  forgetRemoteMedia,
  requestRemoteMedia,
  retryFailedRemoteMedia,
  storedRemoteMeta,
} from "../../src/media/remote-media.ts";
import { memoryFolder, type Tree } from "./memory-folder.ts";

const fakes = vi.hoisted(() => {
  const tree: Tree = {};
  return {
    tree,
    remoteThumbnails: vi.fn<ImportWorker["remoteThumbnails"]>(),
    peaks: vi.fn<ImportWorker["peaks"]>(),
    addThumbnail: vi.fn(),
    addPeaks: vi.fn(),
    readThumbnails: vi.fn(),
    music: vi.fn(),
  };
});

vi.mock("../../src/media/opfs.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/media/opfs.ts")>()),
  openStorage: () => Promise.resolve(memoryFolder(fakes.tree)),
}));
vi.mock("../../src/media/import-client.ts", () => ({
  importWorker: { remoteThumbnails: fakes.remoteThumbnails, peaks: fakes.peaks },
}));
vi.mock("../../src/media/media-cache.ts", () => ({
  addThumbnail: fakes.addThumbnail,
  addPeaks: fakes.addPeaks,
  readThumbnails: fakes.readThumbnails,
}));
vi.mock("../../src/media/audio.ts", () => ({ musicOf: fakes.music }));

/** A 5 s Feed clip; `preview: false` is one saved before M8, which has no preview. */
function feedClip(id: string, { preview = true } = {}): Asset {
  return {
    id,
    kind: "video",
    name: id,
    source: {
      type: "feed",
      itemId: id,
      url: `https://media.example/originals/${id}.mp4`,
      videoUrl: `https://media.example/m/${id}/v1/full.mp4`,
      ...(preview ? { previewUrl: `https://media.example/m/${id}/v1/preview.mp4` } : {}),
      model: "Kling 2.5 Pro",
    },
    durationSec: 5,
    width: 1920,
    height: 1080,
    fps: 24,
  };
}

function meta(id: string) {
  return JSON.stringify({
    version: 1,
    id,
    facts: {
      kind: "video",
      container: "MP4",
      codec: "avc",
      durationSec: 5.041667,
      width: 1280,
      height: 720,
      fps: 24,
    },
    thumbnails: { count: 6, type: "image/webp" },
  });
}

const thumbnail: Thumbnail = {
  blob: new Blob(["webp"], { type: "image/webp" }),
  type: "image/webp",
};
/** Lets the queued jobs and their promises run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  for (const key of Object.keys(fakes.tree)) Reflect.deleteProperty(fakes.tree, key);
  vi.clearAllMocks();
  fakes.remoteThumbnails.mockResolvedValue(undefined);
  // Each test is a session of its own.
  forgetRemoteMedia();
});

/** The jobs the worker was asked for, in order: the asset and its file ("preview" or "full"). */
const thumbnailsAskedFor = () =>
  fakes.remoteThumbnails.mock.calls.map(
    ([request]) => `${request.assetId} ${request.preview ? "preview" : "full"}`,
  );

describe("a Feed clip's thumbnails", () => {
  test("say when a clip's filmstrip is in, for the bench", async () => {
    performance.clearMarks("feed:thumbnails");
    fakes.remoteThumbnails.mockImplementation(({ assetId }) =>
      assetId === "clip-g" ? Promise.reject(new Error("Failed to fetch")) : Promise.resolve(),
    );
    requestRemoteMedia(feedClip("clip-f"));
    requestRemoteMedia(feedClip("clip-g"));
    for (let turn = 0; turn < 6; turn += 1) await settle();
    const marks = performance.getEntriesByName("feed:thumbnails") as PerformanceMark[];
    expect(marks.map((mark) => mark.detail as unknown)).toEqual(["clip-f"]);
  });

  test("come back from storage when an earlier session kept them all", async () => {
    fakes.tree.remote = { "clip-a": { "meta.json": meta("clip-a"), thumbs: {} } };
    requestRemoteMedia(feedClip("clip-a"));
    await settle();
    expect(fakes.readThumbnails).toHaveBeenCalledWith(
      expect.anything(),
      "clip-a",
      { count: 6, type: "image/webp" },
      0,
      "remote",
    );
    expect(fakes.remoteThumbnails).not.toHaveBeenCalled();
  });

  test("else the worker makes those the preview holds, then the rest from the 720p file", async () => {
    fakes.remoteThumbnails
      .mockImplementationOnce((_request, onThumbnail) => {
        for (const index of [0, 1, 2]) onThumbnail(index, thumbnail);
        return Promise.resolve();
      })
      .mockImplementationOnce((_request, onThumbnail) => {
        for (const index of [3, 4]) onThumbnail(index, thumbnail);
        return Promise.resolve();
      });
    requestRemoteMedia(feedClip("clip-b"));
    for (let turn = 0; turn < 3; turn += 1) await settle();
    expect(fakes.remoteThumbnails.mock.calls.map(([request]) => request)).toEqual([
      {
        assetId: "clip-b",
        url: "https://media.example/m/clip-b/v1/preview.mp4",
        from: 0,
        // The clip's 5 thumbnails, of which the preview holds the first.
        preview: { count: 5 },
      },
      {
        assetId: "clip-b",
        url: "https://media.example/m/clip-b/v1/full.mp4",
        from: 3,
        preview: null,
      },
    ]);
    // Each drawn as it's made.
    expect(fakes.addThumbnail.mock.calls.map(([, index]) => index as number)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  test("previews three at a time, all before any 720p file, those one at a time", async () => {
    const waiting: (() => void)[] = [];
    const running = { preview: 0, full: 0 };
    const most = { preview: 0, full: 0 };
    fakes.remoteThumbnails.mockImplementation(({ preview }) => {
      const kind = preview ? "preview" : "full";
      running[kind] += 1;
      most[kind] = Math.max(most[kind], running[kind]);
      return new Promise<void>((resolve) => {
        waiting.push(() => {
          running[kind] -= 1;
          resolve();
        });
      });
    });
    for (const id of ["clip-c", "clip-d", "clip-n", "clip-o"]) requestRemoteMedia(feedClip(id));
    await settle();
    expect(thumbnailsAskedFor()).toEqual(["clip-c preview", "clip-d preview", "clip-n preview"]);
    // Each job finishes in turn: the next starts.
    for (let turn = 0; turn < 20 && waiting.length > 0; turn += 1) {
      waiting.shift()?.();
      await settle();
    }
    expect(thumbnailsAskedFor()).toEqual([
      "clip-c preview",
      "clip-d preview",
      "clip-n preview",
      "clip-o preview",
      "clip-c full",
      "clip-d full",
      "clip-n full",
      "clip-o full",
    ]);
    expect(most).toEqual({ preview: 3, full: 1 });
  });

  test("a preview that doesn't come, or stops early, leaves the rest to the 720p file", async () => {
    fakes.remoteThumbnails
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockImplementationOnce((_request, onThumbnail) => {
        onThumbnail(0, thumbnail);
        return Promise.reject(new Error("No thumbnail decoded."));
      });
    requestRemoteMedia(feedClip("clip-k"));
    requestRemoteMedia(feedClip("clip-l"));
    for (let turn = 0; turn < 6; turn += 1) await settle();
    const full = fakes.remoteThumbnails.mock.calls
      .map(([request]) => request)
      .filter((request) => request.preview === null);
    expect(full.map(({ assetId, from }) => [assetId, from])).toEqual([
      ["clip-k", 0],
      ["clip-l", 1],
    ]);
  });

  test("a clip saved before M8 has no preview: its 720p file makes them all", async () => {
    requestRemoteMedia(feedClip("clip-m", { preview: false }));
    await settle();
    expect(fakes.remoteThumbnails.mock.calls.map(([request]) => request)).toEqual([
      {
        assetId: "clip-m",
        url: "https://media.example/m/clip-m/v1/full.mp4",
        from: 0,
        preview: null,
      },
    ]);
  });

  test("are asked for once a session; one that fails stays without, quietly", async () => {
    fakes.remoteThumbnails.mockRejectedValue(new Error("Failed to fetch"));
    requestRemoteMedia(feedClip("clip-e"));
    requestRemoteMedia(feedClip("clip-e"));
    for (let turn = 0; turn < 3; turn += 1) await settle();
    requestRemoteMedia(feedClip("clip-e"));
    await settle();
    expect(thumbnailsAskedFor()).toEqual(["clip-e preview", "clip-e full"]);
    expect(fakes.addThumbnail).not.toHaveBeenCalled();
  });
});

describe("media that didn't come", () => {
  test("is asked for again once the connection is back", async () => {
    fakes.remoteThumbnails.mockRejectedValueOnce(new Error("Failed to fetch"));
    requestRemoteMedia(feedClip("clip-h", { preview: false }));
    await settle();
    retryFailedRemoteMedia();
    await settle();
    expect(thumbnailsAskedFor()).toEqual(["clip-h full", "clip-h full"]);
  });

  test("isn't, when New project dropped it: it was the last project's", async () => {
    let finishFirst: () => void = () => undefined;
    fakes.remoteThumbnails.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    requestRemoteMedia(feedClip("clip-i"));
    requestRemoteMedia(feedClip("clip-j"));
    await settle();
    forgetRemoteMedia();
    finishFirst();
    for (let turn = 0; turn < 4; turn += 1) await settle();
    retryFailedRemoteMedia();
    await settle();
    // Both 720p files were waiting their turn when New project came: dropped, and not asked for
    // again.
    expect(thumbnailsAskedFor()).toEqual(["clip-i preview", "clip-j preview"]);
  });
});

test("the demo music's waveform: decoded once, then boiled down by the worker", async () => {
  const channel = Float32Array.from({ length: 4_800 }, (_, i) => Math.sin(i / 10));
  fakes.music.mockResolvedValueOnce({
    numberOfChannels: 2,
    sampleRate: 48_000,
    getChannelData: () => channel,
  });
  const peaks = { sampleRate: 48_000, samplesPerBucket: 48, data: new Int8Array(200) };
  fakes.peaks.mockResolvedValueOnce(peaks);
  const music: Asset = {
    id: "music-a",
    kind: "audio",
    name: "Demo music",
    source: { type: "url", url: "/demo/music.mp3" },
    durationSec: 46,
  };
  requestRemoteMedia(music);
  await settle();
  const [channels, sampleRate] = fakes.peaks.mock.calls[0] ?? [];
  expect(channels).toHaveLength(2);
  expect(channels?.[0]).toEqual(channel);
  // Copies: the worker takes them over, and the decoded samples stay for playback.
  expect(channels?.[0]).not.toBe(channel);
  expect(sampleRate).toBe(48_000);
  expect(fakes.addPeaks).toHaveBeenCalledWith("music-a", peaks);
});

describe("storedRemoteMeta", () => {
  test("is null when an asset has no meta.json, a broken one, or another asset's", async () => {
    fakes.tree.remote = {
      broken: { "meta.json": "{ not json" },
      moved: { "meta.json": meta("someone-else") },
      kept: { "meta.json": meta("kept") },
    };
    expect(await storedRemoteMeta("missing")).toBeNull();
    expect(await storedRemoteMeta("broken")).toBeNull();
    expect(await storedRemoteMeta("moved")).toBeNull();
    expect(await storedRemoteMeta("kept")).toMatchObject({ id: "kept", facts: { fps: 24 } });
  });
});
