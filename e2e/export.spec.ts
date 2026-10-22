// Export (spec sections 3.4 and 4.7; e2e test 8). A 3 s cut of the frame-index fixture exports, in
// Chrome and in WebKit where its platform encodes: its first frame, decoded back from the file, is
// the one the cut puts there (the fixture paints each frame's index), and the browser's own player
// opens the file, it lasts 3 s within a frame, and each of its frames is the cut's (not read in
// CI's Linux WebKit, whose player reads frames back black). In Chrome: a click in the music lands
// where it was put; Cancel leaves no file and the project as it was; and a Feed clip that can't be
// read stops the export with the board's toast. In both: the toolbar's Export unavailable, and the
// WebM fallback with the browser's answer stubbed.

// The functions passed to page.evaluate and page.addInitScript run in the page, with the DOM.
/// <reference lib="dom" />

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { clip, dragBy, jumpTo, loadStory } from "./editor.ts";
import { expect, test } from "./storage.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const MEDIA = "https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev";
/** 01-wide's Feed item: its 1080p original is what a 1080p export reads. */
const FIRST_SHOT_ID = "csn26qjo95";

const notChrome = ({ browserName }: { browserName: string }) => browserName !== "chromium";

/** Picks files: fixtures by name, or made by the test. */
async function addFiles(page: Page, files: (string | { name: string; buffer: Buffer })[]) {
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      files.map((file) =>
        typeof file === "string"
          ? { name: file, mimeType: "video/mp4", buffer: readFileSync(join(FIXTURES, file)) }
          : { ...file, mimeType: "audio/wav" },
      ),
    );
  await page.waitForFunction(
    (count) => performance.getEntriesByName("import:ready").length === count,
    files.length,
  );
}

/** Adds a file from My files at the playhead, on the active track. */
async function place(page: Page, name: string): Promise<void> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page
    .getByRole("region", { name: "Media bin" })
    .getByRole("button", { name: new RegExp(`^${escaped} `) })
    .click();
}

function overlayRow(page: Page, label: string): Locator {
  return page
    .getByRole("complementary", { name: "Performance" })
    .locator("div", { hasText: new RegExp(`^${label}`) })
    .locator("span")
    .last();
}

/** Every value the export's progress bar takes from now on. */
async function recordProgress(page: Page): Promise<() => Promise<number[]>> {
  await page.evaluate(() => {
    const seen: number[] = [];
    Reflect.set(window, "__progress", seen);
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (target instanceof Element && target.getAttribute("role") === "progressbar") {
          seen.push(Number(target.getAttribute("aria-valuenow")));
        }
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-valuenow"],
    });
  });
  return () => page.evaluate(() => Reflect.get(window, "__progress") as number[]);
}

/**
 * The exported film as the browser's own player reads it: its length and size, and the index the
 * frame-index fixture paints on each of its first `count` frames (bit k is block k of a 4 × 2
 * grid), seeking to the middle of each frame.
 */
function readFilm(page: Page, url: string, count: number, fps: number) {
  return page.evaluate(
    async ({ url, count, fps }) => {
      const video = document.createElement("video");
      video.muted = true;
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => {
          reject(new Error("The film doesn't open"));
        };
      });
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("No 2D context");
      const indexes: number[] = [];
      for (let frame = 0; frame < count; frame += 1) {
        // WebKit can fire "seeked" before the new frame is ready to draw: wait for both it and the
        // frame's own callback (or a second, should a browser not call it).
        await new Promise<void>((resolve) => {
          let waiting = "requestVideoFrameCallback" in video ? 2 : 1;
          const arrived = () => {
            waiting -= 1;
            if (waiting === 0) resolve();
          };
          video.onseeked = arrived;
          if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(arrived);
          video.currentTime = (frame + 0.5) / fps;
          setTimeout(resolve, 1_000);
        });
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        let index = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const x = Math.floor((((bit % 4) + 0.5) * canvas.width) / 4);
          const y = Math.floor(((Math.floor(bit / 4) + 0.5) * canvas.height) / 2);
          const [luma = 0] = context.getImageData(x, y, 1, 1).data;
          if (luma > 128) index += 1 << bit;
        }
        indexes.push(index);
      }
      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        indexes,
      };
    },
    { url, count, fps },
  );
}

/**
 * The index the frame-index fixture paints on one of the export dialog's pictures: the film's
 * first frame, as the export decoded it back from the file.
 */
function pictureIndex(page: Page, name: string): Promise<number> {
  return page
    .getByRole("dialog")
    .getByRole("img", { name })
    .evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return -1;
      const context = canvas.getContext("2d");
      if (!context) return -1;
      let index = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = Math.floor((((bit % 4) + 0.5) * canvas.width) / 4);
        const y = Math.floor(((Math.floor(bit / 4) + 0.5) * canvas.height) / 2);
        const [luma = 0] = context.getImageData(x, y, 1, 1).data;
        if (luma > 128) index += 1 << bit;
      }
      return index;
    });
}

