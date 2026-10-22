import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { moveClip, trimEnd, trimStart } from "../../src/engine/commands.ts";
import {
  clampMoveInTrack,
  clampTrimEnd,
  clampTrimStart,
  gapAt,
  placeInGap,
  trimRange,
} from "../../src/engine/limits.ts";
import { createProject } from "../../src/engine/project.ts";
import type { Clip, Track } from "../../src/engine/types.ts";
import { clip, trackOf, videoAsset, withClips } from "./fixtures.ts";

/**
 * V1 at 24 fps, sources of 5 s (120 frames):
 *   a 0–71 (in 0) · gap 72–95 · b 96–167 (in 36) · gap 168–239 · c 240–311 (in 0) · open after
 */
const a = clip("a", "06-tracking", { start: 0, duration: 72 });
const b = clip("b", "07-medium", { start: 96, in: 36, duration: 72 });
const c = clip("c", "08-closeup", { start: 240, duration: 72 });
const v1: Track = { id: "V1", kind: "video", clips: [a, b, c] };
const SOURCE = 120;

describe("gapAt", () => {
  test("finds the free stretch around a frame", () => {
    expect(gapAt(v1, 80)).toEqual({ start: 72, end: 96 });
    expect(gapAt(v1, 72)).toEqual({ start: 72, end: 96 });
    expect(gapAt(v1, 95)).toEqual({ start: 72, end: 96 });
    expect(gapAt(v1, 312)).toEqual({ start: 312, end: Infinity });
  });

  test("finds none under a clip", () => {
    expect(gapAt(v1, 0)).toBeNull();
    expect(gapAt(v1, 167)).toBeNull();
    expect(gapAt(v1, 240)).toBeNull();
  });

  test("treats the clips left out as free space, and a frame before 0 as frame 0", () => {
    expect(gapAt(v1, 100, ["b"])).toEqual({ start: 72, end: 240 });
    expect(gapAt({ ...v1, clips: [b] }, -30)).toEqual({ start: 0, end: 96 });
    expect(gapAt({ ...v1, clips: [] }, 500)).toEqual({ start: 0, end: Infinity });
  });
});

describe("clampMoveInTrack: a clip dragged along its track stops at its neighbors", () => {
  test("moves freely between them", () => {
    expect(clampMoveInTrack(v1, b, 80)).toBe(80);
    expect(clampMoveInTrack(v1, b, 150)).toBe(150);
  });

  test("stops at the previous clip's end and the next clip's start", () => {
    expect(clampMoveInTrack(v1, b, 50)).toBe(72);
    expect(clampMoveInTrack(v1, b, 200)).toBe(240 - 72);
    // Dragged far past a neighbor, it still stops at that neighbor: it never jumps over one.
    expect(clampMoveInTrack(v1, b, 1_000)).toBe(168);
  });

  test("stops at frame 0, and the last clip can go as far right as it likes", () => {
    expect(clampMoveInTrack(v1, a, -40)).toBe(0);
    expect(clampMoveInTrack(v1, c, 5_000)).toBe(5_000);
  });
});

describe("placeInGap: a clip dragged to another track goes into the gap under the pointer", () => {
  test("lands where the pointer puts it when it fits there", () => {
    expect(placeInGap(v1, 20, 74, 80)).toBe(74);
    expect(placeInGap(v1, 72, 400, 420)).toBe(400);
  });

  test("is pushed inside the gap when it would stick out", () => {
    expect(placeInGap(v1, 20, 60, 80)).toBe(72);
    expect(placeInGap(v1, 20, 90, 94)).toBe(96 - 20);
    expect(placeInGap(v1, 50, 150, 200)).toBe(168);
  });

  test("is refused over a clip, or in a gap too short for it", () => {
    expect(placeInGap(v1, 20, 120, 130)).toBeNull();
    expect(placeInGap(v1, 25, 72, 80)).toBeNull();
  });

  test("ignores the clips left out, such as the one being moved", () => {
    expect(placeInGap(v1, 72, 100, 110, ["b"])).toBe(100);
  });
});

describe("clampTrimStart: the first frame stays inside the source, after the neighbor, before the end", () => {
  test("follows the pointer between the limits", () => {
    expect(clampTrimStart(v1, b, 80)).toEqual({ edge: 80, limit: null });
    expect(clampTrimStart(v1, b, 120)).toEqual({ edge: 120, limit: null });
  });

  test("stops at the source's first frame", () => {
    // b starts 36 frames into its source, so its start can go back to 96 − 36 = 60, but the
    // neighbor ends at 72 first. Without the neighbor, the source is the limit.
    expect(clampTrimStart(v1, b, 50)).toEqual({ edge: 72, limit: "neighbor" });
    const alone = { ...v1, clips: [b] };
    expect(clampTrimStart(alone, b, 50)).toEqual({ edge: 60, limit: "source" });
    expect(clampTrimStart(alone, b, 60)).toEqual({ edge: 60, limit: "source" });
  });

  test("stops at the timeline's start", () => {
    const late = clip("late", "07-medium", { start: 20, in: 100, duration: 20 });
    expect(clampTrimStart({ ...v1, clips: [late] }, late, -5)).toEqual({
      edge: 0,
      limit: "timeline-start",
    });
  });

  test("leaves at least one frame", () => {
    expect(clampTrimStart(v1, b, 167)).toEqual({ edge: 167, limit: "one-frame" });
    expect(clampTrimStart(v1, b, 400)).toEqual({ edge: 167, limit: "one-frame" });
  });
});

