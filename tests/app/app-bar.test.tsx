// The app bar's right side (Main and Messages boards): the save status, New project and its
// confirmation, and the keyboard shortcuts.

import { act, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useDialogs } from "../../src/app/dialogs.ts";
import { useDocumentStore } from "../../src/engine/store.ts";
import { useLibrary } from "../../src/media/library.ts";
import { useSaveStatus } from "../../src/save/autosave.ts";
import { clipsOn, renderEditor, renderEmptyEditor } from "./editor.tsx";

const saveWorker = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(() => Promise.resolve()),
  clear: vi.fn(() => Promise.resolve()),
  warm: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../src/save/save-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/save/save-client.ts")>()),
  saveWorker,
}));

function appBar(): HTMLElement {
  return screen.getByRole("banner");
}

beforeEach(() => {
  useDialogs.setState({ shortcuts: false, newProject: false });
  useSaveStatus.setState({ status: { kind: "idle" } });
  saveWorker.clear.mockClear();
});

describe("the save status", () => {
  test("says nothing for a new project with nothing to save", () => {
    renderEmptyEditor();
    expect(appBar().textContent).toBe("Storyboard Timeline/Untitled projectNew project");
  });

  test("shows the Messages board's four states", () => {
    renderEditor();
    const states = [
      [{ kind: "saving" }, "Saving…"],
      [{ kind: "saved", at: 0 }, "Saved"],
      [{ kind: "restored", at: 0 }, "Restored from this browser"],
      [{ kind: "failed", failure: "quota", lastSaved: 0 }, "Not saved: storage is full"],
    ] as const;
    for (const [status, text] of states) {
      act(() => {
        useSaveStatus.setState({ status });
      });
      expect(within(appBar()).getByText(text)).toBeTruthy();
    }
  });
});

describe("New project", () => {
  test("asks first, in the board's words; Cancel keeps everything", async () => {
    const { user } = renderEditor();
    const before = useDocumentStore.getState().project;
    await user.click(screen.getByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Start a new project?" });
    expect(dialog.textContent).toContain(
      "The robot story will be removed from this browser. This can't be undone.",
    );
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(useDocumentStore.getState().project).toBe(before);
    expect(saveWorker.clear).not.toHaveBeenCalled();
  });

  test("Start new project clears the saves, My files and the caches, and shows the empty state", async () => {
    const { user } = renderEditor();
    useLibrary.setState({
      entries: [
        {
          id: "file-1",
          name: "05-wide.mp4",
          size: 1,
          lastModified: 1,
          importedAt: 1,
          status: { step: "ready" },
          facts: null,
          thumbnails: null,
        },
      ],
    });
    await user.click(screen.getByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("The robot story and the files you added will be removed");
    await user.click(within(dialog).getByRole("button", { name: "Start new project" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Start a cut" })).toBeTruthy();
    });
    expect(saveWorker.clear).toHaveBeenCalledWith(["saves", "assets", "remote"]);
    expect(useLibrary.getState().entries).toEqual([]);
    expect(clipsOn("V1")).toBe(0);
    expect(useDocumentStore.getState().project.name).toBe("Untitled project");
    // A new project can't be undone.
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
  });

  test("with nothing to lose, starts afresh without asking", async () => {
    const { user } = renderEmptyEditor();
    await user.click(screen.getByRole("button", { name: "New project" }));
    await waitFor(() => {
      expect(saveWorker.clear).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("asks when saving failed: storage may hold a project the tab couldn't open", async () => {
    const { user } = renderEmptyEditor();
    act(() => {
      useSaveStatus.setState({ status: { kind: "failed", failure: "other", lastSaved: null } });
    });
    await user.click(screen.getByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Start a new project?" });
    expect(dialog.textContent).toContain(
      "Your last save will be removed from this browser. This can't be undone.",
    );
    expect(saveWorker.clear).not.toHaveBeenCalled();
  });
});

describe("the keyboard shortcuts", () => {
  test("open from the app bar with the board's title, groups and rows", async () => {
    const { user } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog.textContent).toContain(
      "The whole edit works from the keyboard. ⌘ is Ctrl on Windows and Linux.",
    );
    const groups = within(dialog)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(groups).toEqual([
      "Playback",
      "Editing",
      "Help",
      "Selection",
      "Timeline",
      "Media bin",
      "Editing with the keyboard",
    ]);
    const terms = within(dialog)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(terms).toHaveLength(29);
    expect(terms.slice(0, 3)).toEqual(["Play or pause", "Play; again for 2×", "Pause"]);
    expect(terms).toContain("Nudge the selected clip a frame");
    // Symbols are named for screen readers: "⇧Z" is "Shift Z".
    expect(within(dialog).getByText("Shift Z")).toBeTruthy();
  });

  test("keep focus inside, and close with Esc or ? again", async () => {
    const { user } = renderEditor();
    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);

    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await user.keyboard("?");
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    await user.keyboard("?");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
