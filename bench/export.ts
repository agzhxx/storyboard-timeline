// Measures export (docs/PERF.md, M6) on the production build in Google Chrome, against spec
// section 2's goal: the robot story's 45 s cut at 1080p, exported at 1× real time or faster. Each
// run loads the story as a person would, in a fresh browser context (so Chrome's cache doesn't
// hold the clips from the run before), waits for its 15 filmstrips, then exports at 1080p or
// 720p and reads the app's own `export` measure: from the press to the done screen, with the
// music's mix, the frame loop (how long it waited for frames and for the encoder), the finish and
// the output check. After each: the open frames once the worker let go, the JS heap after a
// garbage collection with the dialog closed, and the long animation frames on the main thread.
//
// The Feed's files are read over the network by default (the live Feed and r2.dev). With `local`,
// the bench serves the Feed's answer and its files from this machine on port 4300, fetched once
// into the system's temporary folder (about 270 MB) and kept there, so the export is timed
// without the network; it also counts the bytes the export read. Build for it first:
// `VITE_FEED_ORIGIN=http://localhost:4300 VITE_MEDIA_ORIGIN=http://localhost:4300 pnpm build`.
//
// Run `pnpm build` and `pnpm preview`, then `pnpm bench:export` (or `pnpm bench`, which builds and
// serves it for you), with any of: `local`, `headed` (use the GPU as a person's Chrome would; keep
// the window uncovered), a number of runs per size (3 by default), `1080p` or `720p` for one size
// only, and `webkit` or `firefox` for Playwright's engines (bench/browser.ts). Each run says which
// format the browser's encoders gave (MP4 or WebM), or that it had none at that size.

// The functions passed to page.evaluate run in the page, with the DOM.
/// <reference lib="dom" />

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import {
  APP_ORIGIN,
  type BenchBrowser,
  engineFrom,
  heapMb,
  openBrowser,
  takeLongFrames,
  watchLongFrames,
} from "./browser.ts";

const APP = `${APP_ORIGIN}/?perf=1`;
const FEED = "https://generation-feed.vercel.app";
const MEDIA = "https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev";
const LOCAL_PORT = 4300;
const CACHE = join(tmpdir(), "storyboard-bench-feed");

const options = process.argv.slice(2);
const local = options.includes("local");
const headed = options.includes("headed");
const engine = engineFrom(options);
const runs = Number(options.find((option) => /^\d+$/.test(option)) ?? 3);
const sizes = (["1080p", "720p"] as const).filter(
  (size) => !options.some((option) => /^\d+p$/.test(option)) || options.includes(size),
);

// Serving the Feed from this machine ------------------------------------------------------------

/** Bytes the local server has sent since the last reset: what the export read. */
let served = 0;

