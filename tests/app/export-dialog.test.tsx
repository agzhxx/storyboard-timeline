// The export dialog (Export boards: "settings, progress, done" and "fallback, failed, canceled";
// the toolbar board's no-encoder state), in the whole editor, with the boards' copy. The export
// worker and the music's mix are faked: the tests answer what encodes and send the worker's news.

import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useDocumentStore } from "../../src/engine/store.ts";
import type { Project } from "../../src/engine/types.ts";
import type { MixedAudio } from "../../src/media/export-mix.ts";
import { counters } from "../../src/perf/counters.ts";
import { drawnIn, picture, recordCanvases } from "./canvas.ts";
import { messages, renderEditor, renderEmptyEditor } from "./editor.tsx";
import { EVERYTHING, fakeExport } from "./fake-export.ts";
import { DEMO_MUSIC } from "./story.ts";

const fakes = vi.hoisted(() => ({
  mix: vi.fn<(project: Project) => Promise<MixedAudio | null>>(),
}));

vi.mock("../../src/media/export-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/media/export-client.ts")>()),
  exportWorker: (await import("./fake-export.ts")).fakeExport.worker,
}));
vi.mock("../../src/media/export-mix.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/media/export-mix.ts")>()),
  mixForExport: fakes.mix,
}));

const MIXED: MixedAudio = { sampleRate: 48_000, channels: [] };
const revokeObjectURL = vi.fn();

