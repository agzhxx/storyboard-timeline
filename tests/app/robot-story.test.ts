import { describe, expect, test } from "vitest";
import { buildRobotStory } from "../../src/app/robot-story.ts";
import { projectDuration } from "../../src/engine/project.ts";
import { formatTimecode } from "../../src/engine/time.ts";
import type { Asset } from "../../src/engine/types.ts";
import { inShotOrder } from "../../src/feed/feed-clip.ts";
import { trackOf } from "../engine/fixtures.ts";
import { invariantViolations } from "../../src/engine/invariants.ts";
import { DEMO_MUSIC, shotAsset, storyClips, testStory } from "./story.ts";

const SHOTS = [
  "01-wide",
  "02-medium",
  "03-closeup",
  "04-insert",
  "05-wide",
  "06-tracking",
  "07-medium",
  "08-closeup",
  "09-cutaway",
  "10-wide",
  "11-crane-up",
  "12-wide",
  "13-closeup",
  "14-medium",
  "15-wide",
];

/** The story's shots, in shot order, with another frame rate or length. */
function shots(change: Partial<Asset> = {}): Asset[] {
  return inShotOrder(storyClips()).map((item) => ({ ...shotAsset(item), ...change }));
}

describe("the robot story", () => {
  const story = testStory();

  test("puts the Feed's 15 story clips on V1 in shot order, though the Feed sends them newest first", () => {
    expect(storyClips().map((item) => item.shot)).not.toEqual(SHOTS);
    const v1 = trackOf(story, "V1").clips;
    expect(v1.map((clip) => story.assets[clip.assetId]?.name)).toEqual(SHOTS);
  });

  test("gives each shot its first 3 seconds, one after another", () => {
    trackOf(story, "V1").clips.forEach((clip, index) => {
      expect(clip).toMatchObject({ start: index * 72, in: 0, duration: 72 });
    });
  });

  test("lays the music on A1 under the whole cut, about 45 s, and leaves V2 empty", () => {
    expect(trackOf(story, "A1").clips).toEqual([
      { id: "demo-music", assetId: "demo-music", start: 0, in: 0, duration: 1_080 },
    ]);
    expect(trackOf(story, "V2").clips).toEqual([]);
    expect(story).toMatchObject({ name: "The robot story", fps: 24, width: 1920, height: 1080 });
    expect(formatTimecode(projectDuration(story), story.fps)).toBe("00:00:45:00");
  });

  test("keeps every rule of the document", () => {
    expect(invariantViolations(story)).toEqual([]);
  });
});

describe("the story's frame rate", () => {
  test.each([
    [24, 24],
    [25, 25],
    [30, 30],
    [23.976, 24],
    [29.97, 30],
    [60, 30],
  ])("is the first file's: %s fps makes a %s fps project", (fileFps, projectFps) => {
    const story = buildRobotStory({
      projectId: "s",
      shots: shots({ fps: fileFps }),
      music: DEMO_MUSIC,
    });
    expect(story.fps).toBe(projectFps);
    // Each shot is still its first 3 seconds, at the project's rate.
    expect(trackOf(story, "V1").clips[1]).toMatchObject({
      start: 3 * projectFps,
      duration: 3 * projectFps,
    });
    expect(projectDuration(story)).toBe(45 * projectFps);
  });

  test("comes from the first shot alone", () => {
    const [first, ...rest] = shots();
    if (!first) throw new Error("No shots");
    const story = buildRobotStory({
      projectId: "s",
      shots: [{ ...first, fps: 25 }, ...rest],
      music: DEMO_MUSIC,
    });
    expect(story.fps).toBe(25);
  });

  test("is 30 when the first file has no steady rate", () => {
    const [first, ...rest] = shots();
    if (!first) throw new Error("No shots");
    const { fps, ...withoutRate } = first;
    expect(fps).toBe(24);
    const story = buildRobotStory({
      projectId: "s",
      shots: [withoutRate, ...rest],
      music: DEMO_MUSIC,
    });
    expect(story.fps).toBe(30);
  });
});

describe("shorter media", () => {
  test("a shot shorter than 3 s goes in whole, and the next one starts after it", () => {
    const list = shots();
    list[1] = { ...(list[1] as Asset), durationSec: 2 };
    const story = buildRobotStory({ projectId: "s", shots: list, music: DEMO_MUSIC });
    const v1 = trackOf(story, "V1").clips;
    expect(v1[1]).toMatchObject({ start: 72, duration: 48 });
    expect(v1[2]).toMatchObject({ start: 120, duration: 72 });
    expect(trackOf(story, "A1").clips[0]?.duration).toBe(projectDuration(story));
  });

  test("music shorter than the cut keeps its own length", () => {
    const story = buildRobotStory({
      projectId: "s",
      shots: shots(),
      music: { ...DEMO_MUSIC, durationSec: 30 },
    });
    expect(trackOf(story, "A1").clips[0]).toMatchObject({ start: 0, duration: 720 });
    expect(projectDuration(story)).toBe(1_080);
  });

  test("a story whose shots have no frames is refused", () => {
    expect(() =>
      buildRobotStory({ projectId: "s", shots: shots({ durationSec: 0 }), music: DEMO_MUSIC }),
    ).toThrow("None of the story's shots");
  });
});
