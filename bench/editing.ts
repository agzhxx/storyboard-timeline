// Measures editing on the production build in Google Chrome (docs/PERF.md, M2, M3 and M7): frame
// rate and long animation frames while dragging a clip, trimming one and zooming with the wheel,
// the slowest interaction, as the perf overlay (?perf=1) counts them, and autosave's work on the
// main thread: each save the edits and the zoom set off, as the app measures it ("save").
//
// Run `pnpm build` and `pnpm preview`, then `pnpm bench:editing` (or `pnpm bench`, which builds and
// serves it for you). Pass a CPU slowdown to emulate a slower laptop, `pnpm bench:editing 4`,
// `files` to edit a cut of imported files, with their filmstrips and waveforms, in place of the
// robot story: `pnpm bench:editing 1 files`, and `webkit` or `firefox` for Playwright's engines
// (bench/browser.ts). The story loads from the Feed (M5), with its filmstrips, so the bench waits
// for them first. Interactions are timed where the browser has the Event Timing API.

// The functions passed to page.evaluate run in the page, with the DOM.
/// <reference lib="dom" />

import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { APP_ORIGIN, engineFrom, openBrowser, slowDown } from "./browser.ts";

const URL = `${APP_ORIGIN}/?perf=1`;
const options = process.argv.slice(2);
const slowdown = Number(options.find((option) => /^\d+$/.test(option)) ?? 1);
const files = options.includes("files");
const engine = engineFrom(options);
const FIXTURES = join(import.meta.dirname, "..", "e2e", "fixtures");
/** The story's shot names, which the robot story and the cut of files share. */
const SHOTS = [
  "01-wide",
  "02-medium",
  "03-closeup",
  "04-insert",
  "05-wide",
  "06-tracking",
  "07-medium",
  "08-closeup",
  "09-cutaway",
  "10-wide",
  "11-crane-up",
  "12-wide",
  "13-closeup",
  "14-medium",
  "15-wide",
];

/** How many pointer moves (or wheel notches) each gesture sends, back to back. */
const MOVES = 250;

interface Run {
  name: string;
  /** Input events sent per second: more than a display shows, so Chrome merges them per frame. */
  movesPerSecond: number;
  frames: number;
  seconds: number;
  fps: number;
  p95FrameMs: number;
  longestFrameMs: number;
  /** Long animation frames (over 50 ms): null where the browser doesn't report them. */
  longFrames: number | null;
}

/**
 * Watches every interaction from the page's start: a click, a key, a drag's press and release.
 * Each lasts as long as its slowest event, from input to the next paint, as INP counts it.
 */
async function watchInteractions(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (!PerformanceObserver.supportedEntryTypes.includes("event")) return;
    const interactions = new Map<number, { name: string; ms: number }>();
    Reflect.set(window, "__interactions", interactions);
    const init: PerformanceObserverInit & { durationThreshold: number } = {
      type: "event",
      durationThreshold: 16,
      buffered: true,
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry instanceof PerformanceEventTiming) || entry.interactionId === 0) continue;
        const known = interactions.get(entry.interactionId);
        if (known && entry.duration <= known.ms) continue;
        interactions.set(entry.interactionId, { name: entry.name, ms: entry.duration });
      }
    }).observe(init);
  });
}

/** Starts recording every frame's timestamp and every long animation frame in the page. */
async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const counted = PerformanceObserver.supportedEntryTypes.includes("long-animation-frame");
    const record = { frames: [] as number[], longFrames: counted ? 0 : null, running: true };
    Reflect.set(window, "__bench", record);
    const tick = (now: number) => {
      record.frames.push(now);
      if (record.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (!counted) return;
    new PerformanceObserver((list) => {
      record.longFrames =
        (record.longFrames ?? 0) + list.getEntries().filter((entry) => entry.duration > 50).length;
    }).observe({ type: "long-animation-frame" });
  });
}

async function stopRecording(page: Page, name: string, movesPerSecond: number): Promise<Run> {
  // Let the last frames land, then read what was recorded.
  await page.waitForTimeout(100);
  const { frames, longFrames } = await page.evaluate(() => {
    const record = Reflect.get(window, "__bench") as {
      frames: number[];
      longFrames: number | null;
      running: boolean;
    };
    record.running = false;
    return { frames: record.frames, longFrames: record.longFrames };
  });
  const gaps = frames.slice(1).map((time, index) => time - (frames[index] ?? time));
  const sorted = [...gaps].sort((a, b) => a - b);
  const seconds = ((frames.at(-1) ?? 0) - (frames[0] ?? 0)) / 1000;
  return {
    name,
    movesPerSecond,
    frames: frames.length,
    seconds: Number(seconds.toFixed(2)),
    fps: Math.round((frames.length - 1) / seconds),
    p95FrameMs: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)),
    longestFrameMs: Number((sorted.at(-1) ?? 0).toFixed(1)),
    longFrames,
  };
}

/** Presses, moves along a path as fast as input can be sent, and lets go: moves per second. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  path: { x: number; y: number }[],
): Promise<number> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const started = performance.now();
  for (const point of path) await page.mouse.move(point.x, point.y);
  const seconds = (performance.now() - started) / 1000;
  await page.mouse.up();
  return Math.round(path.length / seconds);
}

/** Back and forth along x, `count` moves, starting at `from`. */
function sweep(from: { x: number; y: number }, span: number, count: number, dy = 0) {
  return Array.from({ length: count }, (_, index) => {
    const phase = (index / count) * Math.PI * 4;
    return { x: from.x + Math.sin(phase) * span, y: from.y + dy };
  });
}

