// Offline (spec section 3.6): the connection goes while the app is open. Local editing goes on and
// is saved, the Feed tab says what still works, a lazily loaded chunk that couldn't load is loaded
// once the connection is back, without a reload, and so is a Feed page that didn't come. There's no
// service worker: a reload offline doesn't load the app. This saves, so it
// uses the `test` from storage.ts, which gives WebKit's pages a file system.

import { clip } from "./editor.ts";
import { inWebKit, routeFeed } from "./feed.ts";
import { newestSave } from "./saves.ts";
import { expect, test } from "./storage.ts";

test("offline, editing goes on and saves, and what didn't load comes once the connection's back", async ({
  page,
  context,
}) => {
  await routeFeed(page, { others: { worlds: 6 } });
  await page.goto("/");
  await page.getByRole("button", { name: "Load the robot story" }).click();
  await expect(clip(page, "15-wide")).toBeAttached({ timeout: 20_000 });
  // In WebKit the media workers take turns (e2e/feed.ts): the filmstrips are in before going on.
  if (inWebKit()) {
    await page.waitForFunction(() => performance.getEntriesByName("feed:thumbnails").length >= 15);
  }
  await expect.poll(() => newestSave(page), { timeout: 10_000 }).not.toBeNull();
  const bin = page.getByRole("region", { name: "Media bin" });

  await context.setOffline(true);
  await expect(
    bin.getByText(/You’re offline\. Clips this browser already cached keep working/),
  ).toBeVisible();
  // A collection never loaded: the note says why, rather than "Can't reach the Feed".
  await bin.getByRole("combobox").selectOption("worlds");
  await expect(bin.getByText("Can’t reach the Feed")).toHaveCount(0);

  // Editing goes on, and is saved.
  await clip(page, "07-medium").click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await newestSave(page))?.clips.V1?.length).toBe(14);

  // The shortcuts' chunk was never loaded, so it can't load now.
  await page.keyboard.press("?");
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    "The keyboard shortcuts couldn't load: check your connection.",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await context.setOffline(false);
  // The page that didn't come loads on its own; the chunk loads when it's asked for again.
  await expect(bin.getByRole("button", { name: / Kling 2\.5 Pro$/ })).toHaveCount(6);
  await expect(bin.getByText(/You’re offline/)).toHaveCount(0);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});
