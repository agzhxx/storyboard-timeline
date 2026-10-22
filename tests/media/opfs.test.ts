import { describe, expect, test, vi } from "vitest";
import {
  copyInChunks,
  type Folder,
  isQuotaError,
  parseRemoteMeta,
  parseStoredMedia,
  readLibrary,
  readPath,
  type RemoteMeta,
  sameFile,
  sourceFileName,
  sourcePath,
  type StoredMedia,
  type SyncWriter,
  thumbnailFileName,
  writeAll,
} from "../../src/media/opfs.ts";
import { memoryFolder, type Tree } from "./memory-folder.ts";

function storedVideo(id: string, importedAt: number): StoredMedia {
  return {
    version: 1,
    id,
    name: `${id}.mp4`,
    size: 94_634,
    lastModified: 1_760_000_000_000,
    importedAt,
    source: "source.mp4",
    kind: "video",
    durationSec: 5,
    container: "MP4",
    codec: "avc",
    width: 1920,
    height: 1080,
    fps: 24,
    thumbnails: { count: 5, type: "image/webp" },
  };
}

const storedAudio: StoredMedia = {
  version: 1,
  id: "music",
  name: "music.mp3",
  size: 1_000,
  lastModified: 1,
  importedAt: 5,
  source: "source.mp3",
  kind: "audio",
  durationSec: 48,
  container: "MP3",
  codec: "mp3",
  channels: 2,
  sampleRate: 44_100,
};

describe("the layout", () => {
  test("names the copy after the file's extension", () => {
    expect(sourceFileName("05-wide.MP4")).toBe("source.mp4");
    expect(sourceFileName("take.final.mov")).toBe("source.mov");
    expect(sourceFileName("no extension")).toBe("source");
    expect(sourceFileName("strange.extension-here")).toBe("source");
  });

  test("puts each asset's files in a folder named after it", () => {
    expect(sourcePath({ id: "abc", source: "source.mp4" })).toBe("assets/abc/source.mp4");
    expect(thumbnailFileName(3, "image/webp")).toBe("3.webp");
    expect(thumbnailFileName(0, "image/jpeg")).toBe("0.jpg");
  });
});

test("the same name, size and last change is the same file", () => {
  const file = { name: "05-wide.mp4", size: 10, lastModified: 7 };
  expect(sameFile(file, { ...file })).toBe(true);
  expect(sameFile(file, { ...file, size: 11 })).toBe(false);
  expect(sameFile(file, { ...file, lastModified: 8 })).toBe(false);
  expect(sameFile(file, { ...file, name: "05-wide copy.mp4" })).toBe(false);
});

describe("parseStoredMedia", () => {
  test("reads back what an import wrote", () => {
    const video = storedVideo("a", 1);
    expect(parseStoredMedia(JSON.parse(JSON.stringify(video)))).toEqual(video);
    expect(parseStoredMedia(JSON.parse(JSON.stringify(storedAudio)))).toEqual(storedAudio);
    expect(parseStoredMedia({ ...video, fps: null, codec: null })).not.toBeNull();
  });

  test("refuses anything else", () => {
    const video = storedVideo("a", 1);
    for (const broken of [
      null,
      "meta",
      { ...video, version: 2 },
      { ...video, kind: "image" },
      { ...video, width: "1920" },
      { ...video, durationSec: Number.NaN },
      { ...video, fps: "24" },
      { ...video, thumbnails: { count: 5, type: "image/png" } },
      { ...video, thumbnails: { count: 1.5, type: "image/webp" } },
      { ...storedAudio, channels: undefined },
    ]) {
      expect(parseStoredMedia(broken)).toBeNull();
    }
  });
});

