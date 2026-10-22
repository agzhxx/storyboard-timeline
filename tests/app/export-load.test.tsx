// The export dialog's chunk not loading (offline when Export first opens): a toast says so, and
// the editor carries on.

import { fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useExportDialog } from "../../src/app/export-open.ts";
import { renderEditor } from "./editor.tsx";

vi.mock("../../src/app/ExportDialog.tsx", () => Promise.reject(new Error("Failed to fetch")));

test("a dialog that won't load says so, and Export closes again", async () => {
  vi.stubGlobal("VideoEncoder", vi.fn());
  renderEditor();
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(
    await screen.findByText("Export couldn't load: check your connection. Editing still works."),
  ).toBeDefined();
  expect(useExportDialog.getState().open).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  vi.unstubAllGlobals();
});
