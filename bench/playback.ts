// Measures preview and playback on the production build in Google Chrome (docs/PERF.md, M4),
// against spec section 2's goals: while scrubbing, a picture within 50 ms (p95) and the exact frame
// within 200 ms (p95) after the pointer rests; at most 1 % late or dropped frames over a two-track
// 1080p cut; 0 open frames when paused; no heap growth over 5 play-throughs.
//
// The media is made here with ffmpeg, once, and isn't committed: 1080p H.264 at 24 fps like a
// camera's (a moving test pattern at 12 Mbit/s, a key frame every 2 s, B-frames), three 15 s clips
// end to end on V1, a 15 s clip on V2 over the middle one, and 45 s of AAC music on A1.
//
// With `story`, it measures the robot story from the Feed instead (docs/PERF.md, M5): 15 clips read
// from their addresses with range requests, and the demo music. It times the story's load and its
// 15 filmstrips (the app marks each), then measures the same way (one track, so 1,080 frames a
// play-through).
//
// Run `pnpm build` and `pnpm preview`, then `pnpm bench:playback` (or `pnpm bench`, which builds and
// serves it for you). Pass a CPU slowdown to emulate a slower laptop, `pnpm bench:playback 4`,
// `headed` to see it (and use the GPU as a person's Chrome would): `pnpm bench:playback 1 headed`,
// `story` for the robot story, and `webkit` or `firefox` for Playwright's engines (bench/browser.ts),
// in any order.

// The functions passed to page.evaluate run in the page, with the DOM.
/// <reference lib="dom" />

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  APP_ORIGIN,
  engineFrom,
  heapMb,
  openBrowser,
  slowDown,
  takeLongFrames,
  watchLongFrames,
} from "./browser.ts";

const URL = `${APP_ORIGIN}/?perf=1`;
const options = process.argv.slice(2);
const slowdown = Number(options.find((option) => /^\d+$/.test(option)) ?? 1);
const headed = options.includes("headed");
const story = options.includes("story");
const engine = engineFrom(options);
const MEDIA = join(tmpdir(), "storyboard-bench-media");
const PLAY_THROUGHS = 5;

/** The bench's media, made once and kept in the system's temporary folder. */
function makeMedia(): Record<string, string> {
  mkdirSync(MEDIA, { recursive: true });
  const ffmpeg = (args: string[], name: string) => {
    const path = join(MEDIA, name);
    if (!existsSync(path))
      execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args, path]);
    return path;
  };
  const video = (name: string, source: string, filter = "null") =>
    ffmpeg(
      [
        "-f",
        "lavfi",
        "-i",
        `${source}=size=1920x1080:rate=24:duration=15`,
        "-vf",
        filter,
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "fast",
        "-b:v",
        "12M",
        "-maxrate",
        "12M",
        "-bufsize",
        "24M",
        "-g",
        "48",
        "-movflags",
        "+faststart",
      ],
      name,
    );
  return {
    a: video("shot-a.mp4", "testsrc2"),
    b: video("shot-b.mp4", "smptehdbars", "hue=H=2*PI*t/15"),
    c: video("shot-c.mp4", "testsrc2", "hflip"),
    over: video("over.mp4", "testsrc2", "negate"),
    music: ffmpeg(
      [
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=0.4*sin(2*PI*(220+110*sin(2*PI*t/9))*t)|0.4*sin(2*PI*330*t):s=48000:d=45",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
      ],
      "music.m4a",
    ),
  };
}

/** Types a time into the inspector's playhead field. */
async function jumpTo(page: Page, timecode: string): Promise<void> {
  const field = page.getByRole("textbox", { name: "Playhead" });
  await field.fill(timecode);
  await field.press("Enter");
  await field.blur();
}

/** Imports the media and builds the cut, through the UI as a person would. */
async function buildCut(page: Page, media: Record<string, string>): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(Object.values(media));
  await page.waitForFunction(
    () => performance.getEntriesByName("import:ready").length === 5,
    null,
    {
      timeout: 120_000,
    },
  );
  const bin = page.getByRole("region", { name: "Media bin" });
  const add = (name: string) => bin.getByRole("button", { name: new RegExp(`^${name} `) }).click();
  await add("shot-a\\.mp4");
  await page.keyboard.press("End");
  await add("shot-b\\.mp4");
  await page.keyboard.press("End");
  await add("shot-c\\.mp4");
  await jumpTo(page, "00:00:15:00");
  await page.locator('[data-track-id="V2"]').click({ position: { x: 1_000, y: 30 } });
  await add("over\\.mp4");
  await page.keyboard.press("Home");
  await add("music\\.m4a");
  await page.keyboard.press("Shift+Z");
  await page.waitForTimeout(1_000);
}