beforeEach(() => {
  fakeExport.reset();
  fakes.mix.mockReset();
  fakes.mix.mockResolvedValue(MIXED);
  vi.stubGlobal("VideoEncoder", vi.fn());
  URL.createObjectURL = () => "blob:film";
  revokeObjectURL.mockReset();
  URL.revokeObjectURL = revokeObjectURL;
  recordCanvases();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lets the dialog's chunk load and the browser's answer come in. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function openDialog() {
  const result = renderEditor();
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  const dialog = await screen.findByRole("dialog");
  await settle();
  return { ...result, dialog };
}

/** The dialog's rows, as "label: value". */
function rows(dialog: HTMLElement): string[] {
  return [...dialog.querySelectorAll("dt")].map(
    (term) => `${term.textContent}: ${term.nextElementSibling?.textContent ?? ""}`,
  );
}

/** The box around one of the dialog's pictures, which `drawnIn` reads. */
function pictureBox(dialog: HTMLElement, name: string): Element {
  return within(dialog).getByRole("img", { name }).parentElement ?? dialog;
}

const exportButton = (dialog: HTMLElement, name: RegExp | string = "Export") =>
  within(dialog).getByRole("button", { name });

describe("settings", () => {
  test("the board's settings: the project, 1080p chosen, MP4 where H.264 and AAC encode", async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).getByRole("heading", { name: "Export" })).toBeDefined();
    expect(dialog.textContent).toContain("The robot story · 00:00:45:00 · 15 clips and music");
    expect(exportButton(dialog, /^1080p/).getAttribute("aria-pressed")).toBe("true");
    expect(exportButton(dialog, /^720p/).getAttribute("aria-pressed")).toBe("false");
    expect(exportButton(dialog, /^1080p/).textContent).toBe("1080p1920 × 1080");
    expect(rows(dialog)).toEqual([
      "Frame rate: 24 fps, the project's",
      "Format: MP4 · H.264 video, AAC audioThis browser can encode it",
      "Estimated size: About 37 MB",
    ]);
    expect(dialog.textContent).toContain("Made on this device. Nothing is uploaded.");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(exportButton(dialog).hasAttribute("disabled")).toBe(false);
    expect(fakeExport.asked).toEqual([{ size: "1080p", fps: 24 }]);
  });

  test("720p asks the browser again, and the estimate follows", async () => {
    const { dialog } = await openDialog();
    fireEvent.click(exportButton(dialog, /^720p/));
    await settle();
    expect(exportButton(dialog, /^720p/).getAttribute("aria-pressed")).toBe("true");
    expect(fakeExport.asked.at(-1)).toEqual({ size: "720p", fps: 24 });
    expect(rows(dialog)).toContain("Estimated size: About 18 MB");
  });

  test("no H.264 encoder: WebM, the board's note, and Export WebM", async () => {
    fakeExport.answers.set("1080p", { ...EVERYTHING, avc: false });
    const { dialog } = await openDialog();
    expect(rows(dialog)).toEqual([
      "Frame rate: 24 fps, the project's",
      "Format: WebM · VP9 video, Opus audio",
      "Estimated size: About 37 MB",
    ]);
    expect(dialog.textContent).toContain(
      "This browser can't encode MP4 (H.264), so the film will be WebM. Most players open it. For an MP4, export in a browser that can encode H.264, such as Chrome or Edge.",
    );
    expect(exportButton(dialog, "Export WebM")).toBeDefined();
  });

  test("H.264 without AAC: WebM too, saying it's the audio", async () => {
    fakeExport.answers.set("1080p", { ...EVERYTHING, aac: false });
    const { dialog } = await openDialog();
    expect(dialog.textContent).toContain(
      "This browser can't encode MP4's AAC audio, so the film will be WebM.",
    );
  });

  test("nothing encodes at a size: no export there, and why", async () => {
    fakeExport.answers.set("1080p", { avc: true, aac: false, vp9: false, opus: false });
    const { dialog } = await openDialog();
    expect(rows(dialog)).toContain("Format: None at this size");
    expect(dialog.textContent).toContain(
      "This browser can't encode MP4 or WebM at 1920 × 1080. Try 720p, or export in a current Chrome, Edge, Safari or Firefox.",
    );
    expect(exportButton(dialog).hasAttribute("disabled")).toBe(true);
  });

  test("the keyboard starts on the chosen size, not on Close", async () => {
    const { dialog } = await openDialog();
    expect(document.activeElement).toBe(exportButton(dialog, /^1080p/));
  });

  test("Cancel, the close button and Esc close it", async () => {
    const { dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent(await screen.findByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the editor's keys do nothing behind it", async () => {
    const { dialog } = await openDialog();
    const before = useDocumentStore.getState().project;
    fireEvent.keyDown(dialog, { key: "Delete" });
    fireEvent.keyDown(document.body, { key: "s" });
    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    expect(useDocumentStore.getState().project).toBe(before);
  });
});

describe("exporting", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function exporting() {
    const opened = await openDialog();
    fireEvent.click(exportButton(opened.dialog));
    await settle();
    return opened;
  }

  test("a snapshot of the project and the mixed music go to the worker", async () => {
    await exporting();
    const project = useDocumentStore.getState().project;
    expect(fakes.mix).toHaveBeenCalledWith(project);
    expect(fakeExport.started).toHaveLength(1);
    expect(fakeExport.started[0]?.job).toMatchObject({
      project,
      size: "1080p",
      format: "mp4",
      audio: MIXED,
      preview: { width: 472, height: 266 },
    });
  });

  test("the board's progress: the frame being encoded, the share done and the time left", async () => {
    const { dialog } = await exporting();
    expect(within(dialog).getByRole("heading", { name: "Exporting…" })).toBeDefined();
    expect(dialog.textContent).toContain("MP4 · 1920 × 1080 · 24 fps");
    const bar = within(dialog).getByRole("progressbar", { name: "Export progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(dialog.textContent).toContain("0%Starting…");
    expect(dialog.textContent).toContain("Keep this tab open. Your project doesn't change.");

    // 48 frames a second: after frame 691, 388 are left, about 8 s.
    act(() => {
      for (let frame = 0; frame <= 691; frame += 1) {
        vi.advanceTimersByTime(1000 / 48);
        fakeExport.emit({ type: "progress", frame, open: 2 });
      }
      fakeExport.emit({ type: "preview", frame: 691, bitmap: picture("f691"), open: 2 });
    });
    expect(bar.getAttribute("aria-valuenow")).toBe("64");
    expect(dialog.textContent).toContain("64%About 8 s left");
    expect(dialog.textContent).toContain("Frame 691 of 1,080");
    expect(drawnIn(pictureBox(dialog, "The frame being encoded"))).toEqual(["image f691"]);

    act(() => {
      for (let frame = 692; frame < 1_080; frame += 1) {
        fakeExport.emit({ type: "progress", frame, open: 2 });
      }
    });
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(dialog.textContent).toContain("100%Finishing the file…");
  });

  test("a newer picture replaces the last, which is let go of", async () => {
    await exporting();
    const first = picture("f0");
    const close = vi.spyOn(first, "close");
    act(() => {
      fakeExport.emit({ type: "preview", frame: 0, bitmap: first, open: 1 });
      fakeExport.emit({ type: "preview", frame: 12, bitmap: picture("f12"), open: 1 });
    });
    expect(close).toHaveBeenCalledOnce();
  });

  test("the project never changes, and edits can't reach it", async () => {
    const { dialog } = await exporting();
    const before = useDocumentStore.getState().project;
    fireEvent.keyDown(dialog, { key: "Backspace" });
    fireEvent.keyDown(document.body, { key: "s" });
    act(() => {
      fakeExport.emit({ type: "progress", frame: 0, open: 1 });
    });
    expect(useDocumentStore.getState().project).toBe(before);
  });

  test("Cancel stops the worker, closes the dialog, and the board's toast offers Export again", async () => {
    const { dialog } = await exporting();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fakeExport.canceled).toEqual([fakeExport.started[0]?.run]);
    expect(screen.queryByRole("dialog")).toBeNull();
    const toast = messages();
    expect(toast.textContent).toContain(
      "Export canceled. Nothing was saved, and your project is unchanged.",
    );
    fireEvent.click(within(toast).getByRole("button", { name: "Export again" }));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByRole("heading", { name: "Export" })).toBeDefined();
  });

  test("exporting puts the keyboard on Cancel", async () => {
    const { dialog } = await exporting();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
  });

  test("a canceled export's late picture and file are let go of, unseen", async () => {
    const { dialog } = await exporting();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const canceled = fakeExport.started[0];
    if (!canceled) throw new Error("No export was started");
    const late = picture("late");
    const first = picture("first");
    const closeLate = vi.spyOn(late, "close");
    const closeFirst = vi.spyOn(first, "close");
    act(() => {
      canceled.listener({ type: "preview", run: canceled.run, frame: 3, bitmap: late, open: 1 });
      canceled.listener({
        type: "done",
        run: canceled.run,
        file: { size: 1 } as Blob,
        measured: { durationSec: 45, firstFrame: true, lastFrame: true },
        firstFrame: first,
        timings: { framesMs: 1, readMs: 0, audioMs: 0, videoMs: 0, finishMs: 0, checkMs: 0 },
        open: 0,
      });
    });
    expect(closeLate).toHaveBeenCalledOnce();
    expect(closeFirst).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Esc while exporting is Cancel", async () => {
    const { dialog } = await exporting();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(fakeExport.canceled).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("canceled while the music mixes: nothing reaches the worker", async () => {
    let finish: (audio: MixedAudio) => void = () => undefined;
    fakes.mix.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { dialog } = await exporting();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    finish(MIXED);
    await settle();
    expect(fakeExport.started).toHaveLength(0);
  });
});

describe("done", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function finished(durationSec = 45) {
    const { dialog } = await openDialog();
    fireEvent.click(exportButton(dialog));
    await settle();
    act(() => {
      vi.advanceTimersByTime(21_400);
      fakeExport.emit({
        type: "done",
        file: { size: 38_204_311 } as Blob,
        measured: { durationSec, firstFrame: true, lastFrame: true },
        firstFrame: picture("first"),
        timings: {
          framesMs: 21_000,
          readMs: 12_000,
          audioMs: 100,
          videoMs: 8_000,
          finishMs: 300,
          checkMs: 60,
        },
        open: 0,
      });
    });
    return screen.getByRole("dialog");
  }

  test("the board's done screen: the speed, the first frame, the file, the check, Download", async () => {
    const dialog = await finished();
    expect(within(dialog).getByRole("heading", { name: "Your film is ready" })).toBeDefined();
    expect(dialog.textContent).toContain("Exported in 21.4 s, 2.1× faster than real time");
    expect(drawnIn(pictureBox(dialog, "The film's first frame"))).toEqual(["image first"]);
    expect(dialog.textContent).toContain("the-robot-story.mp4");
    expect(dialog.textContent).toContain("38.2 MB · 1920 × 1080 · 24 fps · 00:00:45:00");
    expect(dialog.textContent).toContain(
      "Checked: first and last frames decode; length matches the cut",
    );
    const download = within(dialog).getByRole("link", { name: "Download" });
    expect(download.getAttribute("href")).toBe("blob:film");
    expect(download.getAttribute("download")).toBe("the-robot-story.mp4");
    expect(counters.exportCheck).toBe("ok · 45.000 s of 45.000 s");
  });

  test("done puts the keyboard on Download", async () => {
    const dialog = await finished();
    expect(document.activeElement).toBe(within(dialog).getByRole("link", { name: "Download" }));
  });

  test("a check that fails says what didn't hold", async () => {
    const dialog = await finished(44.5);
    expect(dialog.textContent).toContain(
      "Check failed: it's 00:00:44:12 long, and the cut is 00:00:45:00",
    );
  });

  test("Close lets go of the file", async () => {
    const dialog = await finished();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0] ?? dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:film");
  });
});

