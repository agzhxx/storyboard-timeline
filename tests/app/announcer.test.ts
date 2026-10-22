import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ANNOUNCE_DELAY_MS,
  announce,
  announceEdits,
  editAnnouncement,
  moveHistory,
  redoAnnouncement,
  undoAnnouncement,
  useAnnouncer,
} from "../../src/app/announcer.ts";
import { useDocumentStore } from "../../src/engine/store.ts";
import { testStory } from "./story.ts";

describe("what each edit is said as", () => {
  test("each edit's undo label, as done", () => {
    expect(editAnnouncement("trim start of 07-medium")).toBe("Trimmed the start of 07-medium.");
    expect(editAnnouncement("trim end of 07-medium")).toBe("Trimmed the end of 07-medium.");
    expect(editAnnouncement("move 07-medium")).toBe("Moved 07-medium.");
    expect(editAnnouncement("split 07-medium")).toBe("Split 07-medium.");
    expect(editAnnouncement("delete 07-medium")).toBe("Deleted 07-medium.");
    expect(editAnnouncement("delete 3 clips")).toBe("Deleted 3 clips.");
    expect(editAnnouncement("add 05-wide.mp4")).toBe("Added 05-wide.mp4.");
  });

  test("a label it doesn't know is said as it is", () => {
    expect(editAnnouncement("rename the project")).toBe("Rename the project.");
  });

  test("undo and redo, in the chip's words", () => {
    expect(undoAnnouncement("trim end of 07-medium")).toBe("Undid trim end of 07-medium.");
    expect(redoAnnouncement("split 07-medium")).toBe("Redid split 07-medium.");
  });
});

describe("the live region", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDocumentStore.getState().loadProject(testStory());
    useAnnouncer.setState({ text: "" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const said = () => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    return useAnnouncer.getState().text;
  };

  test("is emptied first, so the same words twice are said twice", () => {
    announce("Saved.");
    expect(said()).toBe("Saved.");
    announce("Saved.");
    expect(useAnnouncer.getState().text).toBe("");
    expect(said()).toBe("Saved.");
  });

  test("says a burst once, with its last words", () => {
    announce("Trimmed the start of 07-medium.");
    announce("Trimmed the start of 07-medium.");
    announce("Moved 07-medium.");
    expect(said()).toBe("Moved 07-medium.");
  });

  test("says each edit, and undo and redo as such; loading a project says nothing", () => {
    const stop = announceEdits();
    const edit = useDocumentStore.getState();
    expect(edit.trimEnd({ clipId: "07-medium", end: 500 }).ok).toBe(true);
    expect(said()).toBe("Trimmed the end of 07-medium.");
    moveHistory("undo");
    expect(said()).toBe("Undid trim end of 07-medium.");
    moveHistory("redo");
    expect(said()).toBe("Redid trim end of 07-medium.");
    useAnnouncer.setState({ text: "" });
    edit.loadProject(testStory());
    expect(said()).toBe("");
    // Nothing to undo: nothing said.
    moveHistory("undo");
    expect(said()).toBe("");
    stop();
  });
});