/**
 * Runs in the page, before the app: stamps each Feed clip's thumbnails as they reach the page. The
 * import worker answers a `remote-thumbnails` request (which names the clip's asset) with one
 * `thumbnail` message per thumbnail (which names the request), so wrapping the Worker maps one to
 * the other. The app is unchanged.
 */
function stampThumbnails(): void {
  const assets = new Map<number, string>();
  const stamps: Record<string, Record<number, number>> = {};
  Reflect.set(window, "__thumbnails", stamps);
  class Stamping extends Worker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.addEventListener("message", (event: MessageEvent<unknown>) => {
        const data = event.data as { type?: unknown; id?: unknown; index?: unknown };
        if (data.type !== "thumbnail" || typeof data.index !== "number") return;
        const asset = typeof data.id === "number" ? assets.get(data.id) : undefined;
        if (asset !== undefined) (stamps[asset] ??= {})[data.index] ??= performance.now();
      });
    }

    override postMessage(
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions,
    ): void {
      const data = message as { type?: unknown; id?: unknown; assetId?: unknown };
      if (data.type === "remote-thumbnails" && typeof data.id === "number") {
        assets.set(data.id, String(data.assetId));
      }
      super.postMessage(message, options as StructuredSerializeOptions);
    }
  }
  window.Worker = Stamping;
}

/**
 * Loads the robot story from the Feed, as a person would, and times it from the press: to its clips
 * on the timeline (`loadMs`); to the filmstrips as the cut shows them, each clip's thumbnails for
 * seconds 0, 1 and 2, since the story uses each clip's first 3 s (`cutFilmstripsMs`); and to all
 * 15 clips' thumbnails, which the app marks "feed:thumbnails" (`filmstripsMs`). Then fits the cut
 * in view.
 */
async function loadStory(page: Page) {
  await page.evaluate(() => Reflect.set(window, "__pressed", performance.now()));
  const pressed = Date.now();
  await page.getByRole("button", { name: "Load the robot story" }).click();
  await page.getByRole("button", { name: /^15-wide on V1, / }).waitFor({ timeout: 60_000 });
  const loadMs = Date.now() - pressed;
  await page.waitForFunction(
    () => performance.getEntriesByName("feed:thumbnails").length >= 15,
    null,
    { timeout: 120_000 },
  );
  const filmstripsMs = Date.now() - pressed;
  const cutFilmstripsMs = await page.evaluate(() => {
    const stamps = Object.values(
      Reflect.get(window, "__thumbnails") as Record<string, Record<number, number>>,
    );
    const shown = stamps.map((clip) => Math.max(...[0, 1, 2].map((index) => clip[index] ?? NaN)));
    return stamps.length === 15
      ? Math.round(Math.max(...shown) - (Reflect.get(window, "__pressed") as number))
      : null;
  });
  await page.keyboard.press("Shift+Z");
  await page.waitForTimeout(1_000);
  return { loadMs, cutFilmstripsMs, filmstripsMs };
}

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] ?? Number.NaN);
}

function summary(values: readonly number[]) {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.round(Math.max(...values)),
  };
}

/** The scrub latencies measured so far, from the app's performance measures. */
function latencies(page: Page, kind: "coarse" | "exact"): Promise<number[]> {
  return page.evaluate(
    (name) => performance.getEntriesByName(name, "measure").map((entry) => entry.duration),
    `scrub:${kind}`,
  );
}

async function clearLatencies(page: Page): Promise<void> {
  await page.evaluate(() => {
    performance.clearMeasures("scrub:coarse");
    performance.clearMeasures("scrub:exact");
  });
}

function overlayRow(page: Page, label: string) {
  return page
    .getByRole("complementary", { name: "Performance" })
    .locator("div", { hasText: new RegExp(`^${label}`) })
    .locator("span")
    .last();
}

// Silent, headed too, so a run makes no sound here; the audio clock still runs.
const browser = await openBrowser(engine, headed);
const page = await browser.newPage();
await slowDown(page, engine, slowdown);
if (story) await page.addInitScript(stampThumbnails);
await page.goto(URL);
const storyLoad = story ? await loadStory(page) : null;
if (!story) await buildCut(page, makeMedia());
await watchLongFrames(page);

