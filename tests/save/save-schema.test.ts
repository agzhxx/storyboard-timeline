import { describe, expect, test } from "vitest";
import { newestSave, parseSave } from "../../src/save/save-schema.ts";
import { saveFile, savedProject, slotText } from "./saves.ts";

/** A save's JSON with a change made to it, as storage could hand it back. */
function edited(change: (json: Record<string, unknown>) => void): string {
  const json = JSON.parse(slotText(3)) as Record<string, unknown>;
  change(json);
  return JSON.stringify(json);
}

describe("reading a slot back", () => {
  test("gives back the save it was written from", () => {
    expect(parseSave(slotText(3))).toEqual(saveFile(3));
  });

  test("reads Feed clips saved before M8, which have no preview's address", () => {
    const older = edited((json) => {
      const project = json.project as { assets: Record<string, { source: object }> };
      for (const asset of Object.values(project.assets))
        Reflect.deleteProperty(asset.source, "previewUrl");
    });
    const assets = Object.values(parseSave(older)?.project.assets ?? {});
    expect(assets.filter((asset) => asset.source.type === "feed")).toHaveLength(15);
    expect(assets.some((asset) => "previewUrl" in asset.source)).toBe(false);
  });

  test("skips a slot that isn't there, or was cut short mid-write", () => {
    const text = slotText(3);
    expect(parseSave(null)).toBeNull();
    expect(parseSave("")).toBeNull();
    expect(parseSave(text.slice(0, text.length / 2))).toBeNull();
  });

  test("skips another format, and versions this one can't read", () => {
    expect(parseSave(edited((json) => (json.format = "something-else")))).toBeNull();
    expect(parseSave(edited((json) => (json.version = 2)))).toBeNull();
    expect(parseSave(edited((json) => Reflect.deleteProperty(json, "version")))).toBeNull();
    expect(parseSave("[]")).toBeNull();
    expect(parseSave('"a save"')).toBeNull();
  });

  test("skips wrong types and values: floats in frames, an unknown rate, no view", () => {
    const clip = (json: Record<string, unknown>) => {
      const project = json.project as { tracks: { clips: Record<string, unknown>[] }[] };
      const first = project.tracks[1]?.clips[0];
      if (!first) throw new Error("No clip on V1");
      return first;
    };
    expect(parseSave(edited((json) => (clip(json).start = 12.5)))).toBeNull();
    expect(parseSave(edited((json) => (clip(json).duration = 0)))).toBeNull();
    expect(parseSave(edited((json) => ((json.project as { fps: number }).fps = 60)))).toBeNull();
    expect(parseSave(edited((json) => Reflect.deleteProperty(json, "view")))).toBeNull();
    expect(parseSave(edited((json) => (json.seq = -1)))).toBeNull();
  });

  test("skips a project that breaks the document's rules, though every type is right", () => {
    const overlapping = savedProject();
    const v1 = overlapping.tracks[1];
    const [first, second] = v1?.clips ?? [];
    if (!v1 || !first || !second) throw new Error("The story has clips on V1");
    // The second shot starts a frame before the first one ends.
    v1.clips[1] = { ...second, start: first.start + first.duration - 1 };
    expect(parseSave(slotText(3, overlapping))).toBeNull();

    const pastItsSource = savedProject();
    const v2 = pastItsSource.tracks[0];
    const own = v2?.clips[0];
    if (!v2 || !own) throw new Error("The save has a clip on V2");
    v2.clips[0] = { ...own, in: 100 };
    expect(parseSave(slotText(3, pastItsSource))).toBeNull();
  });

  test("skips a file asset whose copy isn't where imports put copies", () => {
    const project = savedProject();
    const own = project.assets["file-1"];
    if (!own) throw new Error("The save has its file");
    project.assets["file-1"] = { ...own, source: { type: "file", opfsPath: "../elsewhere.mp4" } };
    expect(parseSave(slotText(3, project))).toBeNull();
  });
});

describe("choosing between the two slots", () => {
  test("takes the newer save, in either slot", () => {
    expect(newestSave([slotText(4), slotText(5)])).toEqual({ save: saveFile(5), slot: 1 });
    expect(newestSave([slotText(7), slotText(6)])).toEqual({ save: saveFile(7), slot: 0 });
  });

  test("takes the older one when the newer was cut short: the last good save", () => {
    const cut = slotText(8).slice(0, 200);
    expect(newestSave([slotText(7), cut])).toEqual({ save: saveFile(7), slot: 0 });
  });

  test("takes the one that's there", () => {
    expect(newestSave([null, slotText(1)])).toEqual({ save: saveFile(1), slot: 1 });
    expect(newestSave([slotText(1), null])).toEqual({ save: saveFile(1), slot: 0 });
  });

  test("finds none when neither reads back", () => {
    expect(newestSave([null, null])).toBeNull();
    expect(newestSave(["{", "not json"])).toBeNull();
  });
});
