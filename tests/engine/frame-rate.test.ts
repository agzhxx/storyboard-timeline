// The project's frame rate: an empty project takes the rate of the first
// video placed on it, the nearest of 24, 25 and 30; once it has clips, the rate stays.

import { describe, expect, test } from "vitest";
import { placeAsset, setFrameRate } from "../../src/engine/commands.ts";
import { createProject } from "../../src/engine/project.ts";
import { createDocumentStore } from "../../src/engine/store.ts";
import { projectRateFor } from "../../src/engine/time.ts";
import type { Asset, Project } from "../../src/engine/types.ts";
import { audioAsset, frozen, storyProject } from "./fixtures.ts";
import { invariantViolations } from "../../src/engine/invariants.ts";

/** A video file from the media bin, 5 s long, at a frame rate. */
function videoFile(fps: number, id = `file-${fps}`): Asset {
  return {
    id,
    kind: "video",
    name: `${id}.mp4`,
    source: { type: "file", opfsPath: `assets/${id}/source.mp4` },
    durationSec: 5,
    width: 1920,
    height: 1080,
    fps,
  };
}

const empty = frozen(createProject({ id: "empty" }));

describe("projectRateFor", () => {
  test("takes the nearest of 24, 25 and 30", () => {
    expect(projectRateFor(23.976)).toBe(24);
    expect(projectRateFor(24)).toBe(24);
    expect(projectRateFor(25)).toBe(25);
    expect(projectRateFor(29.97)).toBe(30);
    expect(projectRateFor(30)).toBe(30);
    expect(projectRateFor(27)).toBe(25);
    expect(projectRateFor(33)).toBe(30);
    expect(projectRateFor(15)).toBe(24);
  });

  test("halves high rates first, so 50 → 25 and 59.94 or 60 → 30", () => {
    expect(projectRateFor(48)).toBe(24);
    expect(projectRateFor(50)).toBe(25);
    expect(projectRateFor(59.94)).toBe(30);
    expect(projectRateFor(60)).toBe(30);
    expect(projectRateFor(90)).toBe(30);
    expect(projectRateFor(100)).toBe(25);
    expect(projectRateFor(119.88)).toBe(30);
    expect(projectRateFor(240)).toBe(30);
  });

  test("gives a tie to the faster rate", () => {
    expect(projectRateFor(24.5)).toBe(25);
    expect(projectRateFor(27.5)).toBe(30);
  });

  test("has no rate for a rate that isn't real", () => {
    for (const rate of [0, -24, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(projectRateFor(rate)).toBeNull();
    }
  });
});

describe("setFrameRate", () => {
  test("changes an empty project's rate", () => {
    const result = setFrameRate(empty, { fps: 24 });
    expect(result.ok && result.project.fps).toBe(24);
  });

  test("hands back the same project when the rate is already that", () => {
    const result = setFrameRate(empty, { fps: 30 });
    expect(result.ok && result.project).toBe(empty);
  });

  test("refuses once the timeline has clips", () => {
    expect(setFrameRate(frozen(storyProject()), { fps: 30 })).toEqual({
      ok: false,
      error: {
        code: "has-clips",
        message: "The frame rate can't change once the timeline has clips.",
      },
    });
  });
});

describe("placeAsset", () => {
  function placed(project: Project, asset: Asset, trackId = "V1", start = 0): Project {
    const result = placeAsset(project, { asset, clipId: "new", trackId, start });
    if (!result.ok) throw new Error(result.error.message);
    expect(invariantViolations(result.project)).toEqual([]);
    return result.project;
  }

  test("adds a new asset and all of it as a clip", () => {
    const project = placed(empty, videoFile(30));

    expect(project.assets["file-30"]).toEqual(videoFile(30));
    expect(project.tracks[1]?.clips).toEqual([
      { id: "new", assetId: "file-30", start: 0, in: 0, duration: 150 },
    ]);
  });

  test("gives an empty project the first video's rate, and its length in those frames", () => {
    const project = placed(empty, videoFile(23.976));

    expect(project.fps).toBe(24);
    expect(project.tracks[1]?.clips[0]?.duration).toBe(120);
    expect(placed(empty, videoFile(50)).fps).toBe(25);
    expect(placed(empty, videoFile(59.94)).fps).toBe(30);
  });

  test("keeps the rate of a project that has clips", () => {
    const project = placed(frozen(storyProject()), videoFile(30), "V2", 0);

    expect(project.fps).toBe(24);
    // 5 s at the project's 24 fps.
    expect(project.tracks[0]?.clips[0]?.duration).toBe(120);
  });

  test("leaves the rate alone for music, and for a video with no known rate", () => {
    expect(placed(empty, audioAsset("music", 10), "A1").fps).toBe(30);
    expect(placed(empty, { ...videoFile(24), fps: undefined }).fps).toBe(30);
  });

  test("reuses an asset the project already has", () => {
    const once = placed(empty, videoFile(30));
    const result = placeAsset(once, {
      asset: videoFile(30),
      clipId: "again",
      trackId: "V2",
      start: 0,
    });

    expect(result.ok && result.project.assets).toBe(once.assets);
  });

  test("changes nothing when the clip can't go there, not even the rate", () => {
    const result = placeAsset(empty, {
      asset: videoFile(24),
      clipId: "new",
      trackId: "A1",
      start: 0,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "wrong-track-kind",
        message: "file-24.mp4 is video, and A1 is an audio track.",
      },
    });
  });
});

describe("the document store's placeAsset", () => {
  test("is one undo step, which takes back the clip, the asset and the rate", () => {
    const store = createDocumentStore(empty);

    const result = store.getState().placeAsset({ asset: videoFile(25), trackId: "V1", start: 0 });

    expect(result.ok).toBe(true);
    expect(store.getState().project.fps).toBe(25);
    expect(store.getState().lastEdit).toBe("add file-25.mp4");
    expect(store.temporal.getState().pastStates).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().project).toBe(empty);
  });
});