// The ruler, fitted to the whole cut: the 28 px above V2.
const v2 = await page.locator('[data-track-id="V2"]').boundingBox();
if (!v2) throw new Error("No tracks");
const rulerY = v2.y - 14;
const frameX = (frame: number, fit: number) => v2.x + frame * fit + 0.5;

// 1. Scrubbing: the ruler dragged across the whole cut and back, one pointer move per display frame
// (60 a second), the coarse picture timed for each. Then the pointer rests at 30 places, 400 ms
// each, and the exact frame is timed for each rest.
await page.keyboard.press("Home");
await page.waitForTimeout(500);
await clearLatencies(page);
// Shift+Z fitted the 1,080 frames with 24 px to spare.
const fit = (v2.width - 24) / 1_080;
await page.mouse.move(frameX(0, fit), rulerY);
await page.mouse.down();
for (let step = 0; step <= 240; step += 1) {
  const phase = step <= 120 ? step / 120 : (240 - step) / 120;
  await page.mouse.move(frameX(Math.round(phase * 1_070), fit), rulerY);
  await page.waitForTimeout(16);
}
const sweepCoarse = await latencies(page, "coarse");
await clearLatencies(page);
const restAt = Array.from({ length: 30 }, (_, index) => Math.round(((index * 37) % 30) * 35.5 + 7));
for (const frame of restAt) {
  await page.mouse.move(frameX(frame, fit), rulerY, { steps: 4 });
  await page.waitForTimeout(400);
}
await page.mouse.up();
const restCoarse = await latencies(page, "coarse");
const restExact = await latencies(page, "exact");
const scrubLongFrames = await takeLongFrames(page);

// 2. Stepping with →, a press every 300 ms: each step's exact frame.
await clearLatencies(page);
await jumpTo(page, "00:00:16:00");
await page.waitForTimeout(500);
await clearLatencies(page);
for (let step = 0; step < 24; step += 1) {
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
}
const steps = await latencies(page, "exact");

// 3. Playback: the whole cut, 5 times. After each, the late frames, the open frames once paused,
// and the JS heap after a garbage collection. A page hidden behind other windows pauses
// playback, so the bench counts the times it was hidden.
await page.evaluate(() => {
  Reflect.set(window, "__hidden", 0);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      Reflect.set(window, "__hidden", (Reflect.get(window, "__hidden") as number) + 1);
    }
  });
});
const playThroughs = [];
for (let run = 1; run <= PLAY_THROUGHS; run += 1) {
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    performance.clearMarks("playback:stopped");
  });
  await takeLongFrames(page);
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () => performance.getEntriesByName("playback:stopped").length > 0,
    null,
    {
      timeout: 120_000,
    },
  );
  const stopped = await page.evaluate(
    () =>
      (performance.getEntriesByName("playback:stopped")[0] as PerformanceMark).detail as {
        expected: number;
        late: number;
        clock: string | null;
      },
  );
  const longFrames = await takeLongFrames(page);
  // Where it stopped, and why if it wasn't the end: a decode error's message, or a hidden page.
  const stoppedAt = await page.getByRole("timer", { name: "Playhead" }).textContent();
  const message = (await page.getByRole("alert").allInnerTexts()).join(" ").replace(/\s+/g, " ");
  const hidden = await page.evaluate(() => {
    const times = Reflect.get(window, "__hidden") as number;
    Reflect.set(window, "__hidden", 0);
    return times;
  });
  // Open frames: polled until the worker reports it let go of everything.
  let open = "";
  for (let poll = 0; poll < 20; poll += 1) {
    await page.waitForTimeout(100);
    open = (await overlayRow(page, "Open VideoFrames").textContent()) ?? "";
    if (open === "0") break;
  }
  const heap = await heapMb(page, engine);
  playThroughs.push({
    run,
    stoppedAt,
    ...(message === "" ? {} : { message }),
    ...(hidden === 0 ? {} : { hiddenTimes: hidden }),
    ...stopped,
    latePercent: Number(((stopped.late / Math.max(1, stopped.expected)) * 100).toFixed(2)),
    openWhenPaused: Number(open),
    heapMb: heap,
    longFrames,
  });
}

console.log(
  JSON.stringify(
    {
      browser: browser.name,
      slowdown,
      headed,
      ...(storyLoad === null ? {} : { story: storyLoad }),
      scrub: {
        whileDragging: summary(sweepCoarse),
        restCoarse: summary(restCoarse),
        exactAfterRest: summary(restExact),
        longFrames: scrubLongFrames,
      },
      steps: summary(steps),
      playThroughs,
    },
    null,
    2,
  ),
);
await browser.close();
