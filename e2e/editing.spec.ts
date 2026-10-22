// Spec section 5, tests 2 to 7, on the robot story loaded from the Feed's fixtures (e2e/feed.ts;
// 24 fps, 2 px per frame): shot n (from 0) sits on V1 at frame 72 n, 3 s of its 5 s, and the music
// fills A1.

import { clip, dragBy, jumpTo, loadStory, playheadTimecode, rightEdge } from "./editor.ts";
import { expect, test } from "./test.ts";

const SHOTS = [
  "01-wide",
  "02-medium",
  "03-closeup",
  "04-insert",
  "05-wide",
  "06-tracking",
  "07-medium",
  "08-closeup",
  "09-cutaway",
  "10-wide",
  "11-crane-up",
  "12-wide",
  "13-closeup",
  "14-medium",
  "15-wide",
];

test.beforeEach(async ({ page }) => {
  await loadStory(page);
});

test("2. the robot story puts 15 clips on V1 in shot order and music on A1", async ({ page }) => {
  const v1 = page.getByRole("button", { name: / on V1, / });
  await expect(v1).toHaveCount(15);
  const names: string[] = [];
  for (const placed of await v1.all()) {
    const label = (await placed.getAttribute("aria-label")) ?? "";
    names.push(label.slice(0, label.indexOf(" on ")));
  }
  expect(names).toEqual(SHOTS);
  await expect(clip(page, "05-wide")).toHaveAccessibleName(
    "05-wide on V1, starts 00:00:12:00, 00:00:03:00 long",
  );
  await expect(page.getByRole("button", { name: / on A1, / })).toHaveAccessibleName(
    "Demo music on A1, starts 00:00:00:00, 00:00:45:00 long",
  );
  await expect(page.getByText("15 clips and music ·")).toBeVisible();
});

test("3. a drag moves a clip, snaps to a neighbor's edge, and doesn't snap with Alt held", async ({
  page,
}) => {
  // Make room: without 06-tracking, 05-wide can move between 288 and 360.
  await clip(page, "06-tracking").click();
  await page.keyboard.press("Delete");

  // 40 px right is 20 frames.
  await dragBy(page, clip(page, "05-wide"), { x: 30, dx: 40 });
  await expect(clip(page, "05-wide")).toHaveAccessibleName(/starts 00:00:12:20,/);

  // 49 frames more would end it 3 frames short of 07-medium (432): it snaps to touch it.
  await dragBy(page, clip(page, "05-wide"), { x: 30, dx: 98 });
  await expect(clip(page, "05-wide")).toHaveAccessibleName(/starts 00:00:15:00,/);

  // The same drag with Alt held lands where the pointer says.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(clip(page, "05-wide")).toHaveAccessibleName(/starts 00:00:12:20,/);
  await page.keyboard.down("Alt");
  await dragBy(page, clip(page, "05-wide"), { x: 30, dx: 98 });
  await page.keyboard.up("Alt");
  await expect(clip(page, "05-wide")).toHaveAccessibleName(/starts 00:00:14:21,/);
});

test("4. trims stop at neighbors and the source's end; [ and ] trim to the playhead", async ({
  page,
}) => {
  const closeup = clip(page, "03-closeup");

  // Its end can't pass 04-insert, which starts where it ends.
  await dragBy(page, closeup, { x: await rightEdge(closeup), dx: 60 });
  await expect(closeup).toHaveAccessibleName(/, 00:00:03:00 long$/);

  // With 04-insert gone, the end stops at the source's: all 5 s of it.
  await clip(page, "04-insert").click();
  await page.keyboard.press("Delete");
  await dragBy(page, closeup, { x: await rightEdge(closeup), dx: 200 });
  await expect(closeup).toHaveAccessibleName(/starts 00:00:06:00, 00:00:05:00 long$/);

  // [ and ] trim 07-medium (00:00:18:00 to 00:00:21:00) to the playhead.
  await clip(page, "07-medium").click();
  await jumpTo(page, "00:00:18:12");
  await page.keyboard.press("[");
  await expect(clip(page, "07-medium")).toHaveAccessibleName(
    "07-medium on V1, starts 00:00:18:12, 00:00:02:12 long",
  );
  await jumpTo(page, "00:00:20:00");
  await page.keyboard.press("]");
  await expect(clip(page, "07-medium")).toHaveAccessibleName(
    "07-medium on V1, starts 00:00:18:12, 00:00:01:12 long",
  );
});

