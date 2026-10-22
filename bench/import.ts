// Times importing a file on the production build in Google Chrome (docs/PERF.md, M3): the 1080p
// 5 s H.264 fixture, from picking it to ready, by step (reading it, copying it, its thumbnails), and
// the long animation frames on the main thread meanwhile. The first import also starts the worker
// and loads Mediabunny; the ones after it don't.
//
// Run `pnpm build` and `pnpm preview`, then `pnpm bench:import` (or `pnpm bench`, which builds and
// serves it for you). Pass a CPU slowdown to emulate a slower laptop, `pnpm bench:import 4`, another
// file to time in its place, such as a camera's clip: `pnpm bench:import 1 ~/Movies/clip.mp4`, and
// `webkit` or `firefox` for Playwright's engines (bench/browser.ts).

// The functions passed to page.evaluate run in the page, with the DOM.
/// <reference lib="dom" />

import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  APP_ORIGIN,
  engineFrom,
  openBrowser,
  slowDown,
  takeLongFrames,
  watchLongFrames,
} from "./browser.ts";

const URL = `${APP_ORIGIN}/`;
const options = process.argv.slice(2);
const slowdown = Number(options.find((option) => /^\d+$/.test(option)) ?? 1);
const engine = engineFrom(options);
const FILE =
  options.find((option) => /\.\w+$/.test(option)) ??
  join(import.meta.dirname, "..", "e2e", "fixtures", "05-wide.mp4");
/** How many imports in one page: the first starts the worker, the rest find it running. */
const IMPORTS = 6;

interface Import {
  /** From picking the file to each step's end, in ms. */
  analyzedMs: number;
  copiedMs: number;
  readyMs: number;
  /**
   * Long animation frames (over 50 ms) on the main thread from picking the file to ready, and the
   * longest: null where the browser doesn't report them.
   */
  longFrames: number | null;
  longestFrameMs: number | null;
}

/**
 * Imports a copy of the file under a new name, so it isn't a duplicate, and times its steps. The
 * copy is on disk: a file handed over as bytes would be rebuilt in the page, on its main thread.
 */
async function importOnce(page: Page, folder: string, index: number): Promise<Import> {
  const copy = join(folder, `clip-${index}.mp4`);
  await copyFile(FILE, copy);
  await page.evaluate(() => {
    performance.clearMarks();
    Reflect.set(window, "__picked", performance.now());
  });
  await takeLongFrames(page);
  await page.locator('input[type="file"]').setInputFiles(copy);
  await page.waitForFunction(() => performance.getEntriesByName("import:ready").length === 1);
  const steps = await page.evaluate(() => {
    const picked = Reflect.get(window, "__picked") as number;
    const at = (step: string) =>
      (performance.getEntriesByName(`import:${step}`)[0]?.startTime ?? 0) - picked;
    return {
      analyzedMs: Math.round(at("analyzed")),
      copiedMs: Math.round(at("copied")),
      readyMs: Math.round(at("ready")),
    };
  });
  const frames = await takeLongFrames(page);
  return {
    ...steps,
    longFrames: frames && frames.length,
    longestFrameMs: frames && Math.max(0, ...frames),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const folder = await mkdtemp(join(tmpdir(), "storyboard-import-"));
const browser = await openBrowser(engine);
const page = await browser.newPage();
await slowDown(page, engine, slowdown);
await page.goto(URL);
// Let the page settle (fonts in, first render done), as it has by the time someone picks a file:
// startup's own long frames aren't the import's.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1_000);
await watchLongFrames(page);
const imports: Import[] = [];
for (let index = 1; index <= IMPORTS; index += 1) {
  imports.push(await importOnce(page, folder, index));
}
const [first, ...warm] = imports;
/** Long animation frames over every import, where the browser reports them. */
const reported = imports.every((run) => run.longFrames !== null);
const summary = {
  browser: browser.name,
  slowdown,
  fileBytes: (await stat(FILE)).size,
  first,
  warmMedian: {
    analyzedMs: median(warm.map((run) => run.analyzedMs)),
    copiedMs: median(warm.map((run) => run.copiedMs)),
    readyMs: median(warm.map((run) => run.readyMs)),
  },
  longFrames: reported ? imports.reduce((sum, run) => sum + (run.longFrames ?? 0), 0) : null,
  longestFrameMs: reported ? Math.max(...imports.map((run) => run.longestFrameMs ?? 0)) : null,
  imports,
};
console.log(JSON.stringify(summary, null, 2));
await browser.close();
await rm(folder, { recursive: true });
