import { describe, expect, test } from "vitest";
import { snapCandidates, snapThreshold } from "../../src/engine/snapping.ts";
import type { Track } from "../../src/engine/types.ts";
import { previewDrop, previewMove, previewTrim } from "../../src/timeline/previews.ts";
import { clip, storyProject, trackOf } from "../engine/fixtures.ts";

// The story fixture at 24 fps: V1 has a 0–71 and b 96–167 (in 36), A1 the music 0–1079.
const project = storyProject();
const v1 = trackOf(project, "V1");
const v2 = trackOf(project, "V2");
const b = v1.clips[1] ?? clip("b", "07-medium");
// At 2 px per frame, 8 px is 4 frames.
const threshold = snapThreshold(2);
const candidatesFor = (clipId: string, playhead = 600) =>
  snapCandidates(project, { playhead, exclude: [clipId] });

describe("previewMove along the clip's own track", () => {
  const move = (proposed: number, snapping = true) =>
    previewMove({
      clip: b,
      from: v1,
      to: v1,
      proposed,
      pointerFrame: Math.floor(proposed),
      candidates: candidatesFor(b.id),
      threshold: snapping ? threshold : null,
    });

  test("follows the pointer to the nearest frame between the neighbors", () => {
    expect(move(110.4, false)).toEqual({ trackId: "V1", start: 110, fits: true, snapAt: null });
    expect(move(110.6, false).start).toBe(111);
  });

  test("snaps an edge within 8 px to another clip's edge, and shows where", () => {
    // b's start lands 3 frames after a's end (72): it snaps there.
    expect(move(75)).toEqual({ trackId: "V1", start: 72, fits: true, snapAt: 72 });
  });

  test("doesn't snap with Alt held", () => {
    expect(move(75, false)).toEqual({ trackId: "V1", start: 75, fits: true, snapAt: null });
  });

  test("stops at the previous clip's end, with no snap line when the stop moved it", () => {
    expect(move(40)).toEqual({ trackId: "V1", start: 72, fits: true, snapAt: null });
  });
});

describe("previewMove to the other video track", () => {
  const moveToV2 = (proposed: number, pointerFrame: number, snapping = true) =>
    previewMove({
      clip: b,
      from: v1,
      to: v2,
      proposed,
      pointerFrame,
      candidates: candidatesFor(b.id),
      threshold: snapping ? threshold : null,
    });

  test("lands anywhere on an empty track, snapping to edges on other tracks", () => {
    expect(moveToV2(200, 230, false)).toEqual({
      trackId: "V2",
      start: 200,
      fits: true,
      snapAt: null,
    });
    // a's end (72) is 2 frames from the proposed start.
    expect(moveToV2(70, 100)).toEqual({ trackId: "V2", start: 72, fits: true, snapAt: 72 });
  });

  test("is refused where there's no room, and stays where the pointer put it", () => {
    const crowded: Track = {
      ...v1,
      id: "V2",
      clips: [clip("x", "08-closeup", { start: 0, duration: 100 })],
    };
    const refused = previewMove({
      clip: b,
      from: v1,
      to: crowded,
      proposed: 40,
      pointerFrame: 50,
      candidates: [],
      threshold: null,
    });
    expect(refused).toEqual({ trackId: "V2", start: 40, fits: false, snapAt: null });
  });
});

describe("previewTrim", () => {
  const trim = (edge: "start" | "end", proposed: number, snapping = true, target = b) =>
    previewTrim({
      clip: target,
      track: v1,
      edge,
      proposed,
      sourceFrames: 120,
      candidates: candidatesFor(target.id),
      threshold: snapping ? threshold : null,
    });

  test("moves the start, keeping the end", () => {
    expect(trim("start", 110.2, false)).toEqual({
      start: 110,
      duration: 58,
      limit: null,
      snapAt: null,
    });
  });

  test("snaps the dragged edge, and stops at a neighbor", () => {
    expect(trim("start", 74)).toEqual({ start: 72, duration: 96, limit: "neighbor", snapAt: 72 });
    expect(trim("start", 50)).toEqual({ start: 72, duration: 96, limit: "neighbor", snapAt: null });
  });

  test("stops the end at the source's last frame", () => {
    // b uses source frames 36–107 of 120, so its end can reach 180 and no further.
    expect(trim("end", 230, false)).toEqual({
      start: 96,
      duration: 84,
      limit: "source",
      snapAt: null,
    });
  });

  test("leaves at least one frame", () => {
    expect(trim("end", 20, false)).toEqual({
      start: 96,
      duration: 1,
      limit: "one-frame",
      snapAt: null,
    });
  });
});

describe("previewDrop", () => {
  test("puts a new clip in the gap under the pointer, snapped", () => {
    expect(
      previewDrop({
        track: v1,
        duration: 20,
        proposed: 74,
        pointerFrame: 74,
        candidates: snapCandidates(project, { playhead: 600 }),
        threshold,
      }),
    ).toEqual({ trackId: "V1", start: 72, fits: true, snapAt: 72 });
  });

  test("is refused when the gap is too short", () => {
    expect(
      previewDrop({
        track: v1,
        duration: 40,
        proposed: 74,
        pointerFrame: 74,
        candidates: [],
        threshold: null,
      }),
    ).toEqual({ trackId: "V1", start: 74, fits: false, snapAt: null });
  });
});
