import { describe, expect, test } from "vitest";
import { createProject } from "../../src/engine/project.ts";
import { snap, snapCandidates, snapClip, snapThreshold } from "../../src/engine/snapping.ts";
import { storyProject } from "./fixtures.ts";

// V1 holds a at 0–72 and b at 96–168; the music on A1 runs 0–1080.
const story = storyProject();

describe("snapThreshold", () => {
  test("is 8 px in frames at the current zoom", () => {
    expect(snapThreshold(2)).toBe(4); // the design's default zoom, 2 px per frame
    expect(snapThreshold(24)).toBe(1 / 3);
    expect(snapThreshold(0.5)).toBe(16);
  });
});

describe("snap", () => {
  test("snaps to the closest candidate within the threshold", () => {
    expect(snap(98, [0, 96, 168], 4)).toBe(96);
    expect(snap(101.5, [0, 96, 104], 4)).toBe(104);
  });

  test("snaps from a pointer between frames to a whole frame", () => {
    expect(snap(95.6, [96], 4)).toBe(96);
  });

  test("snaps at exactly the threshold, and not beyond it", () => {
    expect(snap(100, [96], 4)).toBe(96);
    expect(snap(100.01, [96], 4)).toBeNull();
    expect(snap(91.99, [96], 4)).toBeNull();
  });

  test("returns null when nothing is close enough", () => {
    expect(snap(50, [0, 96], 4)).toBeNull();
    expect(snap(50, [], 4)).toBeNull();
  });

  test("on a tie, the earlier frame wins, whatever the order of the list", () => {
    expect(snap(100, [104, 96], 4)).toBe(96);
    expect(snap(100, [96, 104], 4)).toBe(96);
  });

  test("snaps an edge exactly 8 px away at any zoom, despite float error", () => {
    // At 3 px per frame, a pointer at 14 px is 8 px past frame 2, but 14 / 3 − 2 comes out as
    // 2.666666666666667 frames, a hair over the 2.6666666666666665 that 8 px makes.
    expect(snap(14 / 3, [2], snapThreshold(3))).toBe(2);
    expect(snap(14.1 / 3, [2], snapThreshold(3))).toBeNull();
  });

  test("keeps a tie a tie when the pointer's frame carries float error", () => {
    // At 0.3 px per frame, 2.1 px is halfway between frames 5 and 9, but 2.1 / 0.3 is
    // 7.000000000000001, which looks a little closer to 9.
    expect(snap(2.1 / 0.3, [5, 9], snapThreshold(0.3))).toBe(5);
  });
});

describe("snapCandidates", () => {
  test("lists 0, the playhead and both edges of every clip on every track, sorted", () => {
    expect(snapCandidates(story, { playhead: 462 })).toEqual([0, 72, 96, 168, 462, 1_080]);
  });

  test("leaves out the clips being moved", () => {
    expect(snapCandidates(story, { playhead: 462, exclude: ["b"] })).toEqual([0, 72, 462, 1_080]);
    expect(snapCandidates(story, { playhead: 462, exclude: ["a", "b", "m"] })).toEqual([0, 462]);
  });

  test("lists each frame once", () => {
    expect(snapCandidates(story, { playhead: 96 })).toEqual([0, 72, 96, 168, 1_080]);
  });

  test("still has 0 and the playhead when there are no clips", () => {
    expect(snapCandidates(createProject({ id: "empty" }), { playhead: 30 })).toEqual([0, 30]);
  });
});

describe("snapClip", () => {
  // The edges a dragged clip can meet: 0, a's end, b's start and end, and the playhead.
  const candidates = [0, 72, 96, 168, 462];

  test("snaps by its start when only the start is close", () => {
    expect(snapClip(97, 48, candidates, 4)).toEqual({ start: 96, at: 96 });
  });

  test("snaps by its end when only the end is close", () => {
    // The end edge lands at 166.5, 1.5 frames before 168, so the clip starts at 168 − 48.
    expect(snapClip(118.5, 48, candidates, 4)).toEqual({ start: 120, at: 168 });
  });

  test("snaps by whichever edge is closer", () => {
    // A 71-frame clip: at 97.5 its end (168.5) is closer to 168 than its start is to 96.
    expect(snapClip(97.5, 71, candidates, 4)).toEqual({ start: 97, at: 168 });
    expect(snapClip(96.4, 71, candidates, 4)).toEqual({ start: 96, at: 96 });
  });

  test("on a tie, the start edge wins", () => {
    // A 72-frame clip at 99: its start is 3 past 96, and its end is 3 past 168.
    expect(snapClip(99, 72, candidates, 4)).toEqual({ start: 96, at: 96 });
    // The same tie through pixel math: at 3 px per frame, 281 px makes the end look a little
    // closer than the start.
    expect(snapClip(281 / 3, 72, candidates, snapThreshold(3))).toEqual({ start: 96, at: 96 });
  });

  test("returns null when neither edge is close enough", () => {
    expect(snapClip(300, 48, candidates, 4)).toBeNull();
    expect(snapClip(97, 48, candidates, 0.5)).toBeNull();
  });
});