test("5. S splits at the playhead; undo gives one clip back; redo splits again", async ({
  page,
}) => {
  await clip(page, "07-medium").click();
  await jumpTo(page, "00:00:19:00");
  await page.keyboard.press("s");
  await expect(clip(page, "07-medium")).toHaveCount(2);
  await expect(clip(page, "07-medium").nth(1)).toHaveAccessibleName(
    "07-medium on V1, starts 00:00:19:00, 00:00:02:00 long",
  );

  await page.keyboard.press("ControlOrMeta+z");
  await expect(clip(page, "07-medium")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(clip(page, "07-medium")).toHaveCount(2);
});

test("6. a whole drag is one undo step", async ({ page }) => {
  await clip(page, "06-tracking").click();
  await page.keyboard.press("Delete");

  // Forty small pointer moves, one gesture.
  await dragBy(page, clip(page, "05-wide"), { x: 30, dx: 60, steps: 40 });
  await expect(clip(page, "05-wide")).toHaveAccessibleName(/starts 00:00:13:06,/);
  await expect(page.getByText("Undo: move 05-wide")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(clip(page, "05-wide")).toHaveAccessibleName(/starts 00:00:12:00,/);
  await expect(page.getByText("Undo: delete 06-tracking")).toBeVisible();
});

test("7. the arrow keys step exactly one frame, and the timecode matches", async ({ page }) => {
  const timecode = playheadTimecode(page);
  await expect(timecode).toHaveText("00:00:00:00");
  for (const expected of ["00:00:00:01", "00:00:00:02", "00:00:00:03"]) {
    await page.keyboard.press("ArrowRight");
    await expect(timecode).toHaveText(expected);
  }
  await page.keyboard.press("Shift+ArrowRight");
  await expect(timecode).toHaveText("00:00:01:03");
  await page.keyboard.press("ArrowLeft");
  await expect(timecode).toHaveText("00:00:01:02");
  await page.keyboard.press("End");
  await expect(timecode).toHaveText("00:00:45:00");
  await page.keyboard.press("Home");
  await expect(timecode).toHaveText("00:00:00:00");
});

test("the scroll bar's thumb drags the tracks sideways", async ({ page }) => {
  // At 2 px per frame the 45 s cut is 2,184 px wide with its end room: 15-wide is out of view.
  const last = clip(page, "15-wide");
  expect((await last.boundingBox())?.x).toBeGreaterThan(1_440);

  // The thumb starts at the scroll bar's left, 8 px into the tracks (which start at x 88).
  await page.mouse.move(88 + 8 + 100, 888);
  await page.mouse.down();
  await page.mouse.move(88 + 8 + 900, 888, { steps: 10 });
  await page.mouse.up();
  const box = await last.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(1_440);
});

test("Tab to a clip out of view scrolls it into view, and clicks still land on their frame", async ({
  page,
}) => {
  await clip(page, "10-wide").focus();
  await page.keyboard.press("Tab");
  const crane = clip(page, "11-crane-up");
  await expect(crane).toBeFocused();
  const box = await crane.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(1_440);

  // A ruler label sits 4 px right of its frame's tick: a click on the tick puts the playhead there.
  const label = await page.getByText("00:00:30:00", { exact: true }).boundingBox();
  if (!label) throw new Error("No label for 00:00:30:00");
  await page.mouse.click(label.x - 4 + 0.5, label.y + 4);
  await expect(playheadTimecode(page)).toHaveText("00:00:30:00");
});
