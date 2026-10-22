import { describe, expect, test } from "vitest";
import type { AudioFacts, VideoFacts } from "../../src/media/facts.ts";
import {
  acceptsFile,
  assetOf,
  canPlace,
  duplicateOf,
  type ImportEntry,
  type ImportEvent,
  importReducer,
  storedMedia,
} from "../../src/media/import-state.ts";
import type { StoredMedia } from "../../src/media/opfs.ts";

const video: VideoFacts = {
  kind: "video",
  durationSec: 5,
  container: "MP4",
  codec: "avc",
  width: 1920,
  height: 1080,
  fps: 24,
};

const audio: AudioFacts = {
  kind: "audio",
  durationSec: 48,
  container: "MP3",
  codec: "mp3",
  channels: 2,
  sampleRate: 44_100,
};

const file = { id: "a", name: "05-wide.mp4", size: 94_634, lastModified: 7, importedAt: 1 };

/** The entries after a run of events, from nothing. */
function after(...events: ImportEvent[]): ImportEntry[] {
  return events.reduce(importReducer, []);
}

function only(entries: ImportEntry[]): ImportEntry {
  const [entry] = entries;
  if (!entry || entries.length !== 1) throw new Error(`Expected one entry, got ${entries.length}`);
  return entry;
}

describe("importReducer", () => {
  test("takes a video from queued to ready, through every step", () => {
    const steps = [
      { type: "added", entries: [file] },
      { type: "started", id: "a" },
      { type: "analyzed", id: "a", facts: video },
      { type: "copy-progress", id: "a", progress: 0.62 },
      { type: "copied", id: "a" },
      { type: "thumbnail-made", id: "a", imageType: "image/webp" },
      { type: "finished", id: "a" },
    ] satisfies ImportEvent[];

    const statuses = steps.map((_, index) => only(after(...steps.slice(0, index + 1))).status);
    expect(statuses).toEqual([
      { step: "queued" },
      { step: "analyzing" },
      { step: "copying", progress: 0 },
      { step: "copying", progress: 0.62 },
      { step: "thumbnails", done: 0, total: 5 },
      { step: "thumbnails", done: 1, total: 5 },
      { step: "ready" },
    ]);
    expect(only(after(...steps))).toMatchObject({
      facts: video,
      thumbnails: { count: 5, type: "image/webp" },
    });
  });

  test("music is ready once it's copied: it has no thumbnails", () => {
    const entry = only(
      after(
        { type: "added", entries: [{ ...file, name: "music.mp3" }] },
        { type: "started", id: "a" },
        { type: "analyzed", id: "a", facts: audio },
        { type: "copied", id: "a" },
      ),
    );
    expect(entry.status).toEqual({ step: "ready" });
    expect(entry.thumbnails).toBeNull();
  });

  test("stops at unsupported or failed, and then ignores the rest", () => {
    const unsupported = after(
      { type: "added", entries: [file] },
      { type: "started", id: "a" },
      { type: "unsupported", id: "a", message: "HEVC" },
      { type: "analyzed", id: "a", facts: video },
      { type: "failed", id: "a", message: "full" },
    );
    expect(only(unsupported).status).toEqual({ step: "unsupported", message: "HEVC" });

    const failed = after(
      { type: "added", entries: [file] },
      { type: "started", id: "a" },
      { type: "analyzed", id: "a", facts: video },
      { type: "failed", id: "a", message: "full" },
      { type: "copied", id: "a" },
    );
    expect(only(failed).status).toEqual({ step: "failed", message: "full" });
  });

  test("ignores events out of order, and hands back the same list", () => {
    const queued = after({ type: "added", entries: [file] });
    for (const event of [
      { type: "analyzed", id: "a", facts: video },
      { type: "copy-progress", id: "a", progress: 0.5 },
      { type: "copied", id: "a" },
      { type: "finished", id: "a" },
      { type: "started", id: "nobody" },
      { type: "removed", id: "nobody" },
      { type: "added", entries: [file] },
    ] satisfies ImportEvent[]) {
      expect(importReducer(queued, event)).toBe(queued);
    }
  });

  test("copy progress only grows, up to 1", () => {
    const copying = after(
      { type: "added", entries: [file] },
      { type: "started", id: "a" },
      { type: "analyzed", id: "a", facts: video },
      { type: "copy-progress", id: "a", progress: 0.5 },
    );
    expect(importReducer(copying, { type: "copy-progress", id: "a", progress: 0.4 })).toBe(copying);
    const full = importReducer(copying, { type: "copy-progress", id: "a", progress: 2 });
    expect(only(full).status).toEqual({ step: "copying", progress: 1 });
  });

  test("keeps the order files were added in, and takes one away when removed", () => {
    const entries = after(
      { type: "added", entries: [file, { ...file, id: "b", name: "b.mp4" }] },
      { type: "added", entries: [{ ...file, id: "c", name: "c.mp4" }] },
      { type: "removed", id: "b" },
    );
    expect(entries.map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  test("restored files come back ready, before anything added since", () => {
    const stored: StoredMedia = {
      ...storedMedia(after({ type: "added", entries: [file] })[0] as ImportEntry, video),
      thumbnails: { count: 5, type: "image/jpeg" },
    };
    const entries = importReducer(after({ type: "added", entries: [{ ...file, id: "new" }] }), {
      type: "restored",
      media: [stored],
    });

    expect(entries.map((entry) => entry.id)).toEqual(["a", "new"]);
    expect(entries[0]).toEqual({
      id: "a",
      name: "05-wide.mp4",
      size: 94_634,
      lastModified: 7,
      importedAt: 1,
      status: { step: "ready" },
      facts: video,
      thumbnails: { count: 5, type: "image/jpeg" },
    });
  });
});

describe("canPlace: once it's read and copied", () => {
  test("not before", () => {
    const events: ImportEvent[] = [
      { type: "added", entries: [file] },
      { type: "started", id: "a" },
      { type: "analyzed", id: "a", facts: video },
    ];
    for (let count = 1; count <= events.length; count += 1) {
      expect(canPlace(only(after(...events.slice(0, count))))).toBe(false);
    }
  });

  test("while its thumbnails are made, and when it's ready", () => {
    const copied = after(
      { type: "added", entries: [file] },
      { type: "started", id: "a" },
      { type: "analyzed", id: "a", facts: video },
      { type: "copied", id: "a" },
    );
    expect(canPlace(only(copied))).toBe(true);
    expect(canPlace(only(importReducer(copied, { type: "finished", id: "a" })))).toBe(true);
  });
});

describe("duplicateOf", () => {
  test("finds an earlier import of the same file", () => {
    const entries = after({ type: "added", entries: [file] });
    expect(duplicateOf(entries, { name: "05-wide.mp4", size: 94_634, lastModified: 7 })?.id).toBe(
      "a",
    );
    expect(duplicateOf(entries, { name: "05-wide.mp4", size: 94_635, lastModified: 7 })).toBe(
      undefined,
    );
  });

  test("passes over a failed one, so adding it again retries", () => {
    const failed = after(
      { type: "added", entries: [file] },
      { type: "failed", id: "a", message: "full" },
    );
    expect(duplicateOf(failed, file)).toBeUndefined();
  });
});

test("a ready file becomes an asset with the same id and its copy's path", () => {
  const entry = { ...only(after({ type: "added", entries: [file] })), facts: video };
  expect(assetOf(entry)).toEqual({
    id: "a",
    kind: "video",
    name: "05-wide.mp4",
    source: { type: "file", opfsPath: "assets/a/source.mp4" },
    durationSec: 5,
    width: 1920,
    height: 1080,
    fps: 24,
  });
  expect(assetOf({ ...entry, name: "music.mp3", facts: audio })).toEqual({
    id: "a",
    kind: "audio",
    name: "music.mp3",
    source: { type: "file", opfsPath: "assets/a/source.mp3" },
    durationSec: 48,
  });
});

test("the bin takes MP4, MOV, WebM, MP3, M4A and WAV, by extension or by type", () => {
  for (const name of ["a.mp4", "B.MOV", "c.webm", "d.mp3", "e.m4a", "f.wav"]) {
    expect(acceptsFile({ name, type: "" })).toBe(true);
  }
  expect(acceptsFile({ name: "clip", type: "video/mp4" })).toBe(true);
  expect(acceptsFile({ name: "notes.txt", type: "text/plain" })).toBe(false);
  expect(acceptsFile({ name: "movie.mkv", type: "video/x-matroska" })).toBe(false);
});
