// The media bin, on the Feed's cards the robot story shows: Enter adds a clip at the playhead, and
// a card dragged onto a track lands under the pointer. And the perf overlay, which loads only when
// asked for.

import type { Page } from "@playwright/test";
import { clip, loadStory } from "./editor.ts";
import { expect, test } from "./test.ts";

/** A card in the media bin, by its asset's name. */
function card(page: Page, name: string) {
  return page
    .getByRole("region", { name: "Media bin" })
    .getByRole("button", { name: new RegExp(`^${name}`) });
}

test("Enter on a card adds the asset at the playhead, on V2 where V1 is taken", async ({
  page,
}) => {
  await loadStory(page);
  await card(page, "02-medium").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^02-medium on V2, / })).toHaveAccessibleName(
    "02-medium on V2, starts 00:00:00:00, 00:00:05:00 long",
  );
});

test("a card dragged onto V2 lands under the pointer", async ({ page }) => {
  await loadStory(page);
  const v2 = page.locator('[data-track-id="V2"]');
  const cardBox = await card(page, "02-medium").boundingBox();
  const rowBox = await v2.boundingBox();
  if (!cardBox || !rowBox) throw new Error("Not visible");

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  // Frame 200 is 400 px into the tracks at 2 px per frame.
  await page.mouse.move(rowBox.x + 400, rowBox.y + rowBox.height / 2, { steps: 12 });
  await expect(page.getByText("at 00:00:08:08")).toBeVisible();
  await page.mouse.up();

  await expect(clip(page, "02-medium")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^02-medium on V2, / })).toHaveAccessibleName(
    "02-medium on V2, starts 00:00:08:08, 00:00:05:00 long",
  );
});

test("the perf overlay loads, as its own chunk, only with ?perf=1", async ({ page }) => {
  const chunks: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("PerfOverlay")) chunks.push(request.url());
  });
  await loadStory(page);
  await expect(page.getByRole("complementary", { name: "Performance" })).toHaveCount(0);
  expect(chunks).toEqual([]);

  await page.goto("/?perf=1");
  const overlay = page.getByRole("complementary", { name: "Performance" });
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("FPS");
  expect(chunks).toHaveLength(1);
});
