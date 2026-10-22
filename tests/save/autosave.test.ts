import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createProject } from "../../src/engine/project.ts";
import { createDocumentStore, createUiStore } from "../../src/engine/store.ts";
import {
  Autosave,
  MAX_SAVE_DELAY_MS,
  RESTORED_FOR_MS,
  SAVE_DELAY_MS,
  type SaveStatus,
  useSaveStatus,
  VIEW_SAVE_DELAY_MS,
} from "../../src/save/autosave.ts";
import { SaveError, type SaveWorker } from "../../src/save/save-client.ts";
import { parseSave } from "../../src/save/save-schema.ts";
import type { SaveFailure } from "../../src/save/save-protocol.ts";
import { OWN_FILE, saveFile, savedProject, VIEW } from "./saves.ts";

/** The writes the fake worker was asked for, and a way to make the next ones fail. */
function fakeWorker() {
  const writes: { file: string; text: string }[] = [];
  let failing: SaveFailure | null = null;
  const worker: SaveWorker = {
    read: vi.fn(),
    write: vi.fn((file: string, text: string) => {
      if (failing) return Promise.reject(new SaveError(failing, "Not written"));
      writes.push({ file, text });
      return Promise.resolve();
    }),
    clear: vi.fn(() => Promise.resolve()),
    warm: vi.fn(),
    stop: vi.fn(),
  };
  return {
    worker,
    writes,
    fail: (failure: SaveFailure | null) => {
      failing = failure;
    },
  };
}

function setup(project = createProject({ id: "new" })) {
  const documents = createDocumentStore(project);
  const ui = createUiStore(documents);
  const { worker, writes, fail } = fakeWorker();
  const failures: [SaveFailure, number | null][] = [];
  const realWork = vi.fn();
  let clock = 1_760_000_000_000;
  const autosave = new Autosave({
    worker,
    documentStore: documents,
    uiStore: ui,
    now: () => (clock += 1_000),
    onRealWork: realWork,
    onFailure: (failure, lastSaved) => failures.push([failure, lastSaved]),
  });
  /** The saves written so far, read back as restoring would. */
  const saved = () => writes.map(({ file, text }) => ({ file, save: parseSave(text) }));
  return { documents, ui, autosave, worker, writes, saved, fail, failures, realWork };
}