/** 2 s of 48 kHz mono silence with a click at exactly 1.000 s, as a WAV file. */
function clickWav(): Buffer {
  const rate = 48_000;
  const samples = 2 * rate;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let sample = rate; sample < rate + 48; sample += 1)
    wav.writeInt16LE(26_000, 44 + sample * 2);
  return wav;
}

/** Where the first loud sample of the film's sound is, in seconds, as the browser decodes it. */
function clickInFilm(page: Page, url: string): Promise<number | null> {
  return page.evaluate(async (url) => {
    const bytes = await (await fetch(url)).arrayBuffer();
    const sound = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(bytes);
    const index = sound.getChannelData(0).findIndex((sample) => Math.abs(sample) > 0.2);
    return index < 0 ? null : index / sound.sampleRate;
  }, url);
}

/**
 * Makes the browser's answer, as the export worker sends it, say which codecs encode here: a page
 * script wraps the worker named "export" and rewrites its `encoders` message.
 */
async function stubEncoders(
  page: Page,
  encoders: { avc: boolean; aac: boolean; vp9: boolean; opus: boolean },
): Promise<void> {
  await page.addInitScript((answer) => {
    // The toolbar only asks whether WebCodecs' encoder exists; CI's Linux WebKit may have none.
    if (!("VideoEncoder" in window))
      Reflect.set(window, "VideoEncoder", function VideoEncoder() {});
    class Answering extends Worker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== "export") return;
        this.addEventListener("message", (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (typeof data !== "object" || data === null) return;
          if (Reflect.get(data, "type") !== "encoders" || Reflect.get(data, "stubbed") === true) {
            return;
          }
          event.stopImmediatePropagation();
          const stubbed = { ...data, encoders: answer, stubbed: true };
          this.dispatchEvent(new MessageEvent("message", { data: stubbed }));
        });
      }
    }
    window.Worker = Answering;
  }, encoders);
}

async function openExport(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Export" })).toBeVisible();
  return dialog;
}

/** The timeline's clips, as their names say where they are. */
function cut(page: Page): Promise<string[]> {
  return page
    .getByRole("button", { name: / on (V1|V2|A1), / })
    .evaluateAll((clips) => clips.map((element) => element.getAttribute("aria-label") ?? ""));
}

test("8: a 3 s cut exports; it decodes, lasts 3 s within a frame, and each frame is the cut's", async ({
  page,
  browserName,
}) => {
  await page.goto("/?perf=1");
  await addFiles(page, ["frame-index.mp4"]);
  await place(page, "frame-index.mp4");
  // Its start trimmed to source frame 12, slid back to 0 and cut at 3 s: frame n shows source
  // frame n + 12.
  await jumpTo(page, "00:00:00:12");
  await page.keyboard.press("[");
  await dragBy(page, clip(page, "frame-index\\.mp4"), { x: 60, dx: -24 });
  await jumpTo(page, "00:00:03:00");
  await page.keyboard.press("]");
  await expect(clip(page, "frame-index\\.mp4")).toHaveAccessibleName(
    /starts 00:00:00:00, 00:00:03:00 long/,
  );

  // WebKit encodes what its platform offers (all four codecs on macOS): where it offers none,
  // the dialog says so, and there's nothing to export.
  const unavailable = await page.getByRole("button", { name: "Export unavailable" }).count();
  test.skip(unavailable > 0, "This browser has no video encoder");
  const progress = await recordProgress(page);
  const dialog = await openExport(page);
  await expect(dialog).toContainText("Untitled project · 00:00:03:00 · 1 clip");
  await expect(dialog).not.toContainText("Checking what this browser can encode");
  test.skip((await dialog.textContent())?.includes("None at this size") === true, "No codec");
  const start = dialog.getByRole("button", { name: /^Export/ });
  const format = (await start.textContent()) === "Export WebM" ? "webm" : "mp4";
  await start.click();
  await expect(dialog.getByRole("heading", { name: "Your film is ready" })).toBeVisible({
    timeout: 60_000,
  });
  expect(Math.max(...(await progress()))).toBe(100);
  await expect(dialog).toContainText(`untitled-project.${format}`);
  await expect(dialog).toContainText("1920 × 1080 · 24 fps · 00:00:03:00");
  await expect(dialog).toContainText(
    "Checked: first and last frames decode; length matches the cut",
  );
  await expect(overlayRow(page, "Export check")).toHaveText("ok · 3.000 s of 3.000 s");

  // The done screen's picture is the film's first frame, decoded back from the file: source frame 12.
  expect(await pictureIndex(page, "The film's first frame")).toBe(12);

  const download = dialog.getByRole("link", { name: "Download" });
  // The browser's own player opens it, and its every frame is the cut's, where that player's
  // frames can be read: CI's Linux WebKit reads each one back black, though the film is right (its
  // first frame, above, is source frame 12).
  const frames = browserName === "webkit" && process.platform === "linux" ? 0 : 72;
  const film = await readFilm(page, (await download.getAttribute("href")) ?? "", frames, 24);
  expect(Math.abs(film.duration - 3)).toBeLessThanOrEqual(1 / 24);
  expect([film.width, film.height]).toEqual([1920, 1080]);
  expect(film.indexes).toEqual(Array.from({ length: frames }, (_, frame) => frame + 12));

  const [saved] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(saved.suggestedFilename()).toBe(`untitled-project.${format}`);
  await expect(overlayRow(page, "Open VideoFrames")).toHaveText("0");
});

