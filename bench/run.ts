// `pnpm bench` (spec section 5): every bench in one command. It builds the app once, serves the
// production build, runs the editing, import, playback and export benches one after another, each
// alone in its own browser, and adds a dated summary table, with this machine and the browser's
// version, at the end of docs/PERF.md. The full results are printed as they come. Each bench keeps
// its own command (`pnpm bench:editing` and the rest) for a closer look.
//
// The build is served on port 4173, or 5173 if that one is taken: the Feed's bucket lets only those
// two local addresses (and production) read its clips in ranges. Before
// measuring, it checks that the page served there is this checkout's build: a preview another
// checkout left running would answer on the same address with its own.
//
// Options, in any order: `webkit` or `firefox` runs every bench in Playwright's WebKit or Firefox
// engine (bench/browser.ts), for the browser matrix; bench names (`editing`, `import`, `playback`
// for the cut of 1080p files, `story` for the robot story from the Feed, `export`) run only those.
// About 15 minutes for all of them. Run it with nothing heavy alongside: a busy machine reads as a
// slow app.

import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { type PreviewServer, preview } from "vite";
import { engineFrom, ENGINE_NAMES } from "./browser.ts";

const ROOT = join(import.meta.dirname, "..");
const PERF = join(ROOT, "docs", "PERF.md");
/** The local addresses the Feed's bucket lets read its clips, in the order tried. */
const PORTS = [4173, 5173];

const BENCHES = {
  editing: { file: "editing.ts", args: [] },
  import: { file: "import.ts", args: [] },
  playback: { file: "playback.ts", args: [] },
  story: { file: "playback.ts", args: ["story"] },
  export: { file: "export.ts", args: [] },
} as const;
type BenchName = keyof typeof BENCHES;

const options = process.argv.slice(2);
const engine = engineFrom(options);
const named = (Object.keys(BENCHES) as BenchName[]).filter((name) => options.includes(name));
const chosen = named.length > 0 ? named : (Object.keys(BENCHES) as BenchName[]);

// What each bench prints (only the parts the summary reads) ------------------------------------

interface Latency {
  p50Ms: number;
  p95Ms: number;
}

interface EditingResult {
  browser: string;
  runs: { name: string; fps: number; p95FrameMs: number; longFrames: number | null }[];
  interactions: { ms: number }[] | null;
  saves: { ms: number }[];
}

interface ImportResult {
  browser: string;
  first: { readyMs: number };
  warmMedian: { readyMs: number };
  longFrames: number | null;
}

interface PlaybackResult {
  browser: string;
  story?: { loadMs: number; cutFilmstripsMs: number | null; filmstripsMs: number };
  scrub: { whileDragging: Latency; exactAfterRest: Latency };
  playThroughs: {
    expected: number;
    late: number;
    openWhenPaused: number;
    heapMb: number | null;
    longFrames: number[] | null;
  }[];
}

type ExportSize =
  | { size: string; unavailable: string }
  | { size: string; format: string; medianSeconds: number; medianRealTime: number };

interface ExportResult {
  browser: string;
  bySize: ExportSize[];
  runs: (
    { unavailable: string } | { check: boolean; openAfter: number; longFrames: number[] | null }
  )[];
}

// Running ------------------------------------------------------------------------------------

/** Runs one bench against the served build; its JSON, or why it didn't finish. */
function runBench(
  name: BenchName,
  origin: string,
): Promise<{ result: unknown } | { error: string }> {
  const { file, args } = BENCHES[name];
  const extra = engine === "chrome" ? [] : [engine];
  console.error(`\n▶ ${name}: node bench/${file} ${[...args, ...extra].join(" ")}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, "bench", file), ...args, ...extra], {
      cwd: ROOT,
      env: { ...process.env, BENCH_ORIGIN: origin },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", (code) => {
      console.error(output);
      try {
        if (code !== 0) throw new Error(`it exited with code ${String(code)}`);
        resolve({ result: JSON.parse(output) as unknown });
      } catch (error) {
        resolve({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  });
}

/** Serves dist/ on the first free port the bucket allows, and checks it's this build answering. */
async function serve(): Promise<{ server: PreviewServer; origin: string }> {
  for (const port of PORTS) {
    let server: PreviewServer;
    try {
      server = await preview({
        root: ROOT,
        logLevel: "warn",
        preview: { port, strictPort: true, open: false },
      });
    } catch {
      continue;
    }
    const origin = `http://localhost:${String(port)}`;
    const served = await (await fetch(`${origin}/`)).text();
    if (served === readFileSync(join(ROOT, "dist", "index.html"), "utf8"))
      return { server, origin };
    await server.close();
    throw new Error(`${origin} serves another build: stop the server holding it and run again.`);
  }
  throw new Error(`Ports ${PORTS.join(" and ")} are both taken: free one and run again.`);
}