describe("parseRemoteMeta", () => {
  const meta: RemoteMeta = {
    version: 1,
    id: "feed-g6lq3m8u9k-v1",
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
  };

  test("reads back what the remote thumbnails wrote", () => {
    expect(parseRemoteMeta(JSON.parse(JSON.stringify(meta)))).toEqual(meta);
    expect(parseRemoteMeta({ ...meta, facts: { ...meta.facts, fps: null } })).not.toBeNull();
  });

  test("refuses anything else", () => {
    for (const broken of [
      null,
      "meta",
      { ...meta, version: 2 },
      { ...meta, id: 7 },
      { ...meta, facts: { ...meta.facts, kind: "audio" } },
      { ...meta, facts: { ...meta.facts, durationSec: Number.NaN } },
      { ...meta, thumbnails: { count: 1.5, type: "image/webp" } },
      { ...meta, thumbnails: { count: 6, type: "image/png" } },
      { ...meta, thumbnails: undefined },
    ]) {
      expect(parseRemoteMeta(broken)).toBeNull();
    }
  });
});

describe("readLibrary", () => {
  test("lists every stored copy, oldest first", async () => {
    const tree: Tree = {
      assets: {
        b: { "meta.json": JSON.stringify(storedVideo("b", 2)), "source.mp4": "…" },
        a: { "meta.json": JSON.stringify(storedVideo("a", 1)), "source.mp4": "…" },
        music: { "meta.json": JSON.stringify(storedAudio), "peaks.bin": "…" },
      },
    };

    const library = await readLibrary(memoryFolder(tree));
    expect(library.map((media) => media.id)).toEqual(["a", "b", "music"]);
  });

  test("deletes copies that never finished, unless another tab may be writing them", async () => {
    const tree: Tree = {
      assets: {
        done: { "meta.json": JSON.stringify(storedVideo("done", 1)) },
        halfway: { "source.mp4": "half a copy" },
        mine: { "source.mp4": "being copied in another tab" },
        broken: { "meta.json": "{ not json" },
        moved: { "meta.json": JSON.stringify(storedVideo("elsewhere", 3)) },
      },
    };

    const library = await readLibrary(memoryFolder(tree), (id) => id === "mine");
    expect(library.map((media) => media.id)).toEqual(["done"]);
    expect(Object.keys(tree.assets ?? {})).toEqual(["done", "mine"]);
  });

  test("lists the rest when one folder can't be read or deleted right now", async () => {
    const tree: Tree = {
      assets: {
        a: { "meta.json": JSON.stringify(storedVideo("a", 1)) },
        locked: { "source.mp4": "being written" },
        b: { "meta.json": JSON.stringify(storedVideo("b", 2)) },
      },
    };
    const root = memoryFolder(tree);
    const assets = await root.folder("assets");
    if (!assets) throw new Error("No assets");
    const stubborn: Folder = {
      ...assets,
      remove: (name) =>
        name === "locked"
          ? Promise.reject(new DOMException("in use", "NoModificationAllowedError"))
          : assets.remove(name),
    };
    const library = await readLibrary({ ...root, folder: () => Promise.resolve(stubborn) });
    expect(library.map((media) => media.id)).toEqual(["a", "b"]);
  });

  test("reads a video's thumbnails from thumbnails.json, or from meta.json before M7", async () => {
    const { thumbnails, ...copied } = storedVideo("new", 1);
    const tree: Tree = {
      assets: {
        new: {
          "meta.json": JSON.stringify(copied),
          "thumbnails.json": JSON.stringify({ count: 5, type: "image/jpeg" }),
        },
        old: { "meta.json": JSON.stringify(storedVideo("old", 2)) },
        cut: { "meta.json": JSON.stringify({ ...copied, id: "cut", importedAt: 3 }) },
        spoilt: {
          "meta.json": JSON.stringify({ ...copied, id: "spoilt", importedAt: 4 }),
          "thumbnails.json": "{ not json",
        },
      },
    };

    const library = await readLibrary(memoryFolder(tree));
    expect(library.map((media) => [media.id, media.thumbnails])).toEqual([
      ["new", { count: 5, type: "image/jpeg" }],
      ["old", thumbnails],
      ["cut", undefined],
      ["spoilt", undefined],
    ]);
    // A copy stays whether or not its thumbnails were all made: its file may be on the timeline.
    expect(Object.keys(tree.assets ?? {})).toEqual(["new", "old", "cut", "spoilt"]);
  });

  test("lists a video whose thumbnails.json can't be read, without its thumbnails", async () => {
    const copied = { ...storedVideo("a", 1), thumbnails: undefined };
    const root = memoryFolder({ assets: { a: { "meta.json": JSON.stringify(copied) } } });
    const assets = await root.folder("assets");
    const folder = await assets?.folder("a");
    if (!assets || !folder) throw new Error("No folder");
    const unreadable: Folder = {
      ...folder,
      file: (name) =>
        name === "thumbnails.json"
          ? Promise.reject(new DOMException("Can't read it now", "NotReadableError"))
          : folder.file(name),
    };
    const library = await readLibrary({
      ...root,
      folder: () => Promise.resolve({ ...assets, folder: () => Promise.resolve(unreadable) }),
    });
    expect(library.map((media) => [media.id, media.thumbnails])).toEqual([["a", undefined]]);
  });

  test("is empty when nothing was ever imported", async () => {
    expect(await readLibrary(memoryFolder({}))).toEqual([]);
  });
});