/** Lets timers and the writes' promises run. */
async function wait(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

function status(): SaveStatus {
  return useSaveStatus.getState().status;
}

/** Puts the person's file on V2: a change with real work in it. */
function addFile(documents: ReturnType<typeof createDocumentStore>, start = 0) {
  const result = documents.getState().placeAsset({ asset: OWN_FILE, trackId: "V2", start });
  if (!result.ok) throw new Error(result.error.message);
  return result.clipId;
}

beforeEach(() => {
  vi.useFakeTimers();
  useSaveStatus.setState({ status: { kind: "idle" } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("autosave", () => {
  test("saves nothing for a new project with nothing in it", async () => {
    const { autosave, ui, writes } = setup();
    autosave.start(null);
    ui.getState().setZoom(4);
    ui.getState().setScrollX(300);
    await wait(5_000);
    expect(writes).toEqual([]);
    expect(status()).toEqual({ kind: "idle" });
  });

  test("saves half a second after a change, into slot a, then takes turns", async () => {
    const { autosave, documents, saved, realWork } = setup();
    autosave.start(null);
    const clipId = addFile(documents);
    expect(status()).toEqual({ kind: "saving" });
    await wait(SAVE_DELAY_MS - 1);
    expect(saved()).toEqual([]);
    await wait(1);
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toMatchObject({ file: "slot-a.json", save: { seq: 1 } });
    expect(status()).toMatchObject({ kind: "saved" });
    expect(realWork).toHaveBeenCalledOnce();

    documents.getState().moveClip({ clipId, start: 10 });
    await wait(SAVE_DELAY_MS);
    documents.getState().moveClip({ clipId, start: 20 });
    await wait(SAVE_DELAY_MS);
    expect(saved().map(({ file, save }) => [file, save?.seq])).toEqual([
      ["slot-a.json", 1],
      ["slot-b.json", 2],
      ["slot-a.json", 3],
    ]);
    // What was written is the document as it is, the history left out.
    expect(saved()[2]?.save?.project).toEqual(documents.getState().project);
  });

  test("a run of changes is one save: after the last, or two seconds into the run", async () => {
    const { autosave, documents, writes } = setup();
    autosave.start(null);
    const clipId = addFile(documents);
    for (let start = 1; start <= 3; start += 1) {
      await wait(SAVE_DELAY_MS - 100);
      documents.getState().moveClip({ clipId, start });
    }
    await wait(SAVE_DELAY_MS);
    expect(writes).toHaveLength(1);

    for (let start = 4; start <= 12; start += 1) {
      await wait(SAVE_DELAY_MS - 100);
      documents.getState().moveClip({ clipId, start });
    }
    // Nine changes 0.4 s apart: saves at the two-second mark, and once more after the last.
    expect(writes).toHaveLength(2);
    await wait(SAVE_DELAY_MS);
    expect(writes).toHaveLength(3);
    expect(MAX_SAVE_DELAY_MS).toBe(2_000);
  });

  test("the view alone saves a second after it settles, and the status stays Saved", async () => {
    const { autosave, documents, ui, saved } = setup();
    autosave.start(null);
    addFile(documents);
    await wait(SAVE_DELAY_MS);
    const savedAt = status();
    ui.getState().setPlayhead(30);
    ui.getState().setZoom(8);
    expect(status()).toEqual(savedAt);
    await wait(VIEW_SAVE_DELAY_MS);
    expect(saved()).toHaveLength(2);
    expect(saved()[1]?.save?.view).toEqual({ playhead: 30, pxPerFrame: 8, scrollX: 0 });
    expect(status()).toEqual(savedAt);
  });

  test("a view that keeps changing, as playback moves the playhead, saves once it settles", async () => {
    const { autosave, documents, ui, saved } = setup();
    autosave.start(null);
    addFile(documents);
    await wait(SAVE_DELAY_MS);
    for (let frame = 1; frame <= 120; frame += 1) {
      ui.getState().setPlayhead(frame);
      await wait(40);
    }
    // Nearly five seconds of a moving playhead: no save until it stops.
    expect(saved()).toHaveLength(1);
    await wait(VIEW_SAVE_DELAY_MS);
    expect(saved()).toHaveLength(2);
    expect(saved()[1]?.save?.view.playhead).toBe(120);
  });

  test("an undo back to nothing before the first save saves nothing", async () => {
    const { autosave, documents, writes } = setup();
    autosave.start(null);
    addFile(documents);
    documents.getState().undo();
    await wait(MAX_SAVE_DELAY_MS);
    expect(writes).toEqual([]);
    expect(status()).toEqual({ kind: "idle" });
  });

  test("leaving the page writes what's waiting at once", async () => {
    const { autosave, documents, writes } = setup();
    autosave.start(null);
    addFile(documents);
    await autosave.flush();
    expect(writes).toHaveLength(1);
    await autosave.flush();
    expect(writes).toHaveLength(1);
  });

  test("restored, it says so for a moment, then Saved, and saves into the other slot", async () => {
    const { autosave, documents, ui, saved } = setup(savedProject());
    ui.setState({ playhead: VIEW.playhead, pxPerFrame: VIEW.pxPerFrame, scrollX: VIEW.scrollX });
    const restored = saveFile(41, documents.getState().project);
    autosave.start({ slot: 0, ...restored });
    expect(status()).toEqual({ kind: "restored", at: restored.savedAt });
    await wait(RESTORED_FOR_MS);
    expect(status()).toEqual({ kind: "saved", at: restored.savedAt });
    // Nothing changed: nothing to write.
    await wait(MAX_SAVE_DELAY_MS);
    expect(saved()).toEqual([]);

    documents.getState().deleteClips({ clipIds: ["own"] });
    await wait(SAVE_DELAY_MS);
    expect(saved().map(({ file, save }) => [file, save?.seq])).toEqual([["slot-b.json", 42]]);
  });

  test("storage full: says so once, keeps the last good save's slot, and tries again", async () => {
    const { autosave, documents, saved, fail, failures } = setup();
    autosave.start(null);
    const clipId = addFile(documents);
    await wait(SAVE_DELAY_MS);
    const firstSave = status();
    if (firstSave.kind !== "saved") throw new Error("The first save was written");

    fail("quota");
    documents.getState().moveClip({ clipId, start: 5 });
    await wait(SAVE_DELAY_MS);
    expect(status()).toEqual({ kind: "failed", failure: "quota", lastSaved: firstSave.at });
    documents.getState().moveClip({ clipId, start: 6 });
    // The status stays on the problem while it lasts.
    expect(status()).toMatchObject({ kind: "failed" });
    await wait(SAVE_DELAY_MS);
    expect(failures).toEqual([["quota", firstSave.at]]);

    fail(null);
    documents.getState().moveClip({ clipId, start: 7 });
    await wait(SAVE_DELAY_MS);
    expect(status()).toMatchObject({ kind: "saved" });
    // Slot a held the last good save throughout; the failed tries were all aimed at slot b.
    expect(saved().map(({ file, save }) => [file, save?.seq])).toEqual([
      ["slot-a.json", 1],
      ["slot-b.json", 2],
    ]);
  });

  test("a file another tab's worker still holds is tried again a second later", async () => {
    const { autosave, documents, writes, fail, failures } = setup();
    autosave.start(null);
    addFile(documents);
    fail("busy");
    await wait(SAVE_DELAY_MS);
    expect(writes).toEqual([]);
    fail(null);
    await wait(1_000);
    expect(writes).toHaveLength(1);
    expect(failures).toEqual([]);
    expect(status()).toMatchObject({ kind: "saved" });
  });

  test("a browser that won't store files says so once and stops trying", async () => {
    const { autosave, documents, worker, fail, failures } = setup();
    autosave.start(null);
    const clipId = addFile(documents);
    fail("unavailable");
    await wait(SAVE_DELAY_MS);
    expect(status()).toEqual({ kind: "failed", failure: "unavailable", lastSaved: null });
    documents.getState().moveClip({ clipId, start: 9 });
    await wait(MAX_SAVE_DELAY_MS);
    expect(worker.write).toHaveBeenCalledOnce();
    expect(failures).toEqual([["unavailable", null]]);
  });

  test("New project: waits for the save under way, clears, and saves nothing of the new one", async () => {
    const { autosave, documents, worker, writes } = setup();
    autosave.start(null);
    addFile(documents);
    const cleared = autosave.replaceAll(["saves", "assets", "remote"], () => {
      documents.getState().loadProject(createProject({ id: "fresh" }));
    });
    expect(await cleared).toBe(true);
    expect(worker.clear).toHaveBeenCalledWith(["saves", "assets", "remote"]);
    expect(documents.getState().project.id).toBe("fresh");
    expect(status()).toEqual({ kind: "idle" });
    await wait(MAX_SAVE_DELAY_MS);
    expect(writes).toEqual([]);
  });

  test("New project's saves are numbered after the last project's, whatever the clear left", async () => {
    const { autosave, documents, worker, saved } = setup(savedProject());
    autosave.start({ slot: 1, ...saveFile(41, documents.getState().project) });
    vi.mocked(worker.clear).mockRejectedValueOnce(new SaveError("busy", "In use"));
    const cleared = await autosave.replaceAll(["saves"], () => {
      documents.getState().loadProject(createProject({ id: "fresh" }));
    });
    expect(cleared).toBe(false);
    addFile(documents);
    await wait(SAVE_DELAY_MS);
    // Slot b may still hold save 41: save 42 is the newest, so the new project is what comes back.
    expect(saved().map(({ file, save }) => [file, save?.seq])).toEqual([["slot-a.json", 42]]);
  });

  test("New project after saves that couldn't be opened: a failed clear leaves saving off", async () => {
    const { autosave, documents, worker, writes } = setup();
    vi.mocked(worker.clear).mockRejectedValueOnce(new SaveError("other", "Not now"));
    await autosave.replaceAll(["saves"], () => {
      documents.getState().loadProject(createProject({ id: "fresh" }));
    });
    expect(status()).toEqual({ kind: "failed", failure: "other", lastSaved: null });
    addFile(documents);
    await wait(MAX_SAVE_DELAY_MS);
    expect(writes).toEqual([]);
  });

  test("a write the stop cut short isn't a failure, and says nothing", async () => {
    const { autosave, documents, fail, failures } = setup();
    autosave.start(null);
    addFile(documents);
    fail("other");
    const flushed = autosave.flush();
    autosave.stop();
    await flushed;
    expect(failures).toEqual([]);
    expect(status()).toEqual({ kind: "saving" });
  });

  test("stopped (another tab took the project), it saves nothing more", async () => {
    const { autosave, documents, writes } = setup();
    autosave.start(null);
    addFile(documents);
    autosave.stop();
    await wait(MAX_SAVE_DELAY_MS);
    expect(writes).toEqual([]);
  });
});
