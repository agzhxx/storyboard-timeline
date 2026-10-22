import { describe, expect, test, vi } from "vitest";
import { readSaves } from "../../src/save/read-saves.ts";
import { restore, restoreWithin } from "../../src/save/restore.ts";
import { SaveError, type SaveWorker } from "../../src/save/save-client.ts";
import type { ReadResult } from "../../src/save/save-protocol.ts";
import { memoryFolder } from "../media/memory-folder.ts";
import { saveFile, slotText } from "./saves.ts";

/** OPFS with the two slots as given, and the person's file's copy unless `withCopy` is false. */
function storage(slots: { a?: string; b?: string }, withCopy = true) {
  const saves: Record<string, string> = {};
  if (slots.a !== undefined) saves["slot-a.json"] = slots.a;
  if (slots.b !== undefined) saves["slot-b.json"] = slots.b;
  return memoryFolder({
    saves,
    assets: withCopy ? { "file-1": { "source.mp4": "bytes", "meta.json": "{}" } } : {},
  });
}

describe("reading the saves, in the save worker", () => {
  test("finds none with nothing saved", async () => {
    expect(await readSaves(memoryFolder({}))).toEqual({ kind: "none" });
    expect(await readSaves(storage({}))).toEqual({ kind: "none" });
  });

  test("restores the newest good save, with nothing missing", async () => {
    expect(await readSaves(storage({ a: slotText(2), b: slotText(3) }))).toEqual({
      kind: "restored",
      save: saveFile(3),
      slot: 1,
      missing: [],
    });
  });

  test("names the files whose copies storage no longer has", async () => {
    const restored = await readSaves(storage({ a: slotText(2) }, false));
    expect(restored).toMatchObject({ kind: "restored", slot: 0, missing: ["file-1"] });
  });

  test("says when saves are there but neither reads back", async () => {
    expect(await readSaves(storage({ a: "{", b: slotText(4).slice(0, 50) }))).toEqual({
      kind: "unreadable",
    });
  });
});

describe("restoring at startup", () => {
  function worker(result: ReadResult): SaveWorker & { read: ReturnType<typeof vi.fn> } {
    return {
      read: vi.fn(() => Promise.resolve(result)),
      write: vi.fn(),
      clear: vi.fn(),
      warm: vi.fn(),
      stop: vi.fn(),
    };
  }

  test("storage the page couldn't open: the worker reads, and says when nothing will save", async () => {
    const result: ReadResult = { kind: "restored", save: saveFile(3), slot: 0, missing: [] };
    expect(await restore(null, worker(result))).toBe(result);
    // A private window: the worker can't open storage either.
    const save = worker({ kind: "none" });
    save.read.mockRejectedValueOnce(new SaveError("unavailable", "NoStorage"));
    expect(await restore(null, save)).toEqual({ kind: "unavailable" });
    save.read.mockRejectedValueOnce(new SaveError("other", "UnknownError"));
    expect(await restore(null, save)).toEqual({ kind: "failed" });
  });

  test("with no slot there, starts afresh without starting the worker", async () => {
    const save = worker({ kind: "none" });
    expect(await restore(storage({}), save)).toEqual({ kind: "none" });
    expect(save.read).not.toHaveBeenCalled();
  });

  test("with a slot there, the worker reads and checks them", async () => {
    const result: ReadResult = { kind: "restored", save: saveFile(3), slot: 0, missing: [] };
    const save = worker(result);
    expect(await restore(storage({ a: slotText(3) }), save)).toBe(result);
    expect(save.read).toHaveBeenCalledOnce();
  });

  test("storage or the worker failing is a failure, so nothing writes over the saves", async () => {
    const save = worker({ kind: "none" });
    save.read.mockRejectedValueOnce(new Error("The save worker didn't start."));
    expect(await restore(storage({ b: slotText(1) }), save)).toEqual({ kind: "failed" });
    const broken = { ...memoryFolder({}), folder: () => Promise.reject(new Error("Gone")) };
    expect(await restore(broken, save)).toEqual({ kind: "failed" });
  });

  test("storage that hangs, opening or reading, fails after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const hanging = new Promise<never>(() => undefined);
      const opening = restoreWithin(5_000, () => hanging, worker({ kind: "none" }));
      const reading = { ...worker({ kind: "none" }), read: () => hanging };
      const read = restoreWithin(
        5_000,
        () => Promise.resolve(storage({ a: slotText(1) })),
        reading,
      );
      await vi.advanceTimersByTimeAsync(4_999);
      const settled = vi.fn();
      void Promise.race([opening, read]).then(settled);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await opening).toEqual({ kind: "failed" });
      expect(await read).toEqual({ kind: "failed" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("storage that answers in time restores as usual", async () => {
    const result: ReadResult = { kind: "restored", save: saveFile(3), slot: 0, missing: [] };
    const root = storage({ a: slotText(3) });
    expect(await restoreWithin(5_000, () => Promise.resolve(root), worker(result))).toBe(result);
  });
});