test("readPath reads a file by its path from the root, such as an asset's copy; null when it's gone", async () => {
  const root = memoryFolder({ assets: { a: { "source.mp3": "music" } } });
  expect(await (await readPath(root, "assets/a/source.mp3"))?.text()).toBe("music");
  expect(await readPath(root, "assets/b/source.mp3")).toBeNull();
  expect(await readPath(root, "assets/a/other.mp3")).toBeNull();
});

/** A sync access handle in memory. */
function memoryWriter({ fullAfter = Infinity, maxWrite = Infinity } = {}) {
  let bytes = new Uint8Array(0);
  const writer: SyncWriter = {
    write(buffer, { at }) {
      if (at + buffer.length > fullAfter) {
        throw new DOMException("The storage is full", "QuotaExceededError");
      }
      const take = buffer.subarray(0, Math.min(buffer.length, maxWrite));
      const grown = new Uint8Array(Math.max(bytes.length, at + take.length));
      grown.set(bytes);
      grown.set(take, at);
      bytes = grown;
      return take.length;
    },
    truncate: vi.fn((size: number) => {
      bytes = bytes.slice(0, size);
    }),
    flush: vi.fn(),
  };
  return { writer, written: () => bytes };
}

describe("copyInChunks", () => {
  const file = new Blob([Uint8Array.from({ length: 10 }, (_, i) => i)]);

  test("copies the whole file a chunk at a time, reporting the share copied", async () => {
    const { writer, written } = memoryWriter();
    const progress: number[] = [];

    await copyInChunks(file, writer, (fraction) => progress.push(fraction), 4);
    expect([...written()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(progress).toEqual([0.4, 0.8, 1]);
    expect(writer.truncate).toHaveBeenCalledWith(0);
    expect(writer.flush).toHaveBeenCalledOnce();
  });

  test("keeps writing when a write takes only part of a chunk", async () => {
    const { writer, written } = memoryWriter({ maxWrite: 3 });

    await copyInChunks(file, writer, () => undefined, 8);
    expect([...written()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("lets a full storage's QuotaExceededError through", async () => {
    const { writer } = memoryWriter({ fullAfter: 6 });

    const copy = copyInChunks(file, writer, () => undefined, 4);
    await expect(copy).rejects.toSatisfy(isQuotaError);
  });
});

test("writeAll stops when the file takes no more", () => {
  const stuck: SyncWriter = { write: () => 0, truncate: () => undefined, flush: () => undefined };
  expect(() => {
    writeAll(stuck, new Uint8Array(3));
  }).toThrow("The file stopped taking data.");
});

test("isQuotaError knows a full storage from other errors", () => {
  expect(isQuotaError(new DOMException("full", "QuotaExceededError"))).toBe(true);
  expect(isQuotaError(new DOMException("gone", "NotFoundError"))).toBe(false);
  expect(isQuotaError(new Error("QuotaExceededError"))).toBe(false);
});
