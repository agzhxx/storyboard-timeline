// The export's frame schedule (spec sections 4.7 and 5): for output frame n, which clip and source
// time each video track shows, bottom first; and each clip's one forward decode pass. Written
// before the code, so the schedule can be rewritten by hand against them.

import { describe, expect, test } from "vitest";
import { decodePasses, frameSchedule } from "../../src/engine/export-schedule.ts";
import { createProject } from "../../src/engine/project.ts";
import { SOURCE_TOLERANCE_SEC } from "../../src/engine/time.ts";
import type { Asset, Fps, Project } from "../../src/engine/types.ts";
import { clip, videoAsset, withClips } from "./fixtures.ts";

/** Where frame `sourceFrame` of a clip's source is looked up, at the project's rate. */
const at = (sourceFrame: number, fps: Fps = 24) => sourceFrame / fps + SOURCE_TOLERANCE_SEC;

/**
 * At 24 fps, 168 frames long:
 *   V2  o: 48–71 (source 0–23) · p: 120–167 (source 12–59)
 *   V1  a: 0–71 (source 0–71) · gap 72–95 · b: 96–143 (source 36–83, trimmed at its start)
 *   A1  m: 0–167
 */
function cut(): Project {
  const project = createProject({
    id: "cut",
    fps: 24,
    assets: [
      videoAsset("a"),
      videoAsset("b"),
      videoAsset("o"),
      videoAsset("p"),
      { ...videoAsset("m", 60), kind: "audio" },
    ],
  });
  return withClips(project, {
    V2: [
      clip("o", "o", { start: 48, duration: 24 }),
      clip("p", "p", { start: 120, in: 12, duration: 48 }),
    ],
    V1: [
      clip("a", "a", { start: 0, duration: 72 }),
      clip("b", "b", { start: 96, in: 36, duration: 48 }),
    ],
    A1: [clip("m", "m", { start: 0, duration: 168 })],
  });
}

describe("frameSchedule", () => {
  test("a frame shows its clip's source time, in + (n − start), looked up 1 ms after it starts", () => {
    expect(frameSchedule(cut(), 10)).toEqual([
      { trackId: "V1", clipId: "a", assetId: "a", seconds: at(10) },
    ]);
  });

  test("V2 draws over V1: its layer comes after V1's, bottom first", () => {
    expect(frameSchedule(cut(), 50)).toEqual([
      { trackId: "V1", clipId: "a", assetId: "a", seconds: at(50) },
      { trackId: "V2", clipId: "o", assetId: "o", seconds: at(2) },
    ]);
  });

  test("a gap on every video track is a black frame: no layers", () => {
    expect(frameSchedule(cut(), 72)).toEqual([]);
    expect(frameSchedule(cut(), 95)).toEqual([]);
  });

  test("a gap on V1 under a V2 clip shows V2 alone", () => {
    const project = withClips(cut(), {
      V2: [clip("o", "o", { start: 80, duration: 24 })],
    });
    expect(frameSchedule(project, 85)).toEqual([
      { trackId: "V2", clipId: "o", assetId: "o", seconds: at(5) },
    ]);
  });

  test("music on A1 is never a picture", () => {
    expect(frameSchedule(cut(), 72).map((layer) => layer.trackId)).not.toContain("A1");
  });

  test("a clip trimmed at its start shows its in point first, and its last frame before its out point", () => {
    expect(frameSchedule(cut(), 96)).toEqual([
      { trackId: "V1", clipId: "b", assetId: "b", seconds: at(36) },
    ]);
    expect(frameSchedule(cut(), 143)).toEqual([
      { trackId: "V1", clipId: "b", assetId: "b", seconds: at(83) },
      { trackId: "V2", clipId: "p", assetId: "p", seconds: at(35) },
    ]);
  });

  test("at a cut, the frame before shows the clip ending and the frame after the clip starting", () => {
    const project = withClips(cut(), {
      V1: [
        clip("a", "a", { start: 0, duration: 72 }),
        clip("b", "b", { start: 72, in: 36, duration: 48 }),
      ],
    });
    expect(frameSchedule(project, 71)[0]).toMatchObject({ clipId: "a", seconds: at(71) });
    expect(frameSchedule(project, 72)[0]).toMatchObject({ clipId: "b", seconds: at(36) });
  });

  test("the first and last frames of the cut, and nothing past its end", () => {
    expect(frameSchedule(cut(), 0)).toEqual([
      { trackId: "V1", clipId: "a", assetId: "a", seconds: at(0) },
    ]);
    expect(frameSchedule(cut(), 167)).toEqual([
      { trackId: "V2", clipId: "p", assetId: "p", seconds: at(59) },
    ]);
    expect(frameSchedule(cut(), 168)).toEqual([]);
  });

  test("an empty project's first frame is black", () => {
    expect(frameSchedule(createProject({ id: "empty" }), 0)).toEqual([]);
  });

  test("a clip whose asset is missing shows nothing", () => {
    const project = withClips(cut(), { V1: [clip("x", "nowhere", { start: 0, duration: 24 })] });
    expect(frameSchedule(project, 5)).toEqual([]);
  });

  describe("a clip at another frame rate", () => {
    /** The source frame a decoder shows for a time: the last one starting at or before it. */
    const shown = (seconds: number, sourceFps: number) => Math.floor(seconds * sourceFps);

    function onlyClip(fps: Fps, asset: Asset): Project {
      const project = createProject({ id: "rates", fps, assets: [asset] });
      return withClips(project, { V1: [clip("c", asset.id, { start: 0, duration: 60 })] });
    }

    test("a 30 fps source in a 24 fps cut skips every fifth source frame", () => {
      const project = onlyClip(24, { ...videoAsset("thirty"), fps: 30 });
      const frames = Array.from({ length: 8 }, (_, n) =>
        shown(frameSchedule(project, n)[0]?.seconds ?? Number.NaN, 30),
      );
      expect(frames).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    });

    test("a 24 fps source in a 30 fps cut shows every fourth source frame twice", () => {
      const project = onlyClip(30, videoAsset("twenty-four"));
      const frames = Array.from({ length: 10 }, (_, n) =>
        shown(frameSchedule(project, n)[0]?.seconds ?? Number.NaN, 24),
      );
      expect(frames).toEqual([0, 0, 1, 2, 3, 4, 4, 5, 6, 7]);
    });

    test("a WebM's times, rounded to the millisecond, still find each frame at 30 fps", () => {
      // WebM stores frame 2 at 30 fps (66.67 ms) as 67 ms: still at or before the lookup.
      const project = onlyClip(30, { ...videoAsset("webm"), fps: 30 });
      for (let n = 0; n < 30; n += 1) {
        const stored = Math.round((n / 30) * 1000) / 1000;
        const next = Math.round(((n + 1) / 30) * 1000) / 1000;
        const seconds = frameSchedule(project, n)[0]?.seconds ?? Number.NaN;
        expect(stored).toBeLessThanOrEqual(seconds);
        expect(next).toBeGreaterThan(seconds);
      }
    });
  });
});

