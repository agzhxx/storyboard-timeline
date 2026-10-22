// Records the short demo clips the README shows (docs/media/): four silent screen recordings of
// the production build in Google Chrome at 1440 × 900, each played by a script at a person's pace,
// on the robot story loaded from the Feed: a scrub (the Preview, then the exact frame), a clip
// snapping to the edges of another, a split with its undo and redo, and an export to "Your film is
// ready". A recording has no pointer, so the page gets a drawn one, and each key pressed shows at
// the bottom. The frames come from the DevTools protocol's screencast; ffmpeg makes an MP4 of each
// for posts, and libwebp's img2webp a smaller animated WebP for the README.
//
// Run `pnpm build` and `pnpm preview` (the Feed's bucket lets the clips be read from port 4173),
// then `node scripts/record-clips.ts [folder]` (default: demo-clips/, which git ignores). Needs
// ffmpeg and img2webp (`brew install ffmpeg webp`).

// The functions passed to page.evaluate and addInitScript run in the page, with the DOM.
/// <reference lib="dom" />

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const APP = process.env.BENCH_ORIGIN ?? "http://localhost:4173";
const OUT = process.argv[2] ?? join(import.meta.dirname, "..", "demo-clips");
/** The README's copies: smaller, and fewer frames a second. */
const WEBP_WIDTH = 960;
const WEBP_FPS = 12;

/** Runs in the page: a drawn pointer that follows the mouse, and each key pressed, at the bottom. */
function decorate(): void {
  addEventListener("DOMContentLoaded", () => {
    const pointer = document.createElement("div");
    pointer.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6.5 1.5L9.5 19z" ' +
      'fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    pointer.style.cssText =
      "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;" +
      "transform:translate(-50px,-50px)";
    const keys = document.createElement("div");
    keys.style.cssText =
      "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;" +
      "pointer-events:none;padding:6px 14px;border-radius:8px;background:rgb(0 0 0/0.8);" +
      "color:white;font:600 18px/1.4 system-ui;opacity:0;transition:opacity 150ms";
    document.body.append(pointer, keys);
    addEventListener(
      "pointermove",
      (event) => {
        pointer.style.transform = `translate(${String(event.clientX - 5)}px, ${String(event.clientY - 3)}px)`;
      },
      { capture: true, passive: true },
    );
    let hide = 0;
    addEventListener(
      "keydown",
      (event) => {
        if (["Shift", "Meta", "Control", "Alt"].includes(event.key)) return;
        const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        keys.textContent = `${event.shiftKey ? "⇧" : ""}${event.metaKey ? "⌘" : ""}${key}`;
        keys.style.opacity = "1";
        clearTimeout(hide);
        hide = window.setTimeout(() => {
          keys.style.opacity = "0";
        }, 900);
      },
      { capture: true },
    );
  });
}

