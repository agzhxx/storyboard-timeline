// Saving (spec section 3.5, e2e test 9): autosave and restore after a reload, a Feed clip's
// thumbnails kept for later sessions, New project, a full storage, and a second tab. Saves and
// imports store files, so these use the `test` from storage.ts, which gives WebKit's pages a file
// system.

// The functions passed to page.evaluate run in the page, with the DOM.
/// <reference lib="dom" />

import type { Page } from "@playwright/test";
import { clip, jumpTo, loadStory, playheadTimecode } from "./editor.ts";
import { inWebKit, routeFeed } from "./feed.ts";
import {
  holdThumbnailFile,
  importFiles,
  keptFeedClips,
  newestSave,
  releaseThumbnailFile,
  storageFolders,
  storageFullOnCue,
} from "./saves.ts";
import { expect, test } from "./storage.ts";

function appBar(page: Page) {
  return page.getByRole("banner");
}

/** Every clip on the timeline, as screen readers name them: name, track, start and length. */
function clipNames(page: Page): Promise<string[]> {
  return page
    .getByRole("button", { name: / on (V1|V2|A1), starts / })
    .evaluateAll((clips) => clips.map((element) => element.getAttribute("aria-label") ?? ""));
}

/** How many pixels of a clip's filmstrip or waveform are drawn. */
function drawnPixels(page: Page, name: string): Promise<number> {
  return page.evaluate((label) => {
    const element = [...document.querySelectorAll('[role="button"]')].find((candidate) =>
      candidate.getAttribute("aria-label")?.startsWith(label),
    );
    let drawn = 0;
    for (const canvas of element?.querySelectorAll("canvas") ?? []) {
      const { data } = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height) ?? {
        data: [],
      };
      for (let index = 3; index < data.length; index += 4 * 13)
        if ((data[index] ?? 0) > 0) drawn += 1;
    }
    return drawn;
  }, `${name} on `);
}

