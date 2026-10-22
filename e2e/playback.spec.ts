// Preview and playback (spec sections 3.3, 4.5 and 4.6; e2e test 7), in Google Chrome and WebKit.
// The media tests import the fixtures whose frames paint their own index (make-fixtures.sh) and
// read the monitor's pixels back to know which frame is on screen; the keyboard tests play the
// robot story, from the Feed's fixtures. An import stores the file, so this file uses the `test`
// from storage.ts, which gives WebKit's pages a file system.

// The functions passed to page.evaluate run in the page, with the DOM.
/// <reference lib="dom" />

import { join } from "node:path";
import type { Page } from "@playwright/test";
import { clip, loadStory, playheadTimecode } from "./editor.ts";
import { expect, test } from "./storage.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");

async function addFiles(page: Page, ...names: string[]): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(names.map((name) => join(FIXTURES, name)));
  await page.waitForFunction(
    (count) => performance.getEntriesByName("import:ready").length === count,
    names.length,
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

/**
 * The frame index the monitor shows: the frame-index fixtures paint bit k of it as block k of a
 * 4 × 2 grid, white for 1. -1 when the canvas can't be read.
 */
function frameIndex(page: Page): Promise<number> {
  return page.evaluate(readIndex);
}

function readIndex(): number {
  const canvas = document.querySelector<HTMLCanvasElement>(
    'section[aria-label="Program monitor"] canvas',
  );
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return -1;
  let index = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    const x = Math.floor((((bit % 4) + 0.5) * canvas.width) / 4);
    const y = Math.floor(((Math.floor(bit / 4) + 0.5) * canvas.height) / 2);
    const [luma = 0] = context.getImageData(x, y, 1, 1).data;
    if (luma > 128) index += 1 << bit;
  }
  return index;
}

/** The frame the timecode shows, at 24 or 30 fps. */
async function timecodeFrame(page: Page, fps = 24): Promise<number> {
  const text = (await playheadTimecode(page).textContent()) ?? "";
  const [hh = 0, mm = 0, ss = 0, ff = 0] = text.split(":").map(Number);
  return ((hh * 60 + mm) * 60 + ss) * fps + ff;
}

function overlayRow(page: Page, label: string) {
  return page
    .getByRole("complementary", { name: "Performance" })
    .locator("div", { hasText: new RegExp(`^${label}`) })
    .locator("span")
    .last();
}

/**
 * CI's Linux WebKit now and then draws a still's bitmap blank when it waits, undrawn, while another
 * frame decodes: V2's comes first and waits for V1's, and the monitor showed V1 alone in a third of
 * runs. So in WebKit, the page draws one pixel of each still as it arrives,
 * and none waits undrawn. The app doesn't change; Chrome and macOS WebKit never lost one.
 */
async function drawStillsOnArrival(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scratch = new OffscreenCanvas(1, 1).getContext("2d");
    class DrawingStills extends Worker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (typeof data !== "object" || data === null || !("bitmap" in data)) return;
          const { bitmap } = data;
          if (!(bitmap instanceof ImageBitmap)) return;
          scratch?.drawImage(bitmap, -Math.floor(bitmap.width / 2), -Math.floor(bitmap.height / 2));
          scratch?.getImageData(0, 0, 1, 1);
        });
      }
    }
    window.Worker = DrawingStills;
  });
}

