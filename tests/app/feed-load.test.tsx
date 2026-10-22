// The Feed tab's chunk not loading (offline when the tab first opens): the panel says so, with
// Retry, and My files keeps working.

import { fireEvent, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderEmptyEditor } from "./editor.tsx";

vi.mock("../../src/app/FeedClips.tsx", () => Promise.reject(new Error("Failed to fetch")));

const bin = () => screen.getByRole("region", { name: "Media bin" });

test("a Feed tab that won't load says so, with Retry, and My files still works", async () => {
  renderEmptyEditor();
  fireEvent.click(within(bin()).getByRole("tab", { name: "From the Feed" }));
  const alert = await within(bin()).findByRole("alert");
  expect(alert.textContent).toBe("The Feed’s clips couldn’t load: check your connection.");

  // Retry asks for the chunk again; it still doesn't come here, so the message comes back.
  fireEvent.click(within(bin()).getByRole("button", { name: "Retry" }));
  expect((await within(bin()).findByRole("alert")).textContent).toContain("couldn’t load");

  fireEvent.click(within(bin()).getByRole("tab", { name: "My files" }));
  expect(within(bin()).queryByRole("alert")).toBeNull();
  expect(within(bin()).getByRole("button", { name: "Choose files" })).toBeDefined();
});