test("spec test 9: a reload keeps the project, its Feed clips and files, and the view", async ({
  page,
}) => {
  await loadStory(page);
  await importFiles(page, "05-wide.mp4");
  // At 00:00:10:00, V1 is taken: the file goes on V2.
  await jumpTo(page, "00:00:10:00");
  await page
    .getByRole("region", { name: "Media bin" })
    .getByRole("button", { name: /^05-wide\.mp4 / })
    .click();
  await expect(clip(page, "05-wide.mp4")).toHaveAccessibleName(
    "05-wide.mp4 on V2, starts 00:00:10:00, 00:00:05:00 long",
  );
  // A trim of a Feed clip with ], and the view zoomed in.
  await clip(page, "04-insert").click();
  await page.keyboard.press("]");
  await page.keyboard.press("+");
  const zoom = await page.getByRole("slider", { name: "Zoom" }).getAttribute("aria-valuetext");
  const before = await clipNames(page);
  expect(before).toContain("04-insert on V1, starts 00:00:09:00, 00:00:01:00 long");
  await expect(appBar(page).getByText("Saved", { exact: true })).toBeVisible();
  // The view saves a second after it settles.
  await expect
    .poll(async () => (await newestSave(page))?.view.playhead, { timeout: 10_000 })
    .toBe(240);
  await expect.poll(async () => (await newestSave(page))?.view.pxPerFrame).toBeGreaterThan(2);

  const feedRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/media")) feedRequests.push(request.url());
  });
  await page.reload();

  await expect(appBar(page).getByText("Restored from this browser")).toBeVisible();
  expect(await clipNames(page)).toEqual(before);
  await expect(playheadTimecode(page)).toHaveText("00:00:10:00");
  await expect(page.getByRole("slider", { name: "Zoom" })).toHaveAttribute(
    "aria-valuetext",
    zoom ?? "",
  );
  // The file's filmstrip comes back from storage; the Feed clips come back without asking it.
  await expect.poll(() => drawnPixels(page, "05-wide.mp4"), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(feedRequests).toEqual([]);
  // A restored project starts a fresh history.
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("a Feed clip's thumbnails are kept for later sessions only once every one is stored", async ({
  page,
}) => {
  if (inWebKit()) test.info().setTimeout(test.info().timeout + 30_000);
  const medium = "feed-g6lq3m8u9k-v1"; // 07-medium
  await routeFeed(page);
  await page.goto("/");
  // 07-medium's second thumbnail can't be written: the test holds its file.
  expect(await holdThumbnailFile(page, medium, 1)).toBe("held");
  await page.getByRole("button", { name: "Load the robot story" }).click();
  await page.waitForFunction(
    () => performance.getEntriesByName("feed:thumbnails").length >= 15,
    null,
    { timeout: 30_000 },
  );
  const kept = await keptFeedClips(page);
  expect(kept).toHaveLength(14);
  expect(kept).not.toContain(medium);
  await expect.poll(async () => (await newestSave(page))?.clips.V1?.length).toBe(15);

  // The next session makes 07-medium's thumbnails again, and keeps them.
  expect(await releaseThumbnailFile(page)).toBe("released");
  await page.reload();
  await expect.poll(() => keptFeedClips(page), { timeout: 30_000 }).toHaveLength(15);
});

test("New project clears the saves, My files and the caches", async ({ page }) => {
  await loadStory(page);
  await importFiles(page, "tone.wav");
  await expect.poll(() => newestSave(page), { timeout: 10_000 }).not.toBeNull();

  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Start a new project?" });
  await expect(dialog).toContainText(
    "The robot story and the files you added will be removed from this browser. This can't be undone.",
  );
  await dialog.getByRole("button", { name: "Start new project" }).click();

  await expect(page.getByRole("heading", { name: "Start a cut" })).toBeVisible();
  await expect(appBar(page)).toContainText("Untitled project");
  await expect.poll(() => storageFolders(page)).toEqual([]);
  await page.getByRole("tab", { name: "My files" }).click();
  await expect(page.getByText("Drop video or audio files here")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Start a cut" })).toBeVisible();
  await expect(page.getByText("Drop video or audio files here")).toBeVisible();
  await expect(appBar(page).getByText("Restored from this browser")).toHaveCount(0);
});

test("a full storage says so, and the last good save stays", async ({ page }) => {
  await storageFullOnCue(page);
  await loadStory(page);
  await expect.poll(() => newestSave(page), { timeout: 10_000 }).not.toBeNull();
  await expect(appBar(page).getByText("Saved", { exact: true })).toBeVisible();

  await page.evaluate(() => Reflect.set(window, "storageFull", true));
  await clip(page, "07-medium").click();
  await page.keyboard.press("Delete");

  await expect(appBar(page).getByText("Not saved: storage is full")).toBeVisible();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Storage is full");
  await expect(alert).toContainText(
    /Your last save, from \d\d:\d\d, is safe\. Free up space in this browser, then keep editing\./,
  );
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(alert).toHaveCount(0);

  await page.reload();
  await expect(appBar(page).getByText("Restored from this browser")).toBeVisible();
  // The delete wasn't saved: the last good save has 07-medium.
  await expect(clip(page, "07-medium")).toBeVisible();
});

test("storage the page can't open is read by the save worker, so the project comes back", async ({
  page,
}) => {
  // From the reload on, the page's own storage fails to open; the save worker's still opens.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("pageStorageFails") !== "yes") return;
    navigator.storage.getDirectory = () =>
      Promise.reject(new DOMException("Not now", "UnknownError"));
  });
  await loadStory(page);
  await expect
    .poll(async () => (await newestSave(page))?.clips.V1?.length, { timeout: 10_000 })
    .toBe(15);
  const before = await clipNames(page);
  await page.evaluate(() => {
    sessionStorage.setItem("pageStorageFails", "yes");
  });
  await page.reload();

  await expect(appBar(page).getByText("Restored from this browser")).toBeVisible();
  expect(await clipNames(page)).toEqual(before);
});

test("storage that doesn't answer at startup: the editor shows, saves nothing and says so", async ({
  page,
}) => {
  // The page's storage never answers.
  await page.addInitScript(() => {
    navigator.storage.getDirectory = () => new Promise(() => undefined);
  });
  await routeFeed(page);
  await page.goto("/");

  // After the 5 s the restore may take.
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't open the saved project", { timeout: 10_000 });
  await expect(alert).toContainText(
    "This browser's storage didn't answer, so nothing is saved for now. Reload to try again.",
  );
  await expect(appBar(page).getByText("Not saved: storage didn't answer")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start a cut" })).toBeVisible();
  // Nothing on the timeline, but the saves it couldn't open are at stake: New project asks.
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("alertdialog", { name: "Start a new project?" })).toContainText(
    "Your last save will be removed from this browser. This can't be undone.",
  );
});

test("a second tab doesn't save over the first: it waits, or takes the project over", async ({
  page,
  context,
}) => {
  await loadStory(page);
  await expect.poll(() => newestSave(page), { timeout: 10_000 }).not.toBeNull();

  const second = await context.newPage();
  await routeFeed(second);
  await second.goto("/");
  await expect(
    second.getByRole("heading", { name: "Your project is open in another tab" }),
  ).toBeVisible();

  // The first tab still edits and saves.
  await clip(page, "07-medium").click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await newestSave(page))?.clips.V1?.length).toBe(14);

  await second.getByRole("button", { name: "Use it here" }).click();
  await expect(clip(second, "15-wide")).toBeVisible();
  await expect(clip(second, "07-medium")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your project moved to another tab" }),
  ).toBeVisible();
  await second.close();
});
