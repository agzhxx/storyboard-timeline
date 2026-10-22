// "Open in Timeline" from the Feed (spec section 4.9): `?demo=story` loads the robot story into an
// empty project, and a cut that's saved stays, with New project offered. The second test needs a
// save, so these take the `test` from storage.ts (a persistent profile in WebKit).

import { clip, loadStory } from "./editor.ts";
import { inWebKit, routeFeed } from "./feed.ts";
import { newestSave } from "./saves.ts";
import { expect, test } from "./storage.ts";

test("?demo=story loads the robot story into an empty project, and leaves the address", async ({
  page,
}) => {
  await routeFeed(page);
  await page.goto("/?demo=story");
  await expect(clip(page, "15-wide")).toBeAttached({ timeout: 20_000 });
  expect(new URL(page.url()).search).toBe("");
  // In WebKit the media workers take turns until the filmstrips are in (e2e/feed.ts).
  if (inWebKit()) {
    await page.waitForFunction(
      () => performance.getEntriesByName("feed:thumbnails").length >= 15,
      null,
      { timeout: 30_000 },
    );
  }
});

test("?demo=story keeps a cut that's saved, and offers New project", async ({ page }) => {
  await loadStory(page);
  await expect
    .poll(async () => (await newestSave(page))?.clips.V1?.length, { timeout: 10_000 })
    .toBe(15);
  await page.goto("/?demo=story");
  const toast = page.getByRole("region", { name: "Messages" });
  await expect(
    toast.getByText("Your cut is still here. The robot story opens in a new project."),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  await expect(clip(page, "15-wide")).toBeAttached();
  await toast.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("alertdialog", { name: "Start a new project?" })).toBeVisible();
});
