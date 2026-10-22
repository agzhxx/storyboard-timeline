// Spec test 11: a phone viewport shows the read-only view (spec section 3.6; Phone board), and it
// plays. The saved project plays there; with nothing saved, it offers the robot story. These save,
// so they use the `test` from storage.ts, which gives WebKit's pages a file system.

import type { Page } from "@playwright/test";
import { loadStory } from "./editor.ts";
import { routeFeed } from "./feed.ts";
import { newestSave } from "./saves.ts";
import { expect, test } from "./storage.ts";

const PHONE = { width: 390, height: 844 };

function timecode(page: Page) {
  return page.getByRole("timer", { name: "Playhead" });
}

/** Plays for a moment, and checks the playhead moved; then pauses. */
async function plays(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(timecode(page)).not.toHaveText("00:00:00:00", { timeout: 15_000 });
  await page.getByRole("button", { name: "Pause" }).click();
}

test.describe("spec test 11: a phone shows the read-only view, and it plays", () => {
  test.use({ viewport: PHONE });

  test("with nothing saved, it offers the robot story, which plays", async ({ page }) => {
    await routeFeed(page);
    await page.goto("/");
    await expect(page.getByText("Nothing is saved in this browser yet.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Editing works best on a laptop" }),
    ).toBeVisible();
    // Read-only: no editor behind it.
    await expect(page.getByRole("region", { name: "Timeline" })).toHaveCount(0);

    await page.getByRole("button", { name: "Play the robot story" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible({ timeout: 20_000 });
    await expect(timecode(page)).not.toHaveText("00:00:00:00", { timeout: 15_000 });
    await expect(page.getByText(/^\d\d-[a-z-]+ · clip \d+ of 15$/)).toBeVisible();
    await expect(page.getByText("15 AI clips from the Generation Feed · Demo music")).toBeVisible();
  });

  test("the project saved on a laptop plays on the phone", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loadStory(page);
    await expect.poll(() => newestSave(page), { timeout: 10_000 }).not.toBeNull();

    await page.setViewportSize(PHONE);
    await page.reload();
    await expect(page.getByText("The robot story")).toBeVisible();
    await expect(page.getByText("of 00:00:45:00")).toBeVisible();
    await expect(page.getByText("01-wide · clip 1 of 15")).toBeVisible();
    await plays(page);
  });
});