test.describe("media", () => {
  test("7, in full: Space plays and K pauses on the frame shown; the arrows step exactly one frame", async ({
    page,
  }) => {
    await page.goto("/");
    await addFiles(page, "frame-index.mp4");
    await place(page, "frame-index.mp4");
    await expect.poll(() => frameIndex(page)).toBe(0);

    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect.poll(() => timecodeFrame(page)).toBeGreaterThan(12);
    await page.keyboard.press("k");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
    const paused = await timecodeFrame(page);
    // Paused, the picture is the frame the timecode shows, and stays.
    await expect.poll(() => frameIndex(page)).toBe(paused);
    await page.waitForTimeout(300);
    expect(await timecodeFrame(page)).toBe(paused);

    // Through a key frame every 12 frames and B-frames: each step shows exactly the next frame.
    await page.keyboard.press("Home");
    for (let frame = 1; frame <= 14; frame += 1) {
      await page.keyboard.press("ArrowRight");
      await expect(playheadTimecode(page)).toHaveText(`00:00:00:${String(frame).padStart(2, "0")}`);
      await expect.poll(() => frameIndex(page)).toBe(frame);
    }
    await page.keyboard.press("Shift+ArrowRight");
    await expect(playheadTimecode(page)).toHaveText("00:00:01:14");
    await expect.poll(() => frameIndex(page)).toBe(38);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => frameIndex(page)).toBe(37);
  });

  test("scrubbing shows the nearest thumbnail, marked Preview, then the exact frame where the pointer rests", async ({
    page,
  }) => {
    await page.goto("/");
    await addFiles(page, "frame-index.mp4");
    await place(page, "frame-index.mp4");
    await expect.poll(() => frameIndex(page)).toBe(0);
    // Each time the Preview chip appears, note which frame the canvas shows under it.
    await page.addScriptTag({ content: `window.__readIndex = ${readIndex.toString()};` });
    await page.evaluate(() => {
      const seen: number[] = [];
      Reflect.set(window, "__previews", seen);
      const read = Reflect.get(window, "__readIndex") as () => number;
      const monitor = document.querySelector('section[aria-label="Program monitor"]');
      new MutationObserver(() => {
        const chip = [...(monitor?.querySelectorAll("span") ?? [])].some(
          (span) => span.textContent === "Preview",
        );
        if (chip) seen.push(read());
      }).observe(monitor ?? document.body, { childList: true, subtree: true });
    });

    // The ruler is the 28 px above V2; at 2 px per frame, frame n is n × 2 px into it.
    const lanes = await page.locator('[data-track-id="V2"]').boundingBox();
    if (!lanes) throw new Error("No tracks");
    const y = lanes.y - 14;
    await page.mouse.move(lanes.x + 1, y);
    await page.mouse.down();
    for (let frame = 2; frame <= 62; frame += 4) {
      await page.mouse.move(lanes.x + frame * 2 + 1, y);
    }
    // The pointer rests on frame 62, still pressed: the exact frame replaces the preview.
    await expect.poll(() => frameIndex(page)).toBe(62);
    await expect(page.getByText("Preview", { exact: true })).toHaveCount(0);
    await page.mouse.up();

    const previews = await page.evaluate(() => Reflect.get(window, "__previews") as number[]);
    expect(previews.length).toBeGreaterThan(0);
    // Under the chip, a thumbnail: one per second of source, so a frame at a whole second.
    expect(previews.every((frame) => frame % 24 === 0)).toBe(true);
  });

  test("a frame that won't decode pauses playback with the board's message; Play from the next clip plays on", async ({
    page,
  }) => {
    await page.goto("/");
    await addFiles(page, "broken.mp4", "frame-index.mp4");
    await place(page, "broken.mp4");
    await page.keyboard.press("End");
    await place(page, "frame-index.mp4");
    await page.keyboard.press("Home");
    await page.keyboard.press("Space");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Can't decode broken.mp4 here");
    await expect(alert).toContainText("Paused at 00:00:02:00. The rest of the cut still plays.");
    await expect(playheadTimecode(page)).toHaveText("00:00:02:00");
    await expect(clip(page, "broken.mp4")).toHaveAccessibleName(/, can't decode$/);
    await expect(page.getByRole("img", { name: "Decode error" })).toBeVisible();

    await alert.getByRole("button", { name: "Play from the next clip" }).click();
    await expect(alert).toHaveCount(0);
    await expect.poll(() => timecodeFrame(page)).toBeGreaterThan(80);
    await page.keyboard.press("k");
    const at = await timecodeFrame(page);
    await expect.poll(() => frameIndex(page)).toBe(at - 72);
  });

  test("open VideoFrames return to 0 when paused, after playing two tracks", async ({ page }) => {
    await page.goto("/?perf=1");
    await addFiles(page, "frame-index.mp4", "05-wide.mp4");
    await place(page, "frame-index.mp4");
    await page.locator('[data-track-id="V2"]').click({ position: { x: 600, y: 30 } });
    await page.keyboard.press("Home");
    await place(page, "05-wide.mp4");
    await expect(clip(page, "05-wide.mp4")).toHaveAccessibleName(/ on V2, /);

    await page.keyboard.press("Space");
    await expect(page.getByRole("complementary", { name: "Performance" })).toContainText(
      "playing · 1×",
    );
    await page.waitForTimeout(1_500);
    await page.keyboard.press("k");
    await expect(overlayRow(page, "Open VideoFrames")).toHaveText("0");
    await expect(overlayRow(page, "Decode queue")).toHaveText("V1 0/8 · V2 0/8");
  });

  test("V2 draws over V1", async ({ browserName, page }) => {
    if (browserName === "webkit") await drawStillsOnArrival(page);
    await page.goto("/");
    await addFiles(page, "05-wide.mp4", "frame-index.mp4");
    await place(page, "05-wide.mp4");
    await page.locator('[data-track-id="V2"]').click({ position: { x: 600, y: 30 } });
    await page.keyboard.press("Home");
    await place(page, "frame-index.mp4");
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => frameIndex(page)).toBe(24);
  });

  test("a WebM at 30 fps, whose times are rounded to the millisecond, steps frame by frame", async ({
    page,
  }) => {
    await page.goto("/");
    await addFiles(page, "frame-index-30fps.webm");
    await place(page, "frame-index-30fps.webm");
    await expect(page.getByText("1920 × 1080 · 30 fps", { exact: true })).toBeVisible();
    // Frames 2, 5 and 8 are stored half a millisecond after they start.
    for (let frame = 1; frame <= 9; frame += 1) {
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => frameIndex(page)).toBe(frame);
    }
  });
});