describe("decodePasses", () => {
  test("each video track's clips in timeline order, bottom first, each read once from its in point to its out point", () => {
    expect(decodePasses(cut())).toEqual([
      {
        trackId: "V1",
        passes: [
          { clipId: "a", assetId: "a", fromSec: at(0), toSec: 72 / 24 - SOURCE_TOLERANCE_SEC },
          { clipId: "b", assetId: "b", fromSec: at(36), toSec: 84 / 24 - SOURCE_TOLERANCE_SEC },
        ],
      },
      {
        trackId: "V2",
        passes: [
          { clipId: "o", assetId: "o", fromSec: at(0), toSec: 24 / 24 - SOURCE_TOLERANCE_SEC },
          { clipId: "p", assetId: "p", fromSec: at(12), toSec: 60 / 24 - SOURCE_TOLERANCE_SEC },
        ],
      },
    ]);
  });

  test("every source time the schedule asks for falls inside its clip's pass, in order", () => {
    const project = cut();
    const passes = new Map(
      decodePasses(project).flatMap(({ passes: list }) => list.map((pass) => [pass.clipId, pass])),
    );
    const last = new Map<string, number>();
    for (let n = 0; n < 168; n += 1) {
      for (const layer of frameSchedule(project, n)) {
        const pass = passes.get(layer.clipId);
        expect(pass).toBeDefined();
        expect(layer.seconds).toBeGreaterThanOrEqual(pass?.fromSec ?? Number.NaN);
        expect(layer.seconds).toBeLessThan(pass?.toSec ?? Number.NaN);
        expect(layer.seconds).toBeGreaterThan(last.get(layer.clipId) ?? -1);
        last.set(layer.clipId, layer.seconds);
      }
    }
  });

  test("tracks with no clips, and clips whose asset is missing, are left out", () => {
    const project = withClips(cut(), {
      V2: [],
      V1: [clip("x", "nowhere", { start: 0, duration: 24 }), clip("a", "a", { start: 24 })],
    });
    expect(decodePasses(project)).toEqual([
      {
        trackId: "V1",
        passes: [{ clipId: "a", assetId: "a", fromSec: at(0), toSec: 1 - SOURCE_TOLERANCE_SEC }],
      },
    ]);
  });
});
