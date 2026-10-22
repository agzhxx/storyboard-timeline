// Importing files (spec sections 3.6 and 4.5, and e2e test 10) with the clips in e2e/fixtures,
// made by make-fixtures.sh, in Google Chrome and WebKit. An import stores the file, so these tests
// use the `test` from storage.ts, which gives WebKit's pages a file system.

// The functions passed to page.evaluate run in the page, with the DOM.
/// <reference lib="dom" />

import { join } from "node:path";
import type { Page } from "@playwright/test";
import { clip } from "./editor.ts";
import { newestSave } from "./saves.ts";
import { expect, test } from "./storage.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");

function bin(page: Page) {
  return page.getByRole("region", { name: "Media bin" });
}

/** Picks files from the fixtures with the bin's file picker. */
async function addFiles(page: Page, ...names: string[]): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(names.map((name) => join(FIXTURES, name)));
}

/** A file in My files that can be placed, by its name. */
function fileRow(page: Page, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return bin(page).getByRole("button", { name: new RegExp(`^${escaped} `) });
}

/** Waits until this many imports have finished, thumbnails and meta.json included. */
async function importsFinished(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (expected) => performance.getEntriesByName("import:ready").length === expected,
    count,
  );
}

/** Each stored copy's thumbnails.json, as written; null for one that has none. */
async function storedThumbnails(page: Page): Promise<unknown[]> {
  return page.evaluate(async () => {
    const assets = await (await navigator.storage.getDirectory()).getDirectoryHandle("assets");
    const found: unknown[] = [];
    for await (const folder of assets.values()) {
      if (folder.kind !== "directory") continue;
      try {
        const file = await (await folder.getFileHandle("thumbnails.json")).getFile();
        found.push(JSON.parse(await file.text()));
      } catch {
        found.push(null);
      }
    }
    return found;
  });
}

/**
 * The colors drawn on a clip's canvases, coarsely (3 bits a channel): many for a filmstrip of
 * the test pattern, one or two for a waveform.
 */
async function drawnColors(page: Page, clipName: string): Promise<string[]> {
  return page.evaluate((label) => {
    const element = [...document.querySelectorAll('[role="button"]')].find((candidate) =>
      candidate.getAttribute("aria-label")?.startsWith(label),
    );
    const colors = new Set<string>();
    for (const canvas of element?.querySelectorAll("canvas") ?? []) {
      const context = canvas.getContext("2d");
      if (!context) continue;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < data.length; index += 4 * 7) {
        if ((data[index + 3] ?? 0) < 255) continue;
        const [r = 0, g = 0, b = 0] = [data[index], data[index + 1], data[index + 2]];
        colors.add(`${r >> 5},${g >> 5},${b >> 5}`);
      }
    }
    return [...colors];
  }, `${clipName} on `);
}

/**
 * Whether a clip's second filmstrip slot is drawn in full with a picture of its own: at 2 px per
 * frame and 24 fps, the first slot shows second 0 and the second, from 138.67 px, second 2. The
 * slots' pixels must differ on average by more than a picture drawn at a fractional offset would.
 */
async function secondSlotDrawn(page: Page, clipName: string): Promise<boolean> {
  return page.evaluate((label) => {
    const element = [...document.querySelectorAll('[role="button"]')].find((candidate) =>
      candidate.getAttribute("aria-label")?.startsWith(label),
    );
    const canvas = element?.querySelector("canvas");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return false;
    // A slot is as wide as a 16:9 thumbnail at the clip's height.
    const slot = Math.ceil((canvas.height * 16) / 9);
    const width = canvas.width - slot - 4;
    const first = context.getImageData(2, 0, width, canvas.height).data;
    const second = context.getImageData(slot + 2, 0, width, canvas.height).data;
    let difference = 0;
    for (let i = 0; i < second.length; i += 4) {
      if (second[i + 3] !== 255) return false;
      for (const channel of [0, 1, 2]) {
        difference += Math.abs((first[i + channel] ?? 0) - (second[i + channel] ?? 0));
      }
    }
    return difference / ((second.length / 4) * 3) > 8;
  }, `${clipName} on `);
}