test.describe("playing the story with the keys", () => {
  test.beforeEach(async ({ page }) => {
    await loadStory(page);
  });

  test("Space plays and the playhead moves; K pauses and it stays", async ({ page }) => {
    await page.keyboard.press("Space");
    await expect.poll(() => timecodeFrame(page)).toBeGreaterThan(12);
    await page.keyboard.press("k");
    const paused = await timecodeFrame(page);
    await page.waitForTimeout(300);
    expect(await timecodeFrame(page)).toBe(paused);
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });

  test("L plays, L again plays at 2×, J goes back a second and plays on", async ({ page }) => {
    const rate = page.getByText(/^Playback rate [12]×$/);
    await page.keyboard.press("l");
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(rate).toHaveText("Playback rate 1×");
    // Measured once it moves: without sound, the clock waits half a second for the audio first.
    await expect.poll(() => timecodeFrame(page)).toBeGreaterThan(6);
    await page.keyboard.press("l");
    await expect(rate).toHaveText("Playback rate 2×");
    // Two seconds of the cut a second, give or take what a busy runner adds.
    const before = await timecodeFrame(page);
    await page.waitForTimeout(1_000);
    const advanced = (await timecodeFrame(page)) - before;
    expect(advanced).toBeGreaterThan(36);
    expect(advanced).toBeLessThan(72);

    const beforeJ = await timecodeFrame(page);
    await page.keyboard.press("j");
    await expect.poll(() => timecodeFrame(page)).toBeLessThan(beforeJ);
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.keyboard.press("k");
    await expect(rate).toHaveText("Playback rate 1×");
  });

  test("J while paused goes back a second", async ({ page }) => {
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("j");
    await expect(playheadTimecode(page)).toHaveText("00:00:01:00");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });

  test("playback stops at the end of the cut", async ({ page }) => {
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Space");
    await expect(playheadTimecode(page)).toHaveText("00:00:45:00", { timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });
});
