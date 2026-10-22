// The media bin's "My files" (Media bin states board), rendered in the whole editor. The import
// worker and the audio decoder are fakes: jsdom has neither Mediabunny's codecs nor Web Audio.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useDocumentStore } from "../../src/engine/store.ts";
import { cantOpenMessage } from "../../src/media/codecs.ts";
import type { AudioFacts, VideoFacts } from "../../src/media/facts.ts";
import type { ImportWorker } from "../../src/media/import-client.ts";
import {
  ACCEPTED_FILES,
  type ImportEvent,
  importReducer,
  NOT_ACCEPTED,
  settled,
} from "../../src/media/import-state.ts";
import { useLibrary } from "../../src/media/library.ts";
import { drawnIn, recordCanvases } from "./canvas.ts";
import { clipButton, clipsOn, messages, renderEmptyEditor } from "./editor.tsx";

const VIDEO: VideoFacts = {
  kind: "video",
  durationSec: 5,
  container: "MP4",
  codec: "avc",
  width: 1920,
  height: 1080,
  fps: 24,
};

const MUSIC: AudioFacts = {
  kind: "audio",
  durationSec: 48,
  container: "MP3",
  codec: "mp3",
  channels: 2,
  sampleRate: 44_100,
};

// What the fake worker answers, by file name.
vi.mock("../../src/media/import-client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/media/import-client.ts")>();
  const { computePeaks } = await import("../../src/media/peaks.ts");
  const thumbnail = {
    blob: new Blob(["webp"], { type: "image/webp" }),
    type: "image/webp" as const,
  };
  const facts: Record<string, VideoFacts | AudioFacts | undefined> = {
    "05-wide.mp4": {
      kind: "video",
      durationSec: 5,
      container: "MP4",
      codec: "avc",
      width: 1920,
      height: 1080,
      fps: 24,
    },
    "music.mp3": {
      kind: "audio",
      durationSec: 3,
      container: "MP3",
      codec: "mp3",
      channels: 2,
      sampleRate: 44_100,
    },
  };
  const importWorker: ImportWorker = {
    analyze: (file) => {
      const found = facts[file.name];
      if (file.name === "prores.mov") {
        const problem = {
          kind: "video" as const,
          codec: "prores",
          codecString: null,
          containerCodec: null,
        };
        return Promise.resolve({ ok: false, problem });
      }
      if (!found) return Promise.resolve({ ok: false, problem: { kind: "not-media" } });
      return Promise.resolve({
        ok: true,
        facts: found,
        poster: found.kind === "video" ? thumbnail : null,
      });
    },
    peaks: (channels, sampleRate) => Promise.resolve(computePeaks(channels, sampleRate)),
    store: (_request, onProgress) => {
      onProgress(0.62);
      onProgress(1);
      return Promise.resolve();
    },
    thumbnails: (meta, onThumbnail) => {
      for (let index = 0; index < Math.ceil(meta.durationSec); index += 1) {
        onThumbnail(index, thumbnail);
      }
      return Promise.resolve();
    },
    // The story's clips from the Feed: no thumbnails here.
    probe: () => Promise.reject(new Error("Not in these tests")),
    remoteThumbnails: () => Promise.reject(new Error("Not in these tests")),
  };
  return { ...actual, importWorker };
});

// Music decodes to 3 s at 48 kHz, as long as the fake worker says it is.
vi.mock("../../src/media/audio.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/media/audio.ts")>()),
  decodeAudio: (file: File) =>
    Promise.resolve(
      file.name.endsWith(".mp3")
        ? {
            channels: [Float32Array.from({ length: 144_000 }, (_, i) => 0.8 * Math.sin(i / 20))],
            sampleRate: 48_000,
          }
        : null,
    ),
}));