/** Collects console errors and uncaught exceptions. */
function errorsOf(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

test.describe("media", () => {
  test("an MP4 shows its meta line, goes on the timeline and draws a filmstrip of its frames", async ({
    page,
  }) => {
    const errors = errorsOf(page);
    await page.goto("/");
    await addFiles(page, "05-wide.mp4");

    const row = fileRow(page, "05-wide.mp4");
    await expect(row).toContainText("0:05 · 1920 × 1080 · 24 fps");
    await expect(row.locator("img")).toHaveJSProperty("complete", true);
    await row.click();

    await expect(clip(page, "05-wide.mp4")).toHaveAccessibleName(
      "05-wide.mp4 on V1, starts 00:00:00:00, 00:00:05:00 long",
    );
    // The empty project took the video's own rate.
    await expect(page.getByText("1920 × 1080 · 24 fps", { exact: true })).toBeVisible();
    // The test pattern's color bars, read back from the canvas.
    await expect
      .poll(() => drawnColors(page, "05-wide.mp4").then((c) => c.length))
      .toBeGreaterThan(6);
    expect(errors).toEqual([]);
  });

  test("WAV and MP3 music goes on A1 with a waveform drawn from its peaks", async ({ page }) => {
    const errors = errorsOf(page);
    await page.goto("/");
    await addFiles(page, "tone.wav", "tone.mp3");

    await expect(fileRow(page, "tone.wav")).toContainText("0:02 · WAV · stereo");
    await expect(fileRow(page, "tone.mp3")).toContainText("0:03 · MP3 · stereo");
    await fileRow(page, "tone.wav").click();
    await page.keyboard.press("End");
    await fileRow(page, "tone.mp3").click();

    await expect(clip(page, "tone.wav")).toHaveAccessibleName(
      "tone.wav on A1, starts 00:00:00:00, 00:00:02:00 long",
    );
    await expect(clip(page, "tone.mp3")).toHaveAccessibleName(
      "tone.mp3 on A1, starts 00:00:02:00, 00:00:03:00 long",
    );
    // fg-subtle bars on tone.wav; fg-muted on tone.mp3, which is selected.
    await expect.poll(() => drawnColors(page, "tone.wav")).toContain("4,4,4");
    await expect.poll(() => drawnColors(page, "tone.mp3")).toContain("5,5,5");
    expect(errors).toEqual([]);
  });

  test("a WebM at 25 fps sets an empty project to 25 fps", async ({ page }) => {
    await page.goto("/");
    await addFiles(page, "pattern-25fps.webm");

    await expect(fileRow(page, "pattern-25fps.webm")).toContainText("0:02 · 640 × 360 · 25 fps");
    await fileRow(page, "pattern-25fps.webm").click();
    await expect(page.getByText("1920 × 1080 · 25 fps", { exact: true })).toBeVisible();
    await expect(clip(page, "pattern-25fps.webm")).toHaveAccessibleName(/00:00:02:00 long$/);
  });

  test("10. a file this browser can't decode says why: ProRes", async ({ page }) => {
    await page.goto("/");
    await addFiles(page, "prores.mov");

    await expect(
      bin(page).getByText(
        "Can't open this file in this browser: it's Apple ProRes video. Convert it to H.264 and add it again.",
      ),
    ).toBeVisible();
    await bin(page).getByRole("button", { name: "Remove prores.mov" }).click();
    await expect(bin(page).getByText("prores.mov")).toHaveCount(0);
  });

  test("a file dragged onto a track lands under the pointer, at the rate it brings", async ({
    page,
  }) => {
    await page.goto("/");
    await addFiles(page, "05-wide.mp4");
    const row = fileRow(page, "05-wide.mp4");
    const rowBox = await row.boundingBox();
    const trackBox = await page.locator('[data-track-id="V1"]').boundingBox();
    if (!rowBox || !trackBox) throw new Error("Not visible");

    await page.mouse.move(rowBox.x + 20, rowBox.y + rowBox.height / 2);
    await page.mouse.down();
    // 400 px is frame 200 at 2 px per frame: 00:00:08:08 at the clip's 24 fps.
    await page.mouse.move(trackBox.x + 400, trackBox.y + trackBox.height / 2, { steps: 12 });
    await expect(page.getByText("at 00:00:08:08")).toBeVisible();
    await page.mouse.up();

    await expect(clip(page, "05-wide.mp4")).toHaveAccessibleName(
      "05-wide.mp4 on V1, starts 00:00:08:08, 00:00:05:00 long",
    );
  });

  test("My files is still listed after a reload, without starting the import worker", async ({
    page,
  }) => {
    await page.goto("/");
    await addFiles(page, "05-wide.mp4", "tone.wav");
    await importsFinished(page, 2);

    const workers: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("import.worker")) workers.push(request.url());
    });
    await page.reload();

    await expect(fileRow(page, "05-wide.mp4")).toContainText("0:05 · 1920 × 1080 · 24 fps");
    await expect(fileRow(page, "tone.wav")).toContainText("0:02 · WAV · stereo");
    await expect(bin(page).getByText("2 files")).toBeVisible();
    // The thumbnails and peaks come back from this browser's storage too: the filmstrip's second
    // slot shows second 2, which only reading them back brings.
    await fileRow(page, "05-wide.mp4").click();
    await fileRow(page, "tone.wav").click();
    await expect.poll(() => secondSlotDrawn(page, "05-wide.mp4")).toBe(true);
    await expect.poll(() => drawnColors(page, "tone.wav")).toContain("5,5,5");
    expect(workers).toEqual([]);
  });

  test("a video placed before its thumbnails were all made keeps its copy, and gets them again", async ({
    page,
  }) => {
    await page.goto("/");
    await addFiles(page, "05-wide.mp4");
    await importsFinished(page, 1);
    await fileRow(page, "05-wide.mp4").click();
    await expect.poll(async () => (await newestSave(page))?.clips.V1?.length).toBe(1);
    // As a tab that closed while they were made leaves it: the copy and its meta.json, no more.
    await page.evaluate(async () => {
      const assets = await (await navigator.storage.getDirectory()).getDirectoryHandle("assets");
      for await (const folder of assets.values()) {
        if (folder.kind !== "directory") continue;
        await folder.removeEntry("thumbnails.json");
        await folder.removeEntry("thumbs", { recursive: true });
      }
    });
    await page.reload();

    await expect(fileRow(page, "05-wide.mp4")).toContainText("0:05 · 1920 × 1080 · 24 fps");
    await expect.poll(() => secondSlotDrawn(page, "05-wide.mp4")).toBe(true);
    // Its name would end ", its file is missing" if the copy had gone.
    await expect(clip(page, "05-wide.mp4")).toHaveAccessibleName(/00:00:05:00 long$/);
    // Kept again, for the next start.
    await expect
      .poll(() => storedThumbnails(page))
      .toEqual([{ count: 5, type: expect.any(String) }]);
  });
});

test("a file that isn't video or audio says so", async ({ page }) => {
  await page.goto("/");
  await addFiles(page, "not-video.mp4");

  await expect(
    bin(page).getByText("Can't open this file: there's no video or audio in it."),
  ).toBeVisible();
});

test("files dragged over the bin say how many it will add, and where they stay", async ({
  page,
}) => {
  await page.goto("/");
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    for (const name of ["a.mp4", "b.mov", "c.mp3"]) transfer.items.add(new File(["…"], name));
    return transfer;
  });
  const area = 'section[aria-label="Media bin"]';

  await page.dispatchEvent(area, "dragenter", { dataTransfer });
  await expect(bin(page).getByText("Drop to add 3 files")).toBeVisible();
  await expect(bin(page).getByText("They stay on this device.")).toBeVisible();
  await page.dispatchEvent(area, "dragleave", { dataTransfer });
  await expect(bin(page).getByText("Drop to add 3 files")).toHaveCount(0);
});

test("Add your own files opens the picker for several files", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add your own files" }).click();
  expect((await chooser).isMultiple()).toBe(true);
});
