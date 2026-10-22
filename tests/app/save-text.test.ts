import { describe, expect, test } from "vitest";
import { newProjectText } from "../../src/app/new-project.ts";
import { clockTime, statusText, storageFullDetail } from "../../src/app/save-text.ts";
import { createProject } from "../../src/engine/project.ts";
import { testStory } from "./story.ts";

describe("what saving says", () => {
  test("the app bar's status, in the Messages board's words", () => {
    expect(statusText({ kind: "idle" })).toBeNull();
    expect(statusText({ kind: "saving" })).toBe("Saving…");
    expect(statusText({ kind: "saved", at: 0 })).toBe("Saved");
    expect(statusText({ kind: "restored", at: 0 })).toBe("Restored from this browser");
    expect(statusText({ kind: "failed", failure: "quota", lastSaved: 0 })).toBe(
      "Not saved: storage is full",
    );
    expect(statusText({ kind: "failed", failure: "unavailable", lastSaved: null })).toBe(
      "Not saved: this browser won't store files",
    );
  });

  test("the storage-full toast says when the last good save is from", () => {
    const lastSaved = new Date(2026, 9, 19, 14, 32, 59).getTime();
    expect(clockTime(lastSaved)).toBe("14:32");
    expect(clockTime(new Date(2026, 9, 19, 9, 5).getTime())).toBe("09:05");
    expect(storageFullDetail(lastSaved)).toBe(
      "Your last save, from 14:32, is safe. Free up space in this browser, then keep editing.",
    );
    expect(storageFullDetail(null)).toBe(
      "Nothing could be saved yet. Free up space in this browser, then keep editing.",
    );
  });
});

describe("what New project says goes", () => {
  test("the board's words for the story and files, and only what there is otherwise", () => {
    expect(newProjectText(testStory(), 2)).toBe(
      "The robot story and the files you added will be removed from this browser. This can't be undone.",
    );
    expect(newProjectText(testStory(), 0)).toBe(
      "The robot story will be removed from this browser. This can't be undone.",
    );
    expect(newProjectText(createProject({ id: "new" }), 3)).toBe(
      "The files you added will be removed from this browser. This can't be undone.",
    );
    // Asked only when saving failed: the save the tab couldn't open, or couldn't write over.
    expect(newProjectText(createProject({ id: "new" }), 0)).toBe(
      "Your last save will be removed from this browser. This can't be undone.",
    );
  });
});
