import { describe, expect, test } from "vitest";
import {
  clipAt,
  clipEnd,
  createProject,
  findAsset,
  findClip,
  projectDuration,
} from "../../src/engine/project.ts";
import { audioAsset, clip, storyProject, trackOf, videoAsset } from "./fixtures.ts";

describe("createProject", () => {
  test("starts empty, with tracks V2, V1 and A1 from top to bottom", () => {
    const project = createProject({ id: "p1" });

    expect(project.tracks).toEqual([
      { id: "V2", kind: "video", clips: [] },
      { id: "V1", kind: "video", clips: [] },
      { id: "A1", kind: "audio", clips: [] },
    ]);
    expect(project.assets).toEqual({});
  });

  test("is an untitled project at 30 fps and 1920 × 1080 unless told otherwise", () => {
    expect(createProject({ id: "p1" })).toMatchObject({
      name: "Untitled project",
      fps: 30,
      width: 1920,
      height: 1080,
    });
    expect(createProject({ id: "p3", name: "The robot story" }).name).toBe("The robot story");
    expect(createProject({ id: "p2", fps: 24, width: 1280, height: 720 })).toMatchObject({
      fps: 24,
      width: 1280,
      height: 720,
    });
  });

  test("keeps the assets it's given, by id", () => {
    const wide = videoAsset("01-wide");
    const music = audioAsset("music");

    expect(createProject({ id: "p1", assets: [wide, music] }).assets).toEqual({
      "01-wide": wide,
      music,
    });
  });
});

describe("findAsset", () => {
  test("finds the project's own assets, and nothing else", () => {
    const project = storyProject();

    expect(findAsset(project, "07-medium")?.name).toBe("07-medium");
    expect(findAsset(project, "nope")).toBeUndefined();
    // Every plain object has these through its prototype.
    expect(findAsset(project, "constructor")).toBeUndefined();
    expect(findAsset(project, "__proto__")).toBeUndefined();
  });
});

describe("clipEnd", () => {
  test("is the first frame after the clip", () => {
    expect(clipEnd(clip("b", "07-medium", { start: 96, duration: 72 }))).toBe(168);
    expect(clipEnd(clip("one", "07-medium", { start: 10, duration: 1 }))).toBe(11);
  });
});

describe("findClip", () => {
  test("finds a clip on any track, with its track and position", () => {
    const project = storyProject();
    const v1 = trackOf(project, "V1");

    expect(findClip(project, "b")).toEqual({ clip: v1.clips[1], track: v1, index: 1 });
    expect(findClip(project, "m")?.track.id).toBe("A1");
  });

  test("returns undefined for an id that isn't there", () => {
    expect(findClip(storyProject(), "nope")).toBeUndefined();
  });
});

describe("clipAt", () => {
  // V1: a covers 0–71, a gap at 72–95, then b covers 96–167.
  const v1 = trackOf(storyProject(), "V1");

  test("finds the clip that covers a frame, first frame to last", () => {
    expect(clipAt(v1, 0)?.id).toBe("a");
    expect(clipAt(v1, 71)?.id).toBe("a");
    expect(clipAt(v1, 96)?.id).toBe("b");
    expect(clipAt(v1, 167)?.id).toBe("b");
  });

  test("finds nothing in a gap or after the last clip", () => {
    expect(clipAt(v1, 72)).toBeUndefined();
    expect(clipAt(v1, 95)).toBeUndefined();
    expect(clipAt(v1, 168)).toBeUndefined();
  });
});

describe("projectDuration", () => {
  test("is 0 for an empty project", () => {
    expect(projectDuration(createProject({ id: "p1" }))).toBe(0);
  });

  test("ends where the last clip on any track ends", () => {
    // The music on A1 runs to 1080, past V1's last clip at 168.
    expect(projectDuration(storyProject())).toBe(1_080);
  });
});
