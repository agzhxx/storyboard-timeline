// Accessibility (spec section 2: "Full edit flow by keyboard; trim handles follow the W3C slider
// pattern; axe: 0 serious issues"). Spec test 12: axe finds no serious or critical issue on the
// empty project, the story, the open dialogs, the export dialog and the phone view. And a whole
// edit with the keyboard alone, no mouse: select, trim with the sliders, split, nudge, delete,
// undo.

// The functions passed to page.addInitScript run in the page, with the DOM.
/// <reference lib="dom" />

import { AxeBuilder } from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { clip, loadStory, playheadTimecode } from "./editor.ts";
import { routeFeed } from "./feed.ts";
import { expect, test } from "./test.ts";

/** Axe's serious and critical issues on the page, WCAG 2.0 to 2.2, A and AA: each rule and where. */
async function seriousIssues(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations
    .filter(({ impact }) => impact === "serious" || impact === "critical")
    .map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

test.describe("spec test 12: axe finds no serious or critical issues", () => {
  test("the empty project", async ({ page }) => {
    await routeFeed(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Start a cut" })).toBeVisible();
    expect(await seriousIssues(page)).toEqual([]);
  });

  test("the robot story, a clip selected with its handles as sliders", async ({ page }) => {
    await loadStory(page);
    await clip(page, "07-medium").click();
    await expect(page.getByRole("slider", { name: "Start of 07-medium" })).toBeAttached();
    expect(await seriousIssues(page)).toEqual([]);
  });

  test("the keyboard shortcuts and the New project confirmation", async ({ page }) => {
    await loadStory(page);
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    expect(await seriousIssues(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("alertdialog", { name: "Start a new project?" })).toBeVisible();
    expect(await seriousIssues(page)).toEqual([]);
  });

  test("the export dialog", async ({ page }) => {
    // CI's Linux WebKit may have no video encoder: the toolbar asks only whether one exists.
    await page.addInitScript(() => {
      if (!("VideoEncoder" in window))
        Reflect.set(window, "VideoEncoder", function VideoEncoder() {});
    });
    await loadStory(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Export" })).toBeVisible();
    expect(await seriousIssues(page)).toEqual([]);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the phone view, before and after the story", async ({ page }) => {
      await routeFeed(page);
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Play the robot story" })).toBeVisible();
      expect(await seriousIssues(page)).toEqual([]);
      await page.getByRole("button", { name: "Play the robot story" }).click();
      await expect(page.getByText("01-wide · clip 1 of 15")).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Pause" }).click();
      expect(await seriousIssues(page)).toEqual([]);
    });
  });
});

/**
 * Presses `key` until `target` has focus, as a keyboard user would; fails if it never does. Safari
 * moves Tab only to fields and to elements with a tabindex (the clips and their handles have one),
 * unless "Press Tab to highlight each item" is on; Option+Tab moves to every control.
 */
async function tabTo(page: Page, target: Locator, key: string, most = 120): Promise<void> {
  for (let presses = 0; presses < most; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`${key} never reached it`);
}

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("a whole edit with the keyboard alone: select, trim, split, nudge, delete, undo", async ({
  page,
  browserName,
}) => {
  const next = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await routeFeed(page);
  await page.goto("/");
  await tabTo(page, page.getByRole("button", { name: "Load the robot story" }), next);
  await page.keyboard.press("Enter");
  await expect(clip(page, "15-wide")).toBeAttached({ timeout: 20_000 });
  // In WebKit the media workers take turns (e2e/feed.ts): the filmstrips are in before going on.
  if (browserName === "webkit") {
    test.info().setTimeout(test.info().timeout + 30_000);
    await page.waitForFunction(
      () => performance.getEntriesByName("feed:thumbnails").length >= 15,
      null,
      { timeout: 30_000 },
    );
  }

  // 07-medium: 00:00:18:00 to 00:00:21:00 on V1. Enter selects it, Tab goes to its handles.
  const seventh = clip(page, "07-medium");
  await tabTo(page, seventh, next);
  await page.keyboard.press("Enter");
  await expect(seventh).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  const start = page.getByRole("slider", { name: "Start of 07-medium" });
  await expect(start).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(start).toHaveAttribute("aria-valuetext", "00:00:18:02");
  await page.keyboard.press("Tab");
  const end = page.getByRole("slider", { name: "End of 07-medium" });
  await expect(end).toBeFocused();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(end).toHaveAttribute("aria-valuetext", "00:00:20:00");
  await expect(seventh).toHaveAccessibleName(
    "07-medium on V1, starts 00:00:18:02, 00:00:01:22 long",
  );

  // Esc: the handles stop being sliders, and the focus goes back to their clip.
  await page.keyboard.press("Escape");
  await expect(seventh).toBeFocused();
  await expect(seventh).toHaveAttribute("aria-pressed", "false");
  // Selected again, the arrows move the playhead: into the clip, then S splits it there.
  await page.keyboard.press("Enter");
  for (let second = 0; second < 19; second += 1) await page.keyboard.press("Shift+ArrowRight");
  await expect(playheadTimecode(page)).toHaveText("00:00:19:00");
  await page.keyboard.press("s");
  const halves = clip(page, "07-medium");
  await expect(halves).toHaveCount(2);
  // Focus followed the selection to the right half, 00:00:19:00 to 00:00:20:00.
  const right = halves.nth(1);
  await expect(right).toBeFocused();
  await expect(right).toHaveAttribute("aria-pressed", "true");

  // ⌥→ nudges the right half into the second the end trim freed; it stops at 08-closeup.
  await page.keyboard.press("Alt+ArrowRight");
  await expect(right).toHaveAccessibleName("07-medium on V1, starts 00:00:19:01, 00:00:01:00 long");
  for (let press = 0; press < 30; press += 1) await page.keyboard.press("Alt+ArrowRight");
  await expect(right).toHaveAccessibleName("07-medium on V1, starts 00:00:20:00, 00:00:01:00 long");

  // Delete takes it away, and focus goes to the clip after it; undo brings it back.
  await page.keyboard.press("Delete");
  await expect(halves).toHaveCount(1);
  await expect(clip(page, "08-closeup")).toBeFocused();
  await page.keyboard.press(`${modifier}+z`);
  await expect(halves).toHaveCount(2);
  // One undo step for the run of nudges: the right half is back where the split left it.
  await page.keyboard.press(`${modifier}+z`);
  await expect(halves.nth(1)).toHaveAccessibleName(
    "07-medium on V1, starts 00:00:19:00, 00:00:01:00 long",
  );
});