/** A file from the cache, fetched from `origin` the first time. */
async function cached(origin: string, path: string, name: string): Promise<string> {
  const file = join(CACHE, name);
  if (existsSync(file)) return file;
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) throw new Error(`${origin}${path} answered ${String(response.status)}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "range",
  "access-control-expose-headers": "content-length, content-range, accept-ranges, etag",
};

/** A file as R2 serves it: the whole of it, or the byte range asked for. */
function sendFile(request: IncomingMessage, response: ServerResponse, file: string, type: string) {
  const size = statSync(file).size;
  const asked = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  const start = asked ? Number(asked[1]) : 0;
  const end = asked?.[2] ? Math.min(Number(asked[2]), size - 1) : size - 1;
  const headers = { ...CORS, "content-type": type, "accept-ranges": "bytes" };
  if (asked && start >= size) {
    response.writeHead(416, { ...CORS, "content-range": `bytes */${String(size)}` }).end();
    return;
  }
  response.writeHead(asked ? 206 : 200, {
    ...headers,
    "content-length": String(end - start + 1),
    ...(asked ? { "content-range": `bytes ${String(start)}-${String(end)}/${String(size)}` } : {}),
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  stream.on("data", (chunk) => {
    served += chunk.length;
  });
  stream.pipe(response);
  response.on("close", () => stream.destroy());
}

function serveFeed(): Promise<void> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${String(LOCAL_PORT)}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, { ...CORS, "access-control-allow-methods": "GET, HEAD" }).end();
      return;
    }
    const answer = url.pathname.startsWith("/api/")
      ? cached(FEED, `${url.pathname}${url.search}`, `api/${encodeURIComponent(url.search)}.json`)
      : cached(MEDIA, url.pathname, `media${url.pathname}`);
    const type = url.pathname.startsWith("/api/")
      ? "application/json"
      : url.pathname.endsWith(".webp")
        ? "image/webp"
        : "video/mp4";
    answer.then(
      (file) => {
        sendFile(request, response, file, type);
      },
      (error: unknown) => {
        response.writeHead(502, CORS).end(String(error));
      },
    );
  });
  return new Promise((resolve) => server.listen(LOCAL_PORT, resolve));
}

// One export ------------------------------------------------------------------------------------

interface ExportMeasure {
  durationMs: number;
  detail: {
    size: string;
    format: string;
    frames: number;
    bytes: number;
    mixMs: number;
    framesMs: number;
    readMs: number;
    audioMs: number;
    videoMs: number;
    finishMs: number;
    checkMs: number;
    check: { ok: boolean; durationSec: number | null };
  };
}

function overlayRow(page: Page, label: string) {
  return page
    .getByRole("complementary", { name: "Performance" })
    .locator("div", { hasText: new RegExp(`^${label}`) })
    .locator("span")
    .last();
}

/** One export, or why this browser can't make one at this size. */
async function exportOnce(browser: BenchBrowser, size: "1080p" | "720p", run: number) {
  const context = await browser.newContext();
  const page = context.pages()[0] ?? (await context.newPage());
  const origins = new Set<string>();
  page.on("request", (request) => {
    const { origin, pathname } = new URL(request.url());
    if (pathname.endsWith(".mp4")) origins.add(origin);
  });
  await page.goto(APP);
  await page.getByRole("button", { name: "Load the robot story" }).click();
  await page.getByRole("button", { name: /^15-wide on V1, / }).waitFor({ timeout: 60_000 });
  // The filmstrips read the 720p files in the background: the export goes once they're in.
  await page.waitForFunction(
    () => performance.getEntriesByName("feed:thumbnails").length >= 15,
    null,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(1_000);
  // A browser without WebCodecs' VideoEncoder shows "Export unavailable" instead.
  if ((await page.getByRole("button", { name: "Export", exact: true }).count()) === 0) {
    await context.close();
    return { run, size, unavailable: "No Export button: this browser has no VideoEncoder." };
  }
  const heapBefore = await heapMb(page, engine);
  await watchLongFrames(page);

  served = 0;
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: new RegExp(`^${size}`) }).click();
  // The format the browser's encoders allow at this size, once the export worker has asked.
  const format = (
    await dialog
      .getByText(/^(MP4|WebM) · |^None at this size/)
      .first()
      .innerText()
  ).split("\n")[0];
  if (format === undefined || format.startsWith("None")) {
    await context.close();
    return { run, size, unavailable: `No format at ${size}: the browser encodes neither.` };
  }
  await dialog.getByRole("button", { name: /^Export/ }).click();
  await page.waitForFunction(
    () =>
      performance.getEntriesByName("export", "measure").length > 0 ||
      document.querySelector("dialog") === null ||
      document.querySelector("dialog h2")?.textContent === "Export failed",
    null,
    { timeout: 600_000 },
  );
  const measure = await page.evaluate(() => {
    const entry = performance.getEntriesByName("export", "measure")[0] as
      PerformanceMeasure | undefined;
    return entry ? { durationMs: entry.duration, detail: entry.detail as unknown } : null;
  });
  if (!measure) {
    const shown = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400);
    throw new Error(`The export didn't finish: ${shown}`);
  }
  const { durationMs, detail } = measure as ExportMeasure;
  const readBytes = served;
  const longFrames = await takeLongFrames(page);
  // Open frames: polled until the worker reports it let go of everything.
  let open = "";
  for (let poll = 0; poll < 20; poll += 1) {
    open = (await overlayRow(page, "Open VideoFrames").textContent()) ?? "";
    if (open === "0") break;
    await page.waitForTimeout(100);
  }
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await page.waitForTimeout(500);
  const heapAfter = await heapMb(page, engine);
  await context.close();
  const seconds = durationMs / 1000;
  return {
    run,
    size,
    format,
    mediaFrom: [...origins].join(", "),
    seconds: Number(seconds.toFixed(1)),
    realTime: Number((detail.frames / 24 / seconds).toFixed(2)),
    mixMs: Math.round(detail.mixMs),
    framesMs: Math.round(detail.framesMs),
    waitingForFramesMs: Math.round(detail.readMs),
    waitingForEncoderMs: Math.round(detail.videoMs),
    audioMs: Math.round(detail.audioMs),
    finishMs: Math.round(detail.finishMs),
    checkMs: Math.round(detail.checkMs),
    fileMb: Number((detail.bytes / 1e6).toFixed(1)),
    ...(local ? { readMb: Number((readBytes / 1e6).toFixed(1)) } : {}),
    check: detail.check.ok,
    durationSec: detail.check.durationSec,
    openAfter: Number(open),
    heapBeforeMb: heapBefore,
    heapAfterMb: heapAfter,
    longFrames,
  };
}

if (local) await serveFeed();
const browser = await openBrowser(engine, headed);
const results: Awaited<ReturnType<typeof exportOnce>>[] = [];
for (const size of sizes) {
  for (let run = 1; run <= runs; run += 1) {
    const result = await exportOnce(browser, size, run);
    console.error(JSON.stringify(result));
    results.push(result);
  }
}
await browser.close();

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};
console.log(
  JSON.stringify(
    {
      browser: browser.name,
      media: local ? "local" : "network",
      headed,
      bySize: sizes.map((size) => {
        const ofSize = results.filter((result) => result.size === size);
        const made = ofSize.flatMap((result) => ("seconds" in result ? [result] : []));
        return made.length === 0
          ? { size, unavailable: ofSize[0]?.unavailable ?? "Not run." }
          : {
              size,
              format: made[0]?.format,
              medianSeconds: median(made.map((result) => result.seconds)),
              medianRealTime: median(made.map((result) => result.realTime)),
            };
      }),
      runs: results,
    },
    null,
    2,
  ),
);
process.exit(0);