/** A clip on the tracks, by its name: "05-wide" in the story, "05-wide.mp4" in the files. */
async function box(page: Page, name: string) {
  const clip = page.getByRole("button", { name: new RegExp(`^${name}(\\.mp4)? on `) });
  const found = await clip.boundingBox();
  if (!found) throw new Error(`${name} isn't on screen`);
  return found;
}

/** Types a time into the inspector's playhead field. */
async function jumpTo(page: Page, timecode: string): Promise<void> {
  const field = page.getByRole("textbox", { name: "Playhead" });
  await field.fill(timecode);
  await field.press("Enter");
  await field.blur();
}

/**
 * A cut of imported files, shaped like the story: the 1080p fixture once per shot, named after it,
 * 5 s each on V1, and the 3 s tone 15 times along A1. Copies on disk, so none is a duplicate.
 */
async function importCut(page: Page): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "storyboard-editing-"));
  const videos = SHOTS.map((shot) => join(folder, `${shot}.mp4`));
  const music = SHOTS.map((_, index) => join(folder, `tone-${index + 1}.mp3`));
  for (const path of videos) await copyFile(join(FIXTURES, "05-wide.mp4"), path);
  for (const path of music) await copyFile(join(FIXTURES, "tone.mp3"), path);
  await page.locator('input[type="file"]').setInputFiles([...videos, ...music]);
  await page.waitForFunction(
    (count) => performance.getEntriesByName("import:ready").length === count,
    videos.length + music.length,
    { timeout: 60_000 },
  );
  const bin = page.getByRole("region", { name: "Media bin" });
  for (const shot of SHOTS) {
    await page.keyboard.press("End");
    await bin.getByRole("button", { name: new RegExp(`^${shot}\\.mp4 `) }).click();
  }
  for (const [index] of SHOTS.entries()) {
    await jumpTo(page, `00:00:${String(index * 3).padStart(2, "0")}:00`);
    await bin.getByRole("button", { name: new RegExp(`^tone-${index + 1}\\.mp3 `) }).click();
  }
  await page.keyboard.press("Home");
  await rm(folder, { recursive: true });
}

/** The robot story from the Feed, with its 15 filmstrips in (the app marks each). */
async function loadStory(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Load the robot story" }).click();
  await page.getByRole("button", { name: /^15-wide on V1, / }).waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () => performance.getEntriesByName("feed:thumbnails").length >= 15,
    null,
    { timeout: 120_000 },
  );
}

const browser = await openBrowser(engine);
const page = await browser.newPage();
await slowDown(page, engine, slowdown);
await page.goto(URL);
await watchInteractions(page);
if (files) await importCut(page);
else await loadStory(page);
await page.waitForTimeout(500);
const runs: Run[] = [];

// 1. Drag 05-wide up to V2, then back and forth along it, snapping on the way.
const wide = await box(page, "05-wide");
const grab = { x: wide.x + 40, y: wide.y + wide.height / 2 };
await startRecording(page);
let rate = await drag(page, grab, sweep({ x: grab.x, y: grab.y - 80 }, 400, MOVES));
runs.push(await stopRecording(page, "Drag a clip", rate));
await page.keyboard.press("ControlOrMeta+z");

// 2. Trim a clip's start back and forth, into its neighbor and its source's start: 08-closeup in
// the story; 06-tracking among the files, whose 5 s clips put 08-closeup out of view.
const closeup = await box(page, files ? "06-tracking" : "08-closeup");
const edge = { x: closeup.x + 3, y: closeup.y + closeup.height / 2 };
await startRecording(page);
rate = await drag(page, edge, sweep(edge, 60, MOVES));
runs.push(await stopRecording(page, "Trim a clip", rate));
await page.keyboard.press("ControlOrMeta+z");

// 3. Zoom in and out with Ctrl + wheel over the tracks.
await page.mouse.move(700, 750);
await page.keyboard.down("Control");
await startRecording(page);
const zoomStarted = performance.now();
for (let notch = 0; notch < MOVES; notch += 1) {
  await page.mouse.wheel(0, notch % 100 < 50 ? -40 : 40);
}
rate = Math.round(MOVES / ((performance.now() - zoomStarted) / 1000));
await page.keyboard.up("Control");
runs.push(await stopRecording(page, "Zoom with Ctrl + wheel", rate));

// Every interaction in order (the story's Load click, each drag's press and release, each undo),
// and the slowest as the overlay shows it, after it refreshes.
await page.waitForTimeout(700);
const interactions = await page.evaluate(() => {
  const timed = Reflect.get(window, "__interactions") as
    Map<number, { name: string; ms: number }> | undefined;
  return timed ? [...timed.values()] : null;
});
const overlayRow = page
  .getByRole("complementary", { name: "Performance" })
  .locator("div", { hasText: "Slowest interaction" })
  .locator("span")
  .nth(1);
const overlaySays = await overlayRow.textContent();

// The saves the edits and the zoom set off: how many, and the longest main-thread part.
const saves = await page.evaluate(() =>
  performance.getEntriesByName("save").map((entry) => ({
    ms: Number(entry.duration.toFixed(2)),
    detail: (entry as PerformanceMeasure).detail as unknown,
  })),
);

console.log(
  JSON.stringify(
    { browser: browser.name, slowdown, files, runs, interactions, overlaySays, saves },
    null,
    2,
  ),
);
await browser.close();
