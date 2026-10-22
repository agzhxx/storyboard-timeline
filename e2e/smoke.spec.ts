import { expect, test } from "./test.ts";

// Spec section 5, test 1.
test("loads with no console errors, and the empty state shows both buttons", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  await page.goto("/");

  await expect(page).toHaveTitle("Storyboard Timeline");
  await expect(page.getByRole("heading", { level: 1, name: "Storyboard Timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start a cut" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load the robot story" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add your own files" })).toBeVisible();
  expect(errors).toEqual([]);
});