describe("clampTrimEnd: the end stays inside the source, before the neighbor, after the start", () => {
  test("follows the pointer between the limits", () => {
    expect(clampTrimEnd(v1, b, SOURCE, 150)).toEqual({ edge: 150, limit: null });
  });

  test("stops at the source's last frame", () => {
    // b uses source frames 36–107 of 120, so its end can go 12 frames further, to 180.
    expect(clampTrimEnd(v1, b, SOURCE, 200)).toEqual({ edge: 180, limit: "source" });
    expect(clampTrimEnd(v1, b, SOURCE, 180)).toEqual({ edge: 180, limit: "source" });
  });

  test("stops at the next clip's start", () => {
    expect(clampTrimEnd(v1, a, SOURCE, 110)).toEqual({ edge: 96, limit: "neighbor" });
  });

  test("leaves at least one frame", () => {
    expect(clampTrimEnd(v1, b, SOURCE, 90)).toEqual({ edge: 97, limit: "one-frame" });
  });
});

describe("trimRange: how far a handle's slider goes, and what holds it at each end", () => {
  test("a start goes back to the source's start or the neighbor, and up to one frame long", () => {
    // b starts at 96 with 36 frames of source before it, and a ends at 72: a's end binds first.
    expect(trimRange(v1, b, "start", SOURCE)).toEqual({
      min: 72,
      max: 167,
      minLimit: "neighbor",
      maxLimit: "one-frame",
    });
    // a has no source before it, and starts at the timeline's start: the source binds first.
    expect(trimRange(v1, a, "start", SOURCE)).toMatchObject({ min: 0, minLimit: "source" });
  });

  test("an end goes down to one frame long, and up to the source's end or the neighbor", () => {
    expect(trimRange(v1, b, "end", SOURCE)).toEqual({
      min: 97,
      max: 180,
      minLimit: "one-frame",
      maxLimit: "source",
    });
    expect(trimRange(v1, a, "end", SOURCE)).toMatchObject({ max: 96, maxLimit: "neighbor" });
  });

  test("a clip with the timeline's start before it and source to spare stops at frame 0", () => {
    const late = clip("late", "07-medium", { start: 10, in: 60, duration: 24 });
    const track: Track = { id: "V2", kind: "video", clips: [late] };
    expect(trimRange(track, late, "start", SOURCE)).toMatchObject({
      min: 0,
      minLimit: "timeline-start",
    });
  });
});

describe("the limits keep every gesture inside the rules", () => {
  const assets = ["s0", "s1", "s2"].map((name) => videoAsset(name));

  /** A random V1 of up to six clips in order, with random gaps, durations and in points. */
  const track = fc
    .array(
      fc.record({
        gap: fc.integer({ min: 0, max: 40 }),
        duration: fc.integer({ min: 1, max: 120 }),
        in: fc.integer({ min: 0, max: 119 }),
        asset: fc.integer({ min: 0, max: 2 }),
      }),
      { minLength: 1, maxLength: 6 },
    )
    .map((specs) => {
      let start = 0;
      return specs.map((spec, index): Clip => {
        start += spec.gap;
        const inPoint = Math.min(spec.in, SOURCE - spec.duration);
        const placed = clip(`c${index}`, `s${spec.asset}`, {
          start,
          in: inPoint,
          duration: spec.duration,
        });
        start += spec.duration;
        return placed;
      });
    });

  const project = (clips: Clip[]) =>
    withClips(createProject({ id: "p", fps: 24, assets }), { V1: clips });

  test("a clamped move, start trim or end trim is always one the commands accept", () => {
    fc.assert(
      fc.property(track, fc.nat(), fc.integer({ min: -200, max: 800 }), (clips, pick, to) => {
        const p = project(clips);
        const v = trackOf(p, "V1");
        const chosen = v.clips[pick % v.clips.length];
        if (!chosen) return;

        expect(moveClip(p, { clipId: chosen.id, start: clampMoveInTrack(v, chosen, to) }).ok).toBe(
          true,
        );
        const start = clampTrimStart(v, chosen, to).edge;
        expect(trimStart(p, { clipId: chosen.id, start }).ok).toBe(true);
        const end = clampTrimEnd(v, chosen, SOURCE, to).edge;
        expect(trimEnd(p, { clipId: chosen.id, end }).ok).toBe(true);
      }),
    );
  });

  test("a clip placed in a gap on another track is always a move the commands accept", () => {
    fc.assert(
      fc.property(
        track,
        fc.integer({ min: 1, max: 120 }),
        fc.integer({ min: -200, max: 800 }),
        fc.integer({ min: -200, max: 800 }),
        (clips, duration, to, pointer) => {
          // A clip on V2 dragged down onto the random V1.
          const moving = clip("moving", "s0", { start: 0, duration });
          const p = withClips(project(clips), { V2: [moving] });
          const start = placeInGap(trackOf(p, "V1"), duration, to, Math.max(0, pointer));
          if (start === null) return;
          expect(moveClip(p, { clipId: "moving", start, trackId: "V1" }).ok).toBe(true);
        },
      ),
    );
  });
});
