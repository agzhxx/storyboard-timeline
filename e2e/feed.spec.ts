// The Feed in the editor (spec sections 3.1, 3.6, 4.9 and 4.10): the bin's From the Feed tab and
// its pages, the Feed unreachable, the robot story failing to load, a Feed clip in the inspector,
// and a Feed clip scrubbed and played from its address. The Feed's API and media are routed to
// fixtures (e2e/feed.ts): every clip is story-shot.mp4, whose frames paint their own index.
// Spec test 2 (the story's 15 clips in shot order, music on A1) is in editing.spec.ts.

import type { Page } from "@playwright/test";
import { clip, loadStory, playheadTimecode } from "./editor.ts";
import { routeFeed } from "./feed.ts";
import { frameIndex, timecodeFrame } from "./monitor.ts";
import { expect, test } from "./test.ts";

const FOOTER = "AI-generated, from the Generation Feed";

function bin(page: Page) {
  return page.getByRole("region", { name: "Media bin" });
}

function cards(page: Page) {
  return bin(page).getByRole("button", { name: / Kling 2\.5 Pro$/ });
}

async function openFeedTab(page: Page) {
  await bin(page).getByRole("tab", { name: "From the Feed" }).click();
}

test("the Feed tab lists the story's clips, and Add puts one on the timeline", async ({ page }) => {
  await routeFeed(page);
  await page.goto("/");
  await openFeedTab(page);

  await expect(cards(page)).toHaveCount(15);
  await expect(cards(page).first()).toHaveAccessibleName("01-wide Kling 2.5 Pro");
  await expect(bin(page).getByText("15 clips", { exact: true })).toBeVisible();
  await expect(bin(page).getByText(`All 15 clips loaded · ${FOOTER}`)).toBeVisible();

  // The first video sets the empty project's rate: the clip's own, read from its file.
  await bin(page).getByRole("button", { name: "05-wide Kling 2.5 Pro" }).click();
  await expect(clip(page, "05-wide")).toHaveAccessibleName(
    "05-wide on V1, starts 00:00:00:00, 00:00:05:00 long",
  );
  await expect(page.getByText("1920 × 1080 · 24 fps", { exact: true })).toBeVisible();
});

test("more pages load as the list reaches its end", async ({ page }) => {
  await routeFeed(page, { others: { worlds: 30 } });
  await page.goto("/");
  await openFeedTab(page);
  await expect(cards(page)).toHaveCount(15);

  await bin(page).getByRole("combobox", { name: "Collection" }).selectOption("worlds");
  const worlds = bin(page).getByRole("listitem");
  await expect(worlds).toHaveCount(24);
  await expect(bin(page).getByText(`24 of 30 clips loaded · ${FOOTER}`)).toBeVisible();

  // The end of the list comes into view: the next page loads by itself.
  await worlds.last().scrollIntoViewIfNeeded();
  await expect(worlds).toHaveCount(30);
  await expect(bin(page).getByText(`All 30 clips loaded · ${FOOTER}`)).toBeVisible();
});

test("an unreachable Feed says so with Retry; the rest of the editor keeps working", async ({
  page,
}) => {
  const routes = await routeFeed(page);
  routes.apiUp = false;
  await page.goto("/");
  await openFeedTab(page);

  const unreachable = bin(page).getByRole("alert");
  await expect(unreachable.getByRole("heading", { name: "Can’t reach the Feed" })).toBeVisible();
  await expect(
    unreachable.getByText(
      "Its clips can’t load right now. Your own files and the timeline keep working.",
    ),
  ).toBeVisible();
  await bin(page).getByRole("tab", { name: "My files" }).click();
  await expect(bin(page).getByRole("button", { name: "Choose files" })).toBeVisible();
  // Back on the tab, it asks again, and says so again.
  await openFeedTab(page);
  await expect(bin(page).getByRole("alert")).toBeVisible();
  expect(routes.requests).toHaveLength(2);

  routes.apiUp = true;
  await bin(page).getByRole("button", { name: "Retry" }).click();
  await expect(cards(page)).toHaveCount(15);
});

test("a robot story that doesn't load says so, as the board draws it, and Retry loads it", async ({
  page,
}) => {
  const routes = await routeFeed(page);
  routes.apiUp = false;
  await page.goto("/");
  await page.getByRole("button", { name: "Load the robot story" }).click();

  const toast = page.getByRole("alert");
  await expect(toast.getByText("Couldn't load the robot story")).toBeVisible();
  await expect(
    toast.getByText("The Feed didn't answer. Check your connection and try again."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start a cut" })).toBeVisible();

  routes.apiUp = true;
  await toast.getByRole("button", { name: "Retry" }).click();
  await expect(clip(page, "15-wide")).toBeAttached({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: / on V1, / })).toHaveCount(15);
});

test("a Feed clip in the inspector: From the Feed and its model, with the AI badge", async ({
  page,
}) => {
  await loadStory(page);
  await clip(page, "07-medium").click();
  const inspector = page.getByRole("region", { name: "Inspector" });
  await expect(inspector.getByRole("heading", { name: "07-medium" })).toBeVisible();
  await expect(inspector.getByText("From the Feed · Kling 2.5 Pro")).toBeVisible();
  await expect(inspector.getByText("AI", { exact: true })).toBeVisible();
  await expect(inspector.getByText("1920 × 1080 · 24 fps · 5 s")).toBeVisible();
});

test("a Feed clip scrubs to the exact frame and plays, read from its address", async ({ page }) => {
  await loadStory(page);
  // 01-wide's first frame, decoded from the clip's address.
  await expect.poll(() => frameIndex(page)).toBe(0);

  // Scrub the ruler (28 px above V2) to frame 62, then to frame 100: 02-medium's frame 28.
  const lanes = await page.locator('[data-track-id="V2"]').boundingBox();
  if (!lanes) throw new Error("No tracks");
  const y = lanes.y - 14;
  await page.mouse.move(lanes.x + 1, y);
  await page.mouse.down();
  for (let frame = 2; frame <= 62; frame += 6) await page.mouse.move(lanes.x + frame * 2 + 1, y);
  await expect.poll(() => frameIndex(page)).toBe(62);
  await page.mouse.move(lanes.x + 100 * 2 + 1, y);
  await page.mouse.up();
  await expect(playheadTimecode(page)).toHaveText("00:00:04:04");
  await expect.poll(() => frameIndex(page)).toBe(28);

  // Play, then pause: the picture is the frame the timecode shows, in its clip.
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect.poll(() => timecodeFrame(page)).toBeGreaterThan(120);
  await page.keyboard.press("k");
  const paused = await timecodeFrame(page);
  await expect.poll(() => frameIndex(page)).toBe(paused % 72);
});
