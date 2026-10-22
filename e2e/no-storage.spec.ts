// A browser that won't let the site store files (spec section 3.5): Playwright's WebKit gives its
// default contexts no origin private file system, as some private windows do, so these tests use
// the plain `test`, in WebKit only. The editor works; saving says it can't, once; and New project
// starts afresh, with nothing to remove.

import { loadStory } from "./editor.ts";
import { inWebKit } from "./feed.ts";
import { expect, test } from "./test.ts";

test.beforeEach(() => {
  test.skip(!inWebKit(), "Chrome's test contexts have storage");
});

test("saving says this browser won't store files, and New project starts afresh", async ({
  page,
}) => {
  await loadStory(page);
  const appBar = page.getByRole("banner");
  await expect(appBar.getByText("Not saved: this browser won't store files")).toBeVisible();

  await page.getByRole("button", { name: "New project" }).click();
  await page
    .getByRole("alertdialog", { name: "Start a new project?" })
    .getByRole("button", { name: "Start new project" })
    .click();
  await expect(page.getByRole("heading", { name: "Start a cut" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Started a new project.");
  await expect(page.getByText("Some of the last project couldn't be removed")).toHaveCount(0);
});