beforeEach(() => {
  recordCanvases();
  vi.stubGlobal("createImageBitmap", () =>
    Promise.resolve({ width: 160, height: 90, close: () => undefined }),
  );
  Object.assign(URL, { createObjectURL: () => "blob:poster", revokeObjectURL: () => undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function bin(): HTMLElement {
  return screen.getByRole("region", { name: "Media bin" });
}

function fileInput(): HTMLInputElement {
  const input = bin().querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("The bin has no file input");
  return input;
}

function file(name: string): File {
  return new File(["…"], name, { lastModified: 1_760_000_000_000 });
}

/** Waits until every file in My files is ready, or stopped. */
async function importsSettle(): Promise<void> {
  await waitFor(() => {
    expect(useLibrary.getState().entries.every((entry) => settled(entry.status))).toBe(true);
  });
}

/** My files with the six rows the board draws, in their states. */
function boardFiles() {
  const key = (id: string, name: string) => ({ id, name, size: 1, lastModified: 1, importedAt: 1 });
  const unsupported = (id: string, codec: string, codecString: string): ImportEvent => ({
    type: "unsupported",
    id,
    message: cantOpenMessage({ kind: "video", codec, codecString, containerCodec: null }),
  });
  const events: ImportEvent[] = [
    {
      type: "added",
      entries: [
        key("wide", "05-wide.mp4"),
        key("music", "music.mp3"),
        key("tracking", "06-tracking.mov"),
        key("rain", "rain.wav"),
        key("iphone", "iphone-take.mov"),
        key("graded", "graded-10bit.mp4"),
      ],
    },
    { type: "started", id: "wide" },
    { type: "analyzed", id: "wide", facts: VIDEO },
    { type: "copied", id: "wide" },
    { type: "finished", id: "wide" },
    { type: "started", id: "music" },
    { type: "analyzed", id: "music", facts: MUSIC },
    { type: "copied", id: "music" },
    { type: "started", id: "tracking" },
    { type: "analyzed", id: "tracking", facts: VIDEO },
    { type: "copy-progress", id: "tracking", progress: 0.62 },
    { type: "started", id: "rain" },
    { type: "started", id: "iphone" },
    unsupported("iphone", "hevc", "hvc1.2.4.L120.B0"),
    { type: "started", id: "graded" },
    unsupported("graded", "avc", "avc1.6E0028"),
  ];
  act(() => {
    useLibrary.setState({ entries: events.reduce(importReducer, []) });
  });
}

describe("My files, as the board draws every import state", () => {
  test("the My files tab, then Add files and the count, then a row per file", () => {
    renderEmptyEditor();
    boardFiles();

    const tab = within(bin()).getByRole("tab", { name: "My files" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(within(bin()).getByRole("tabpanel", { name: "My files" })).toBeDefined();
    expect(within(bin()).getByRole("button", { name: "Add files" })).toBeDefined();
    expect(within(bin()).getByText("6 files")).toBeDefined();
  });

  test("ready files show their meta line, and say what Enter does", () => {
    renderEmptyEditor();
    boardFiles();

    const video = within(bin()).getByRole("button", {
      name: "05-wide.mp4 0:05 · 1920 × 1080 · 24 fps",
      description: "Enter adds it at the playhead.",
    });
    // No poster was made for this one: the box stays empty.
    expect(video.querySelector("img")).toBeNull();
    expect(
      within(bin()).getByRole("button", { name: "music.mp3 0:48 · MP3 · stereo" }),
    ).toBeDefined();
  });

  test("a file being copied shows how far, with its bar", () => {
    renderEmptyEditor();
    boardFiles();

    expect(within(bin()).getByText("Copying 62%")).toBeDefined();
    const bar = within(bin()).getByRole("progressbar", { name: "Copying 06-tracking.mov" });
    expect(bar.getAttribute("aria-valuenow")).toBe("62");
  });

  test("a file being read says it can't be placed yet", () => {
    renderEmptyEditor();
    boardFiles();

    expect(within(bin()).getByText("Reading its length… can't be placed yet")).toBeDefined();
  });

  test("files that can't open say why in the board's words, with Remove", async () => {
    const { user } = renderEmptyEditor();
    boardFiles();

    expect(
      within(bin()).getByText(
        "Can't open this file in this browser: it's HEVC (H.265) video. Convert it to H.264 and add it again.",
      ),
    ).toBeDefined();
    expect(
      within(bin()).getByText(
        "Can't open this file in this browser: 10-bit video isn't supported here.",
      ),
    ).toBeDefined();

    await user.click(within(bin()).getByRole("button", { name: "Remove iphone-take.mov" }));
    expect(within(bin()).queryByText("iphone-take.mov")).toBeNull();
    expect(within(bin()).getByText("5 files")).toBeDefined();
  });

  test("a file can't go on the timeline before its length is known and it's copied", async () => {
    const { user } = renderEmptyEditor();
    boardFiles();
    act(() => {
      const queued = { id: "late", name: "late.mp4", size: 1, lastModified: 1, importedAt: 2 };
      useLibrary.setState(({ entries }) => ({
        entries: importReducer(entries, { type: "added", entries: [queued] }),
      }));
    });

    expect(within(bin()).getByText("Waiting to be read… can't be placed yet")).toBeDefined();
    for (const name of ["06-tracking.mov", "rain.wav", "late.mp4"]) {
      expect(within(bin()).queryByRole("button", { name: new RegExp(`^${name}`) })).toBeNull();
      await user.click(within(bin()).getByText(name));
    }
    expect(clipsOn("V1") + clipsOn("V2") + clipsOn("A1")).toBe(0);
  });
});

describe("adding files", () => {
  test("the empty bin is a place to drop files, with the picker", () => {
    renderEmptyEditor();

    expect(within(bin()).getByText("Drop video or audio files here")).toBeDefined();
    expect(within(bin()).getByText("MP4, MOV, WebM · MP3, M4A, WAV")).toBeDefined();
    expect(within(bin()).getByRole("button", { name: "Choose files" })).toBeDefined();
    expect(within(bin()).getByText("Files stay on this device.")).toBeDefined();
  });

  test("Choose files, Add your own files and Add files open the picker for several files", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const { user } = renderEmptyEditor();

    await user.click(screen.getByRole("button", { name: "Choose files" }));
    await user.click(screen.getByRole("button", { name: "Add your own files" }));
    boardFiles();
    await user.click(screen.getByRole("button", { name: "Add files" }));

    expect(click).toHaveBeenCalledTimes(3);
    expect(click.mock.contexts).toEqual([fileInput(), fileInput(), fileInput()]);
    expect(fileInput().multiple).toBe(true);
    expect(fileInput().accept).toBe(ACCEPTED_FILES);
  });

  test("picked files are imported one by one; Enter adds one, which sets the frame rate", async () => {
    const { user } = renderEmptyEditor();

    await user.upload(fileInput(), [file("05-wide.mp4"), file("music.mp3")]);
    await importsSettle();

    const video = within(bin()).getByRole("button", { name: /^05-wide\.mp4 / });
    expect(video.textContent).toContain("0:05 · 1920 × 1080 · 24 fps");
    expect(video.querySelector("img")?.getAttribute("src")).toBe("blob:poster");
    video.focus();
    await user.keyboard("{Enter}");

    expect(clipButton("05-wide.mp4").getAttribute("aria-label")).toBe(
      "05-wide.mp4 on V1, starts 00:00:00:00, 00:00:05:00 long",
    );
    // The project was empty at 30 fps: the first video brings its 24.
    expect(useDocumentStore.getState().project.fps).toBe(24);
    expect(screen.getByText("1920 × 1080 · 24 fps")).toBeDefined();
  });

  test("a video's clip draws its filmstrip, and music's its waveform", async () => {
    const { user } = renderEmptyEditor();

    await user.upload(fileInput(), [file("05-wide.mp4"), file("music.mp3")]);
    await importsSettle();
    await user.click(within(bin()).getByRole("button", { name: /^05-wide\.mp4 / }));
    // The clip's own canvases: the inspector and the monitor draw the same thumbnails elsewhere.
    await waitFor(() => {
      expect(drawnIn(clipButton("05-wide.mp4"))).toEqual(["image", "image"]);
    });

    await user.click(within(bin()).getByRole("button", { name: /^music\.mp3 / }));
    expect(clipButton("music.mp3").getAttribute("aria-label")).toBe(
      "music.mp3 on A1, starts 00:00:00:00, 00:00:03:00 long",
    );
    // 3 s at 24 fps and 2 px per frame is 144 px: a bar every 3 px.
    await waitFor(() => {
      expect(drawnIn(clipButton("music.mp3")).filter((call) => call === "bar")).toHaveLength(48);
    });
    expect(drawnIn(clipButton("music.mp3"))).not.toContain("image");
  });

  test("files that can't open, or aren't media at all, say so", async () => {
    const { user } = renderEmptyEditor();

    await user.upload(fileInput(), [file("prores.mov"), file("not-video.mp4")]);
    // The picker only offers the types the bin takes; a drop can bring any.
    const notes = [file("notes.txt")];
    fireEvent.drop(bin(), { dataTransfer: { types: ["Files"], items: [], files: notes } });
    await importsSettle();

    expect(
      within(bin()).getByText(
        "Can't open this file in this browser: it's Apple ProRes video. Convert it to H.264 and add it again.",
      ),
    ).toBeDefined();
    expect(
      within(bin()).getByText("Can't open this file: there's no video or audio in it."),
    ).toBeDefined();
    expect(within(bin()).getByText(NOT_ACCEPTED)).toBeDefined();
  });

  test("a file that's already in My files isn't imported again; the toast says so", async () => {
    const { user } = renderEmptyEditor();

    await user.upload(fileInput(), [file("05-wide.mp4")]);
    await importsSettle();
    await user.upload(fileInput(), [file("05-wide.mp4")]);

    expect(within(bin()).getAllByText("05-wide.mp4")).toHaveLength(1);
    expect(messages().textContent).toContain("05-wide.mp4 is already in My files.");
  });
});

describe("files dragged over the bin", () => {
  const dragged = (count: number, files: File[] = []) => ({
    dataTransfer: {
      types: ["Files"],
      items: Array.from({ length: count }, () => ({ kind: "file" })),
      files,
      dropEffect: "none",
    },
  });

  test("say how many will be added, and where they'll stay", () => {
    renderEmptyEditor();

    fireEvent.dragEnter(bin(), dragged(3));
    const hint = within(bin()).getByText("Drop to add 3 files").parentElement;
    expect(hint?.textContent).toBe(
      "Drop to add 3 filesMP4, MOV, WebM · MP3, M4A, WAVThey stay on this device.",
    );

    fireEvent.dragLeave(bin(), dragged(3));
    expect(within(bin()).queryByText("Drop to add 3 files")).toBeNull();
  });

  test("stay shown while the drag crosses the bin's own rows", () => {
    renderEmptyEditor();

    fireEvent.dragEnter(bin(), dragged(1));
    fireEvent.dragEnter(within(bin()).getByText("Drop video or audio files here"), dragged(1));
    fireEvent.dragLeave(bin(), dragged(1));
    expect(within(bin()).getByText("Drop to add 1 file")).toBeDefined();
  });

  test("are imported when dropped", async () => {
    renderEmptyEditor();

    const files = [file("05-wide.mp4")];
    fireEvent.dragEnter(bin(), dragged(1, files));
    fireEvent.drop(bin(), dragged(1, files));
    expect(within(bin()).queryByText("Drop to add 1 file")).toBeNull();
    await importsSettle();
    expect(within(bin()).getByRole("button", { name: /^05-wide\.mp4 / })).toBeDefined();
  });

  test("leave other drags alone", () => {
    renderEmptyEditor();

    fireEvent.dragEnter(bin(), { dataTransfer: { types: ["text/plain"], items: [], files: [] } });
    expect(within(bin()).queryByText(/^Drop to add/)).toBeNull();
  });
});
