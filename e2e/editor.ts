// Shared steps for the end-to-end tests: the editor at the design's 1440 × 900, the robot story
// (from the Feed's fixtures, e2e/feed.ts), and drags made of small pointer moves, like a person's.

import { expect, type Locator, type Page, test } from "@playwright/test";
import { inWebKit, routeFeed } from "./feed.ts";

/**
 * Loads the robot story from the Feed's fixtures (at `path`, such as "/?perf=1"), which takes a
 * slow CI runner a few seconds. In
 * WebKit, the test goes on once its 15 filmstrips are in, so its media workers keep taking turns
 * (e2e/feed.ts): the monitor's picture, the filmstrips, then the test's own steps.
 */
export async function loadStory(page: Page, path = "/"): Promise<void> {
  await routeFeed(page);
  await page.goto(path);
  await page.getByRole("button", { name: "Load the robot story" }).click();
  await expect(clip(page, "15-wide")).toBeAttached({ timeout: 20_000 });
  if (!inWebKit()) return;
  test.info().setTimeout(test.info().timeout + 30_000);
  await page.waitForFunction(
    () => performance.getEntriesByName("feed:thumbnails").length >= 15,
    null,
    { timeout: 30_000 },
  );
}

/** A clip on the timeline, by its name; `nth` picks one when a split made two. */
export function clip(page: Page, name: string): Locator {
  return page.getByRole("button", { name: new RegExp(`^${name} on `) });
}

export function playheadTimecode(page: Page): Locator {
  return page.getByRole("timer", { name: "Playhead" });
}

/** Types a timecode into the inspector's playhead field and jumps there. */
export async function jumpTo(page: Page, timecode: string): Promise<void> {
  const field = page.getByRole("textbox", { name: "Playhead" });
  await field.fill(timecode);
  await field.press("Enter");
  await field.blur();
  await expect(playheadTimecode(page)).toHaveText(timecode);
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("The element isn't visible");
  return found;
}

/** Presses `x` px into an element (its middle, vertically) and drags by `dx`, `dy` in steps. */
export async function dragBy(
  page: Page,
  target: Locator,
  { x, dx, dy = 0, steps = 10 }: { x: number; dx: number; dy?: number; steps?: number },
): Promise<void> {
  const { x: left, y: top, height } = await box(target);
  const from = { x: left + x, y: top + height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
}

/** Where an element's right edge is, minus `inset` px: the end handle sits in its last 6 px. */
export async function rightEdge(locator: Locator, inset = 3): Promise<number> {
  const { width } = await box(locator);
  return width - inset;
}