test.describe("in Chrome", () => {
  test.skip(notChrome, "H.264, AAC, VP9 and Opus encode in Google Chrome");

  for (const format of ["the browser's own format", "WebM"] as const) {
    test(`the music lands on the picture: a click put at 1 s is at 1 s in the film, in ${format}`, async ({
      page,
    }) => {
      // MP4 where AAC encodes (Chrome on macOS), else WebM (Chrome on Linux has no AAC encoder);
      // WebM where H.264 doesn't encode, which the browser's answer is stubbed to say.
      if (format === "WebM")
        await stubEncoders(page, { avc: false, aac: true, vp9: true, opus: true });
      await page.goto("/");
      await addFiles(page, ["frame-index.mp4", { name: "click.wav", buffer: clickWav() }]);
      await place(page, "frame-index.mp4");
      await place(page, "click.wav");
      const dialog = await openExport(page);
      await expect(dialog).toContainText(
        format === "WebM"
          ? "WebM · VP9 video, Opus audio"
          : /MP4 · H\.264 video, AAC audio|WebM · VP9 video, Opus audio/,
      );
      await dialog.getByRole("button", { name: /^Export/ }).click();
      await expect(dialog.getByRole("heading", { name: "Your film is ready" })).toBeVisible({
        timeout: 60_000,
      });
      const link = dialog.getByRole("link", { name: "Download" });
      const url = (await link.getAttribute("href")) ?? "";
      // Within 2 ms: AAC's priming (44 ms in Chrome on macOS) is skipped, as is Opus's.
      expect(Math.abs(((await clickInFilm(page, url)) ?? Number.NaN) - 1)).toBeLessThan(0.002);
    });
  }

  test("Cancel stops the export: no file, and the project as it was", async ({ page }) => {
    await loadStory(page, "/?perf=1");
    const before = await cut(page);
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    const dialog = await openExport(page);
    await dialog.getByRole("button", { name: /^Export/ }).click();
    const bar = dialog.getByRole("progressbar", { name: "Export progress" });
    await expect
      .poll(async () => Number(await bar.getAttribute("aria-valuenow")))
      .toBeGreaterThan(2);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(dialog).toBeHidden();
    // The dialog gave the keyboard back to what had it.
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeFocused();
    const toast = page.getByRole("region", { name: "Messages" });
    await expect(toast).toContainText(
      "Export canceled. Nothing was saved, and your project is unchanged.",
    );
    await expect(toast.getByRole("button", { name: "Export again" })).toBeVisible();
    expect(await cut(page)).toEqual(before);
    await expect(page.getByRole("button", { name: /^Undo/ })).toBeDisabled();
    await expect(page.locator("a[download]")).toHaveCount(0);
    await expect(overlayRow(page, "Open VideoFrames")).toHaveText("0");
    expect(downloads).toEqual([]);
  });

  test("a Feed clip that can't be read stops the export with the board's toast; Retry exports again", async ({
    page,
  }) => {
    await loadStory(page);
    // 01-wide's original stops answering; its 720p file, which the editor shows, still answers.
    const original = `${MEDIA}/originals/${FIRST_SHOT_ID}.mp4`;
    await page.route(original, (route) => route.abort("failed"));
    const dialog = await openExport(page);
    await dialog.getByRole("button", { name: /^Export/ }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "Export stopped: 01-wide couldn't be read from the Feed. Check your connection, then try again.",
      { timeout: 20_000 },
    );
    await expect(dialog).toBeHidden();
    await page.unroute(original);
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(dialog.getByRole("heading", { name: "Exporting…" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
});

test("without video encoding, Export says why and which browsers can", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "VideoEncoder");
  });
  await page.goto("/");
  const unavailable = page.getByRole("button", { name: "Export unavailable" });
  await expect(unavailable).toHaveAttribute("aria-disabled", "true");
  await unavailable.hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Export needs video encoding (WebCodecs), which this browser doesn't offer. Open the app in a current Chrome, Edge, Safari or Firefox. Editing still works here.",
  );
  // aria-disabled keeps it focusable, so its explanation can be read; a click does nothing.
  await unavailable.click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("where H.264 doesn't encode, the film is WebM, with the board's note", async ({ page }) => {
  await stubEncoders(page, { avc: false, aac: true, vp9: true, opus: true });
  await loadStory(page);
  const dialog = await openExport(page);
  await expect(dialog.getByRole("button", { name: /^1080p/ })).toBeFocused();
  await expect(dialog).toContainText("WebM · VP9 video, Opus audio");
  await expect(dialog).toContainText(
    "This browser can't encode MP4 (H.264), so the film will be WebM. Most players open it. For an MP4, export in a browser that can encode H.264, such as Chrome or Edge.",
  );
  await expect(dialog.getByRole("button", { name: "Export WebM" })).toBeEnabled();
});