/** Records what `play` does, then makes `<name>.mp4` and `<name>.webp` from the frames. */
async function record(page: Page, name: string, play: () => Promise<void>): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const frames: { data: string; at: number }[] = [];
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push({ data: frame.data, at: frame.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92 });
  await page.waitForTimeout(500);
  await play();
  await page.waitForTimeout(1_000);
  await cdp.send("Page.stopScreencast");
  const ended = Date.now() / 1000;
  await cdp.detach();

  // The screencast sends a frame when the page changes: each lasts until the next.
  const folder = join(OUT, `${name}-frames`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const list = frames.flatMap((frame, index) => {
    const file = join(folder, `${String(index).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(frame.data, "base64"));
    const next = frames[index + 1]?.at ?? ended;
    return [`file '${file}'`, `duration ${Math.max(0.001, next - frame.at).toFixed(4)}`];
  });
  const last = frames.length - 1;
  list.push(`file '${join(folder, `${String(last).padStart(5, "0")}.jpg`)}'`);
  writeFileSync(join(folder, "frames.txt"), `${list.join("\n")}\n`);

  const quiet = ["-y", "-hide_banner", "-loglevel", "error"];
  const mp4 = join(OUT, `${name}.mp4`);
  execFileSync("ffmpeg", [
    ...quiet,
    ...["-f", "concat", "-safe", "0", "-i", join(folder, "frames.txt")],
    ...["-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "slow"],
    ...["-movflags", "+faststart", mp4],
  ]);
  const stills = join(folder, "webp");
  mkdirSync(stills);
  execFileSync("ffmpeg", [
    ...quiet,
    ...["-i", mp4, "-vf", `fps=${String(WEBP_FPS)},scale=${String(WEBP_WIDTH)}:-2:flags=lanczos`],
    join(stills, "%04d.png"),
  ]);
  const pngs = readdirSync(stills)
    .filter((file) => file.endsWith(".png"))
    .sort()
    .map((file) => join(stills, file));
  const webp = join(OUT, `${name}.webp`);
  const delay = String(Math.round(1000 / WEBP_FPS));
  execFileSync("img2webp", [
    "-loop",
    "0",
    "-lossy",
    "-q",
    "60",
    "-m",
    "6",
    "-d",
    delay,
    ...pngs,
    "-o",
    webp,
  ]);
  rmSync(folder, { recursive: true, force: true });
  const mb = (file: string) => (statSync(file).size / 1e6).toFixed(1);
  console.log(`${name}: ${String(frames.length)} frames, ${mb(mp4)} MB MP4, ${mb(webp)} MB WebP`);
}

/** A clip's box on the tracks, by its name. */
async function clipBox(page: Page, name: string) {
  const box = await page
    .getByRole("button", { name: new RegExp(`^${name} on V1, `) })
    .boundingBox();
  if (!box) throw new Error(`${name} isn't on screen`);
  return box;
}

/** The ruler's y: 14 px above the tracks' top. */
async function rulerY(page: Page): Promise<number> {
  const v2 = await page.locator('[data-track-id="V2"]').boundingBox();
  if (!v2) throw new Error("No tracks");
  return v2.y - 14;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", args: ["--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(decorate);
await page.goto(APP);
await page.getByRole("button", { name: "Load the robot story" }).click();
await page.getByRole("button", { name: /^15-wide on V1, / }).waitFor({ timeout: 60_000 });
await page.waitForFunction(
  () => performance.getEntriesByName("feed:thumbnails").length >= 15,
  null,
  { timeout: 180_000 },
);
await page.mouse.move(700, 600);
await page.keyboard.press("Shift+Z");
await page.waitForTimeout(1_000);

// 1. The scrub: the ruler dragged across the cut shows each clip's thumbnail at once, marked
// Preview; when the pointer rests, the exact frame.
const ruler = await rulerY(page);
const first = await clipBox(page, "01-wide");
const last = await clipBox(page, "15-wide");
const across = (share: number) => first.x + (last.x + last.width - first.x) * share;
await record(page, "scrub", async () => {
  await page.mouse.move(across(0.05), ruler, { steps: 20 });
  await page.mouse.down();
  await page.mouse.move(across(0.45), ruler, { steps: 150 });
  await page.waitForTimeout(1_500);
  await page.mouse.move(across(0.72), ruler, { steps: 90 });
  await page.waitForTimeout(1_500);
  await page.mouse.move(across(0.6), ruler, { steps: 40 });
  await page.waitForTimeout(1_500);
  await page.mouse.up();
});

// 2. Snapping: 08-closeup dragged up to V2 and along it, until its edges snap to 09-cutaway's below
// (the white line across the tracks), then back with ⌘Z: the whole drag is one undo step.
await page.mouse.move(across(0.5), 700);
for (let notch = 0; notch < 4; notch += 1) {
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await page.waitForTimeout(150);
}
await page.waitForTimeout(800);
const medium = await clipBox(page, "07-medium");
await page.mouse.click(medium.x + medium.width * 0.2, ruler);
const closeup = await clipBox(page, "08-closeup");
const cutaway = await clipBox(page, "09-cutaway");
const v2 = await page.locator('[data-track-id="V2"]').boundingBox();
if (!v2) throw new Error("No V2");
await record(page, "snap", async () => {
  const grab = { x: closeup.x + closeup.width * 0.4, y: closeup.y + closeup.height / 2 };
  await page.mouse.move(grab.x, grab.y, { steps: 25 });
  await page.waitForTimeout(500);
  await page.mouse.down();
  await page.mouse.move(grab.x + 20, v2.y + v2.height / 2, { steps: 30 });
  // Along V2, slowly past the spot where its start meets 09-cutaway's, then onto it.
  const onto = grab.x + (cutaway.x - closeup.x);
  await page.mouse.move(onto - 40, v2.y + v2.height / 2, { steps: 60 });
  await page.mouse.move(onto + 2, v2.y + v2.height / 2, { steps: 30 });
  await page.waitForTimeout(1_500);
  await page.mouse.up();
  await page.waitForTimeout(1_800);
  await page.keyboard.press("Meta+Z");
  await page.waitForTimeout(1_800);
});

// 3. A split and its undo: the playhead in 09-cutaway, the clip selected, S, then ⌘Z and ⇧⌘Z.
const shot = await clipBox(page, "09-cutaway");
await record(page, "split", async () => {
  const middle = shot.x + shot.width / 2;
  await page.mouse.move(middle, ruler, { steps: 25 });
  await page.mouse.click(middle, ruler);
  await page.waitForTimeout(600);
  await page.mouse.move(shot.x + shot.width * 0.3, shot.y + shot.height / 2, { steps: 20 });
  await page.mouse.click(shot.x + shot.width * 0.3, shot.y + shot.height / 2);
  await page.waitForTimeout(1_000);
  await page.keyboard.press("S");
  await page.waitForTimeout(2_000);
  await page.keyboard.press("Meta+Z");
  await page.waitForTimeout(1_800);
  await page.keyboard.press("Shift+Meta+Z");
  await page.waitForTimeout(2_000);
});

// 4. An export: 720p, from the press to "Your film is ready" with its check.
await page.keyboard.press("Escape");
await record(page, "export", async () => {
  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  const box = await exportButton.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 });
  await exportButton.click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByText(/^(MP4|WebM) · /)
    .first()
    .waitFor();
  await page.waitForTimeout(900);
  await dialog.getByRole("button", { name: /^720p/ }).click();
  await page.waitForTimeout(900);
  await dialog.getByRole("button", { name: /^Export/ }).click();
  await dialog.getByRole("heading", { name: "Your film is ready" }).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2_500);
});
await browser.close();