describe("failed", () => {
  async function failing() {
    const { dialog } = await openDialog();
    fireEvent.click(exportButton(dialog));
    await settle();
    return dialog;
  }

  test("the board's failure: where the encoder stopped, details for a bug report, Try again", async () => {
    await failing();
    act(() => {
      fakeExport.emit({
        type: "failed",
        failure: {
          kind: "encoder",
          track: "video",
          frame: 412,
          message: "EncodingError: Encoding failed.",
          codec: "avc1.640028",
        },
        open: 0,
      });
    });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Export failed" })).toBeDefined();
    expect(dialog.textContent).toContain(
      "The video encoder stopped at frame 412 (00:00:17:04). Nothing was saved, and your project is unchanged.",
    );
    expect(dialog.querySelector("summary")?.textContent).toBe("Details for a bug report");
    expect(dialog.querySelector("pre")?.textContent).toBe(
      "EncodingError: Encoding failed.\navc1.640028 · 1920 × 1080 · 24 fps · frame 412 of 1,080",
    );
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Try again" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    await settle();
    expect(fakeExport.started).toHaveLength(2);
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", { name: "Exporting…" }),
    ).toBeDefined();
  });

  test("a clip that stopped decoding is named", async () => {
    await failing();
    act(() => {
      fakeExport.emit({
        type: "failed",
        failure: { kind: "decode", assetId: "07-medium", frame: 432, message: "No frame" },
        open: 0,
      });
    });
    expect(screen.getByRole("dialog").textContent).toContain(
      "07-medium couldn't be decoded at frame 432 (00:00:18:00).",
    );
  });

  test("a Feed clip that couldn't be read: the dialog closes, the board's toast, and Retry", async () => {
    await failing();
    act(() => {
      fakeExport.emit({
        type: "failed",
        failure: { kind: "unreachable", assetId: "07-medium" },
        open: 0,
      });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "Export stopped: 07-medium couldn't be read from the Feed. Check your connection, then try again.",
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByRole("dialog");
    await settle();
    expect(fakeExport.started).toHaveLength(2);
    expect(fakeExport.started[1]?.job.size).toBe("1080p");
  });

  test("music that didn't come from its address stops it the same way", async () => {
    const { MusicError } = await import("../../src/media/export-mix.ts");
    fakes.mix.mockRejectedValueOnce(new MusicError(DEMO_MUSIC, "unreadable"));
    await failing();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Export stopped: Demo music couldn't be read. Check your connection, then try again.",
    );
    expect(fakeExport.started).toHaveLength(0);
  });

  test("music that came but won't decode is the failed dialog, not the network's toast", async () => {
    const { MusicError } = await import("../../src/media/export-mix.ts");
    fakes.mix.mockRejectedValueOnce(new MusicError(DEMO_MUSIC, "undecodable"));
    await failing();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Export failed" })).toBeDefined();
    expect(dialog.textContent).toContain(
      "Demo music couldn't be decoded. Nothing was saved, and your project is unchanged.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a worker that breaks: the file couldn't be finished", async () => {
    await failing();
    act(() => {
      fakeExport.emit({ type: "crashed" });
    });
    expect(screen.getByRole("dialog").textContent).toContain(
      "The file couldn't be finished. Nothing was saved, and your project is unchanged.",
    );
  });
});

describe("the toolbar's Export", () => {
  test("off with nothing to export", () => {
    renderEmptyEditor();
    expect(screen.getByRole("button", { name: "Export" }).hasAttribute("disabled")).toBe(true);
  });

  test("no video encoder in this browser: the board's Export unavailable, and why", () => {
    vi.unstubAllGlobals();
    renderEditor();
    const button = screen.getByRole("button", { name: "Export unavailable" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const why = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(why?.textContent).toBe(
      "Export needs video encoding (WebCodecs), which this browser doesn't offer. Open the app in a current Chrome, Edge, Safari or Firefox. Editing still works here.",
    );
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Export pauses playback", async () => {
    const { playback } = await import("../../src/media/playback.ts");
    const pause = vi.spyOn(playback, "pause");
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(pause).toHaveBeenCalled();
    await screen.findByRole("dialog");
  });
});