// The summary --------------------------------------------------------------------------------

/** Gzipped with Node's default level, as docs/PERF.md has measured since M0. */
function gzipBytes(file: string): number {
  return gzipSync(readFileSync(join(ROOT, "dist", file.replace(/^\//, "")))).length;
}

/** The JS and CSS the page loads at the start, from dist/index.html: bytes after gzip. */
function firstLoad(): { js: number; css: number } {
  const html = readFileSync(join(ROOT, "dist", "index.html"), "utf8");
  const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(
    (match) => match[1] ?? "",
  );
  const total = (extension: string) =>
    files
      .filter((file) => file.endsWith(extension))
      .reduce((sum, file) => sum + gzipBytes(file), 0);
  return { js: total(".js"), css: total(".css") };
}

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB (${bytes.toLocaleString("en")} B)`;
const ms = (value: number) => `${String(Math.round(value))} ms`;
const seconds = (value: number) => `${(value / 1000).toFixed(1)} s`;
const latency = ({ p95Ms, p50Ms }: Latency) => `${ms(p95Ms)} (${String(p50Ms)})`;
/** A range of values, "5.0–5.1", or one value. */
const range = (values: number[], unit: string) => {
  const low = Math.min(...values).toFixed(1);
  const high = Math.max(...values).toFixed(1);
  return low === high ? `${low} ${unit}` : `${low}–${high} ${unit}`;
};
/** Long animation frames: a count, or a dash where the browser doesn't report them. */
const longFrames = (counts: (number | null)[]) =>
  counts.includes(null) ? "not reported" : String(counts.reduce<number>((a, b) => a + (b ?? 0), 0));

type Row = [measure: string, goal: string, result: string, bench: string];

function editingRows(result: EditingResult): Row[] {
  const rows: Row[] = result.runs.map((run) => [
    `${run.name}: FPS, p95 frame, long animation frames`,
    "60 FPS",
    `${String(run.fps)}, ${run.p95FrameMs.toFixed(1)} ms, ${longFrames([run.longFrames])}`,
    "`bench:editing`",
  ]);
  const slowest = result.interactions && Math.max(...result.interactions.map((each) => each.ms));
  rows.push([
    "Slowest interaction while editing the story, its load's press included",
    "≤ 100 ms",
    slowest === null ? "not measurable here" : ms(slowest),
    "`bench:editing`",
  ]);
  if (result.saves.length > 0) {
    rows.push([
      "Autosave's work on the main thread, per save",
      "",
      `at most ${Math.max(...result.saves.map((save) => save.ms)).toFixed(1)} ms (${String(result.saves.length)} saves)`,
      "`bench:editing`",
    ]);
  }
  return rows;
}

function importRows(result: ImportResult): Row[] {
  return [
    [
      "Importing a 1080p 5 s clip, pick to ready: the first, then the median of five more",
      "",
      `${ms(result.first.readyMs)}, then ${ms(result.warmMedian.readyMs)}; long animation frames: ${longFrames([result.longFrames])}`,
      "`bench:import`",
    ],
  ];
}

function playbackRows(result: PlaybackResult, what: string, bench: string): Row[] {
  const plays = result.playThroughs;
  const worst = plays.reduce(
    (most, play) => (play.late > most.late ? play : most),
    plays[0] ?? { late: 0, expected: 0 },
  );
  const heaps = plays.flatMap((play) => (play.heapMb === null ? [] : [play.heapMb]));
  const rows: Row[] = [];
  if (result.story) {
    rows.push(
      [
        "Robot story: press to its 15 clips on the timeline",
        "",
        seconds(result.story.loadMs),
        bench,
      ],
      [
        "Robot story, first visit: the cut's filmstrips in (each clip's first 3 s)",
        "",
        result.story.cutFilmstripsMs === null ? "not timed" : seconds(result.story.cutFilmstripsMs),
        bench,
      ],
      [
        "Robot story, first visit: all 15 filmstrips in",
        "",
        seconds(result.story.filmstripsMs),
        bench,
      ],
    );
  }
  rows.push(
    [
      `A picture while dragging the ruler, p95 (p50): ${what}`,
      "≤ 50 ms",
      latency(result.scrub.whileDragging),
      bench,
    ],
    [
      `The exact frame after the pointer rests, p95 (p50): ${what}`,
      "≤ 200 ms",
      latency(result.scrub.exactAfterRest),
      bench,
    ],
    [
      `Late or dropped frames, worst of ${String(plays.length)} play-throughs: ${what}`,
      "≤ 1 %",
      `${String(worst.late)} of ${worst.expected.toLocaleString("en")}`,
      bench,
    ],
    [
      `Open VideoFrames once paused, after each play-through: ${what}`,
      "0",
      String(Math.max(...plays.map((play) => play.openWhenPaused))),
      bench,
    ],
    [
      `JS heap after each play-through: ${what}`,
      "no growth",
      heaps.length === 0 ? "not measurable here" : range(heaps, "MB"),
      bench,
    ],
    [
      `Long animation frames while playing: ${what}`,
      "",
      longFrames(plays.map((play) => (play.longFrames === null ? null : play.longFrames.length))),
      bench,
    ],
  );
  return rows;
}

function exportRows(result: ExportResult): Row[] {
  const rows: Row[] = result.bySize.map((size) => [
    `Export of the 45 s robot story at ${size.size}, from the live Feed, median of 3`,
    size.size === "1080p" ? "≥ 1× real time" : "",
    "unavailable" in size
      ? size.unavailable
      : `${size.medianSeconds.toFixed(1)} s, ${size.medianRealTime.toFixed(1)}× real time (${size.format})`,
    "`bench:export`",
  ]);
  const made = result.runs.flatMap((run) => ("check" in run ? [run] : []));
  if (made.length > 0) {
    rows.push([
      "Exports: output check passed, open VideoFrames after, long animation frames",
      "",
      `${String(made.filter((run) => run.check).length)} of ${String(made.length)}, ${String(Math.max(...made.map((run) => run.openAfter)))}, ${longFrames(made.map((run) => (run.longFrames === null ? null : run.longFrames.length)))}`,
      "`bench:export`",
    ]);
  }
  return rows;
}

function rowsOf(name: BenchName, result: unknown): Row[] {
  switch (name) {
    case "editing":
      return editingRows(result as EditingResult);
    case "import":
      return importRows(result as ImportResult);
    case "playback":
      return playbackRows(
        result as PlaybackResult,
        "the two-track 1080p cut of files",
        "`bench:playback`",
      );
    case "story":
      return playbackRows(result as PlaybackResult, "the robot story", "`bench:playback story`");
    case "export":
      return exportRows(result as ExportResult);
  }
}

function machine(): string {
  const os =
    platform() === "darwin"
      ? `macOS ${execFileSync("sw_vers", ["-productVersion"]).toString().trim()}`
      : `${platform()} ${release()}`;
  const memory = Math.round(totalmem() / 1024 ** 3);
  return `${cpus()[0]?.model ?? "Unknown CPU"}, ${String(memory)} GB, ${os}, Node ${process.version}`;
}

/** A paragraph wrapped at 100 columns, as the docs are. */
function wrap(text: string): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > 100) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  return [...lines, line].join("\n");
}

function commit(): string {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT }).toString().trim();
  const changed = git("status", "--porcelain") !== "";
  return `${git("rev-parse", "--short", "HEAD")}${changed ? " with uncommitted changes" : ""}`;
}

/** Adds this run's table at the end of docs/PERF.md, under its `pnpm bench` section. */
function writeSummary(browser: string, origin: string, rows: Row[], failures: string[]): void {
  const now = new Date();
  const stamp = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`;
  const table = [
    "| Measure | Goal (spec section 2) | Result | Bench |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  const section = [
    `### ${stamp} · ${browser}`,
    "",
    wrap(
      `${machine()}. The production build of ${commit()}, served at ${origin}; the Feed and ` +
        `its bucket live. Headless, the CPU at full speed.`,
    ),
    "",
    ...table,
    ...(failures.length > 0 ? ["", ...failures.map((failure) => `- ${failure}`)] : []),
    "",
  ].join("\n");
  const heading = "## `pnpm bench` runs";
  let perf = readFileSync(PERF, "utf8").trimEnd();
  if (!perf.includes(heading)) {
    perf += `\n\n${heading}\n\nEach \`pnpm bench\` adds its table here, newest last (\`bench/run.ts\`).`;
  }
  writeFileSync(PERF, `${perf}\n\n${section}`);
  console.error(`\n${section}\nAdded to docs/PERF.md.`);
}

// The run ------------------------------------------------------------------------------------

console.error("Building…");
execFileSync("pnpm", ["build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const bundle = firstLoad();
const { server, origin } = await serve();
console.error(`Serving the build at ${origin}, benching in ${ENGINE_NAMES[engine]}.`);

const rows: Row[] = [
  ["First-load JS, gzip", "≤ 120 KB", kb(bundle.js), "the build"],
  ["First-load CSS, gzip", "", kb(bundle.css), "the build"],
];
const failures: string[] = [];
let browser: string = ENGINE_NAMES[engine];
for (const name of chosen) {
  const outcome = await runBench(name, origin);
  if ("error" in outcome) {
    failures.push(`\`${name}\` didn't finish: ${outcome.error}.`);
    continue;
  }
  browser = (outcome.result as { browser: string }).browser;
  rows.push(...rowsOf(name, outcome.result));
}
await server.close();
writeSummary(browser, origin, rows, failures);
