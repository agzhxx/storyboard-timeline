// The browser a bench runs in (docs/PERF.md). Google Chrome by default, the spec's bench browser;
// with `webkit` or `firefox` among a bench's options, Playwright's WebKit or Firefox engine, for
// the browser matrix. Those two stand in for Safari and Firefox: the same engines, not the same
// browsers, so their numbers are labeled by engine. Every page is silent: Chrome runs with
// --mute-audio, and in the others each AudioContext plays through a gain of 0. Only Chrome lets a
// bench read the JS heap (through the DevTools protocol) and count long animation frames (a Chrome
// API): elsewhere those numbers are null. A CPU slowdown, which would change every number, is
// Chrome's alone too (the DevTools protocol again): asked of another engine, it stops the run with
// a message.

// The functions passed to page.evaluate run in the page, with the DOM.
/// <reference lib="dom" />

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BrowserContext,
  type CDPSession,
  chromium,
  firefox,
  type Page,
  webkit,
} from "@playwright/test";
import { silenceAudio } from "../e2e/silence.ts";

export type Engine = "chrome" | "webkit" | "firefox";

export const ENGINE_NAMES: Record<Engine, string> = {
  chrome: "Google Chrome",
  webkit: "WebKit engine (Playwright)",
  firefox: "Firefox engine (Playwright)",
};

/** The production build: where `pnpm bench` serves it, else `pnpm preview`'s address. */
export const APP_ORIGIN = process.env.BENCH_ORIGIN ?? "http://localhost:4173";

/** The design canvas's editor boards are 1440 × 900. */
const VIEWPORT = { width: 1440, height: 900 };

/** The engine a bench's options name: `webkit` or `firefox`, else Chrome. */
export function engineFrom(options: readonly string[]): Engine {
  if (options.includes("webkit")) return "webkit";
  if (options.includes("firefox")) return "firefox";
  return "chrome";
}

export interface BenchBrowser {
  engine: Engine;
  /** Its name and version, such as "Google Chrome 155.0.8059.84". */
  name: string;
  /** A new context at 1440 × 900, with its own cache and storage, silent. */
  newContext(): Promise<BrowserContext>;
  /** A page in a new context. */
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export async function openBrowser(engine: Engine, headed = false): Promise<BenchBrowser> {
  if (engine === "webkit") return openWebKit(headed);
  const browser =
    engine === "chrome"
      ? await chromium.launch({ channel: "chrome", headless: !headed, args: ["--mute-audio"] })
      : await firefox.launch({ headless: !headed });
  const newContext = async () => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    if (engine !== "chrome") await context.addInitScript(silenceAudio);
    return context;
  };
  return {
    engine,
    name: `${ENGINE_NAMES[engine]} ${browser.version()}`,
    newContext,
    newPage: async () => (await newContext()).newPage(),
    close: () => browser.close(),
  };
}

/**
 * Playwright's WebKit gives its default contexts no origin private file system, which imports and
 * saves need; a persistent context has one, as Safari does (e2e/storage.ts). So each context is a
 * persistent one in a new temporary profile, deleted on close. macOS keeps WebKit's storage under
 * the home folder whatever the profile, so the home folder moves into the profile too.
 */
async function openWebKit(headed: boolean): Promise<BenchBrowser> {
  const probe = await webkit.launch();
  const version = probe.version();
  await probe.close();
  const opened: { context: BrowserContext; profile: string }[] = [];
  const newContext = async () => {
    const profile = await mkdtemp(join(tmpdir(), "bench-webkit-"));
    const context = await webkit.launchPersistentContext(profile, {
      headless: !headed,
      viewport: VIEWPORT,
      env: { ...process.env, CFFIXED_USER_HOME: profile },
    });
    await context.addInitScript(silenceAudio);
    opened.push({ context, profile });
    return context;
  };
  return {
    engine: "webkit",
    name: `${ENGINE_NAMES.webkit} ${version}`,
    newContext,
    newPage: async () => {
      const context = await newContext();
      return context.pages()[0] ?? context.newPage();
    },
    close: async () => {
      for (const { context, profile } of opened) {
        await context.close();
        await rm(profile, { recursive: true, force: true });
      }
    },
  };
}

/**
 * One DevTools session per page, never closed, for the slowdown and the heap alike: closing a
 * session can end the page's CPU slowdown (M7's benches used one session too).
 */
const sessions = new WeakMap<Page, Promise<CDPSession>>();

function devTools(page: Page): Promise<CDPSession> {
  let session = sessions.get(page);
  if (!session) {
    session = page.context().newCDPSession(page);
    sessions.set(page, session);
  }
  return session;
}

/** Slows the page's CPU `rate` times, as a slower laptop would run it (Chrome only). */
export async function slowDown(page: Page, engine: Engine, rate: number): Promise<void> {
  if (rate <= 1) return;
  if (engine !== "chrome") throw new Error("Only Chrome can slow the CPU down.");
  await (await devTools(page)).send("Emulation.setCPUThrottlingRate", { rate });
}

/** The JS heap after a garbage collection, in MB (Chrome only; null elsewhere). */
export async function heapMb(page: Page, engine: Engine): Promise<number | null> {
  if (engine !== "chrome") return null;
  const cdp = await devTools(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return Number((usedSize / 1024 / 1024).toFixed(1));
}

/** Starts recording long animation frames (over 50 ms), where the browser reports them. */
export async function watchLongFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (!PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) return;
    const frames: number[] = [];
    Reflect.set(window, "__longFrames", frames);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.duration > 50) frames.push(entry.duration);
    }).observe({ type: "long-animation-frame" });
  });
}

/** The long animation frames since the last call, in ms; null if the browser doesn't report them. */
export async function takeLongFrames(page: Page): Promise<number[] | null> {
  return page.evaluate(() => {
    const frames = Reflect.get(window, "__longFrames") as number[] | undefined;
    return frames ? frames.splice(0, frames.length).map(Math.round) : null;
  });
}
