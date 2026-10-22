import { describe, expect, test } from "vitest";
import {
  addClip,
  type CommandResult,
  deleteClips,
  moveClip,
  split,
  trimEnd,
  trimStart,
} from "../../src/engine/commands.ts";
import { findClip } from "../../src/engine/project.ts";
import { sourceFrameAt } from "../../src/engine/time.ts";
import type { Clip, Project } from "../../src/engine/types.ts";
import { clip, frozen, storyProject, trackOf, videoAsset, withClips } from "./fixtures.ts";
import { invariantViolations } from "../../src/engine/invariants.ts";

// Frozen, so a command that changed its input in place would throw instead of passing.
//   V2  (empty)
//   V1  a: 06-tracking 0–71 · gap 72–95 · b: 07-medium 96–167 (source frames 36–107)
//   A1  m: music 0–1079 (all 45 s of it)
// Each video source is 120 frames long.
const story = frozen(storyProject());

/** The project a command returned, after checking it kept every rule. */
function edited(result: CommandResult): Project {
  if (!result.ok) throw new Error(`The edit failed: ${result.error.code}: ${result.error.message}`);
  expect(invariantViolations(result.project)).toEqual([]);
  return result.project;
}

/** Whether a command handed back the story itself, the same object, because nothing changed. */
function unchanged(result: CommandResult): boolean {
  return result.ok && result.project === story;
}

function clipsOn(project: Project, trackId: string): Clip[] {
  return trackOf(project, trackId).clips;
}

function clipById(project: Project, clipId: string): Clip | undefined {
  return findClip(project, clipId)?.clip;
}

describe("addClip", () => {
  test("places the whole source by default", () => {
    const project = edited(
      addClip(story, { clipId: "c", assetId: "08-closeup", trackId: "V2", start: 10 }),
    );

    expect(clipsOn(project, "V2")).toEqual([
      { id: "c", assetId: "08-closeup", start: 10, in: 0, duration: 120 },
    ]);
  });

  test("takes an in point and a length", () => {
    const project = edited(
      addClip(story, {
        clipId: "c",
        assetId: "08-closeup",
        trackId: "V2",
        start: 10,
        in: 12,
        duration: 24,
      }),
    );

    expect(clipById(project, "c")).toEqual({
      id: "c",
      assetId: "08-closeup",
      start: 10,
      in: 12,
      duration: 24,
    });
  });

  test("runs to the end of the source from the in point when no length is given", () => {
    const project = edited(
      addClip(story, { clipId: "c", assetId: "08-closeup", trackId: "V2", start: 0, in: 100 }),
    );

    expect(clipById(project, "c")?.duration).toBe(20);
  });

  test("fits a gap exactly and keeps the track sorted by start", () => {
    const project = edited(
      addClip(story, {
        clipId: "c",
        assetId: "08-closeup",
        trackId: "V1",
        start: 72,
        duration: 24,
      }),
    );

    expect(clipsOn(project, "V1").map((c) => c.id)).toEqual(["a", "c", "b"]);
  });

  test("won't overlap another clip", () => {
    const result = addClip(story, {
      clipId: "c",
      assetId: "08-closeup",
      trackId: "V1",
      start: 72,
      duration: 25,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "overlap", message: "That would overlap 07-medium on V1." },
    });
  });

  test("uses only frames its source has", () => {
    const pastTheEnd = addClip(story, {
      clipId: "c",
      assetId: "08-closeup",
      trackId: "V2",
      start: 0,
      in: 100,
      duration: 21,
    });
    const beforeTheStart = addClip(story, {
      clipId: "c",
      assetId: "08-closeup",
      trackId: "V2",
      start: 0,
      in: -1,
      duration: 10,
    });

    expect(pastTheEnd).toEqual({
      ok: false,
      error: {
        code: "outside-source",
        message: "That's past the end of 08-closeup, which is 00:00:05:00 long.",
      },
    });
    expect(beforeTheStart).toEqual({
      ok: false,
      error: { code: "outside-source", message: "That's before the start of 08-closeup." },
    });
  });

  test("has no frames to use from an in point at or past the end of its source", () => {
    const args = { clipId: "c", assetId: "08-closeup", trackId: "V2", start: 0 };
    const pastTheEnd = {
      ok: false,
      error: {
        code: "outside-source",
        message: "That's past the end of 08-closeup, which is 00:00:05:00 long.",
      },
    };

    expect(addClip(story, { ...args, in: 120 })).toEqual(pastTheEnd);
    expect(addClip(story, { ...args, in: 130 })).toEqual(pastTheEnd);
  });

  test("refuses a source whose duration isn't a real length, without throwing", () => {
    const project = { ...story, assets: { ...story.assets, broken: videoAsset("broken", -1) } };
    const args = { clipId: "c", assetId: "broken", trackId: "V2", start: 0, duration: 1 };

    expect(addClip(project, args)).toEqual({
      ok: false,
      error: {
        code: "outside-source",
        message: "That's past the end of broken, which is 00:00:00:00 long.",
      },
    });
  });

  test("is at least one frame long", () => {
    const empty = addClip(story, {
      clipId: "c",
      assetId: "08-closeup",
      trackId: "V2",
      start: 0,
      duration: 0,
    });

    expect(empty).toEqual({
      ok: false,
      error: { code: "too-short", message: "A clip can't be shorter than one frame." },
    });
  });

  test("goes only on a track of its asset's kind", () => {
    const musicOnV1 = addClip(story, { clipId: "c", assetId: "music", trackId: "V1", start: 200 });
    const videoOnA1 = addClip(story, {
      clipId: "c",
      assetId: "08-closeup",
      trackId: "A1",
      start: 1_100,
    });

    expect(musicOnV1).toEqual({
      ok: false,
      error: { code: "wrong-track-kind", message: "music is audio, and V1 is a video track." },
    });
    expect(videoOnA1).toMatchObject({ ok: false, error: { code: "wrong-track-kind" } });
  });

  test("starts at frame 0 or later", () => {
    expect(
      addClip(story, { clipId: "c", assetId: "08-closeup", trackId: "V2", start: -1 }),
    ).toEqual({
      ok: false,
      error: { code: "before-timeline-start", message: "A clip can't start before 00:00:00:00." },
    });
  });

  test("takes whole frames only", () => {
    const notWhole = {
      ok: false,
      error: { code: "not-whole-frames", message: "Positions and lengths must be whole frames." },
    };
    const args = { clipId: "c", assetId: "08-closeup", trackId: "V2", start: 0 };

    expect(addClip(story, { ...args, start: 10.5 })).toEqual(notWhole);
    expect(addClip(story, { ...args, in: 0.5 })).toEqual(notWhole);
    expect(addClip(story, { ...args, duration: 23.9 })).toEqual(notWhole);
    expect(addClip(story, { ...args, start: Number.NaN })).toEqual(notWhole);
    // A start that's fine on its own, but an end past 2^53 that can't be counted exactly.
    expect(addClip(story, { ...args, start: Number.MAX_SAFE_INTEGER - 10 })).toEqual(notWhole);
  });

  test("needs an asset and a track that exist, and a new clip id", () => {
    const args = { clipId: "c", assetId: "08-closeup", trackId: "V2", start: 0 };

    expect(addClip(story, { ...args, assetId: "nope" })).toEqual({
      ok: false,
      error: { code: "not-found", message: "There's no asset nope." },
    });
    expect(addClip(story, { ...args, assetId: "constructor" })).toEqual({
      ok: false,
      error: { code: "not-found", message: "There's no asset constructor." },
    });
    expect(addClip(story, { ...args, trackId: "V3" })).toEqual({
      ok: false,
      error: { code: "not-found", message: "There's no track V3." },
    });
    expect(addClip(story, { ...args, clipId: "a" })).toEqual({
      ok: false,
      error: { code: "duplicate-id", message: "There's already a clip a." },
    });
  });

  test("leaves the tracks it doesn't touch as they were", () => {
    const project = edited(
      addClip(story, { clipId: "c", assetId: "08-closeup", trackId: "V2", start: 0 }),
    );

    expect(trackOf(project, "V1")).toBe(trackOf(story, "V1"));
    expect(trackOf(project, "A1")).toBe(trackOf(story, "A1"));
    expect(project.assets).toBe(story.assets);
  });
});

describe("moveClip", () => {
  test("moves a clip along its track, keeping what it shows", () => {
    const project = edited(moveClip(story, { clipId: "b", start: 120 }));

    expect(clipById(project, "b")).toEqual({
      id: "b",
      assetId: "07-medium",
      start: 120,
      in: 36,
      duration: 72,
    });
  });

  test("can touch its neighbors", () => {
    const project = edited(moveClip(story, { clipId: "a", start: 24 }));

    expect(clipsOn(project, "V1").map((c) => [c.id, c.start])).toEqual([
      ["a", 24],
      ["b", 96],
    ]);
  });

  test("keeps the track sorted when a clip passes another", () => {
    const project = edited(moveClip(story, { clipId: "a", start: 200 }));

    expect(clipsOn(project, "V1").map((c) => c.id)).toEqual(["b", "a"]);
  });

  test("fits a gap exactly, but not a gap that's too small", () => {
    // V2 holds a one-second clip and one a frame longer; V1's gap at 72–95 is 24 frames.
    const project = withClips(story, {
      V2: [
        clip("fits", "08-closeup", { start: 0, duration: 24 }),
        clip("long", "08-closeup", { start: 300, duration: 25 }),
      ],
    });

    expect(moveClip(project, { clipId: "fits", start: 72, trackId: "V1" }).ok).toBe(true);
    expect(moveClip(project, { clipId: "long", start: 72, trackId: "V1" })).toEqual({
      ok: false,
      error: { code: "overlap", message: "That would overlap 07-medium on V1." },
    });
    expect(moveClip(project, { clipId: "long", start: 71, trackId: "V1" })).toEqual({
      ok: false,
      error: { code: "overlap", message: "That would overlap 06-tracking on V1." },
    });
  });

  test("is all or nothing: an overlap is an error, not a stop at the neighbor's edge", () => {
    expect(moveClip(story, { clipId: "a", start: 30 })).toMatchObject({
      ok: false,
      error: { code: "overlap" },
    });
  });

  test("leaves other clips of the same source alone", () => {
    // Two clips of 07-medium on V1; moving one mustn't touch the other.
    const project = withClips(story, {
      V1: [
        clip("first", "07-medium", { start: 0, duration: 24 }),
        clip("second", "07-medium", { start: 48, in: 24, duration: 24 }),
      ],
    });

    const moved = edited(moveClip(project, { clipId: "second", start: 60 }));

    expect(clipsOn(moved, "V1")).toEqual([
      clip("first", "07-medium", { start: 0, duration: 24 }),
      clip("second", "07-medium", { start: 60, in: 24, duration: 24 }),
    ]);
  });

  test("moves to the other video track", () => {
    const project = edited(moveClip(story, { clipId: "b", start: 96, trackId: "V2" }));

    expect(clipsOn(project, "V1").map((c) => c.id)).toEqual(["a"]);
    expect(clipsOn(project, "V2")).toEqual([clipById(story, "b")]);
  });

  test("won't move to a track of the other kind", () => {
    expect(moveClip(story, { clipId: "b", start: 96, trackId: "A1" })).toEqual({
      ok: false,
      error: { code: "wrong-track-kind", message: "07-medium is video, and A1 is an audio track." },
    });
    expect(moveClip(story, { clipId: "m", start: 0, trackId: "V2" })).toMatchObject({
      ok: false,
      error: { code: "wrong-track-kind" },
    });
  });

  test("starts at frame 0 or later", () => {
    expect(moveClip(story, { clipId: "a", start: -1 })).toMatchObject({
      ok: false,
      error: { code: "before-timeline-start" },
    });
  });

  test("takes whole frames only, for its end as well as its start", () => {
    expect(moveClip(story, { clipId: "b", start: 100.5 })).toMatchObject({
      ok: false,
      error: { code: "not-whole-frames" },
    });
    expect(moveClip(story, { clipId: "b", start: Number.MAX_SAFE_INTEGER })).toMatchObject({
      ok: false,
      error: { code: "not-whole-frames" },
    });
  });

  test("needs a clip and a track that exist", () => {
    expect(moveClip(story, { clipId: "nope", start: 0 })).toEqual({
      ok: false,
      error: { code: "not-found", message: "There's no clip nope." },
    });
    expect(moveClip(story, { clipId: "b", start: 96, trackId: "V9" })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });

  test("returns the same project when the clip stays where it is", () => {
    expect(unchanged(moveClip(story, { clipId: "b", start: 96 }))).toBe(true);
    expect(unchanged(moveClip(story, { clipId: "b", start: 96, trackId: "V1" }))).toBe(true);
  });
});

describe("trimStart", () => {
  test("moves the start and the in point together; the end stays put", () => {
    const project = edited(trimStart(story, { clipId: "b", start: 100 }));

    expect(clipById(project, "b")).toEqual({
      id: "b",
      assetId: "07-medium",
      start: 100,
      in: 40,
      duration: 68,
    });
  });

  test("extends to the left as far as the source and the neighbor allow", () => {
    // b's source starts 36 frames earlier, but a ends at 72, 24 frames before b.
    const project = edited(trimStart(story, { clipId: "b", start: 72 }));

    expect(clipById(project, "b")).toMatchObject({ start: 72, in: 12, duration: 96 });
    expect(trimStart(story, { clipId: "b", start: 71 })).toEqual({
      ok: false,
      error: { code: "overlap", message: "That would overlap 06-tracking on V1." },
    });
  });

  test("stops at the start of the source", () => {
    // c starts its source at frame 0, with room on the timeline before it.
    const project = withClips(story, {
      V2: [clip("c", "08-closeup", { start: 50, duration: 24 })],
    });

    expect(trimStart(project, { clipId: "c", start: 49 })).toEqual({
      ok: false,
      error: { code: "outside-source", message: "That's before the start of 08-closeup." },
    });
  });

  test("trims down to one frame, but not to none", () => {
    const project = edited(trimStart(story, { clipId: "b", start: 167 }));

    expect(clipById(project, "b")).toMatchObject({ start: 167, in: 107, duration: 1 });
    expect(trimStart(story, { clipId: "b", start: 168 })).toMatchObject({
      ok: false,
      error: { code: "too-short" },
    });
  });

  test("stops at the timeline's start", () => {
    expect(trimStart(story, { clipId: "a", start: -1 })).toMatchObject({
      ok: false,
      error: { code: "before-timeline-start" },
    });
  });

  test("takes whole frames and a clip that exists", () => {
    expect(trimStart(story, { clipId: "b", start: 99.5 })).toMatchObject({
      ok: false,
      error: { code: "not-whole-frames" },
    });
    expect(trimStart(story, { clipId: "nope", start: 0 })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });

  test("returns the same project when the start doesn't change", () => {
    expect(unchanged(trimStart(story, { clipId: "b", start: 96 }))).toBe(true);
  });
});

describe("trimEnd", () => {
  test("changes only the length", () => {
    const project = edited(trimEnd(story, { clipId: "b", end: 150 }));

    expect(clipById(project, "b")).toEqual({
      id: "b",
      assetId: "07-medium",
      start: 96,
      in: 36,
      duration: 54,
    });
  });

  test("extends to the end of the source, and no further", () => {
    // b shows source frames from 36; the source has 120, so b can be 84 frames long.
    const project = edited(trimEnd(story, { clipId: "b", end: 180 }));

    expect(clipById(project, "b")?.duration).toBe(84);
    expect(trimEnd(story, { clipId: "b", end: 181 })).toEqual({
      ok: false,
      error: {
        code: "outside-source",
        message: "That's past the end of 07-medium, which is 00:00:05:00 long.",
      },
    });
    expect(trimEnd(story, { clipId: "m", end: 1_081 })).toMatchObject({
      ok: false,
      error: { code: "outside-source" },
    });
  });

  test("stops at the next clip", () => {
    const project = edited(trimEnd(story, { clipId: "a", end: 96 }));

    expect(clipById(project, "a")?.duration).toBe(96);
    expect(trimEnd(story, { clipId: "a", end: 97 })).toEqual({
      ok: false,
      error: { code: "overlap", message: "That would overlap 07-medium on V1." },
    });
  });

  test("trims down to one frame, but not to none", () => {
    const project = edited(trimEnd(story, { clipId: "b", end: 97 }));

    expect(clipById(project, "b")).toMatchObject({ start: 96, in: 36, duration: 1 });
    expect(trimEnd(story, { clipId: "b", end: 96 })).toMatchObject({
      ok: false,
      error: { code: "too-short" },
    });
    expect(trimEnd(story, { clipId: "b", end: 90 })).toMatchObject({
      ok: false,
      error: { code: "too-short" },
    });
  });

  test("takes whole frames and a clip that exists", () => {
    expect(trimEnd(story, { clipId: "b", end: 150.25 })).toMatchObject({
      ok: false,
      error: { code: "not-whole-frames" },
    });
    expect(trimEnd(story, { clipId: "nope", end: 10 })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });

  test("returns the same project when the end doesn't change", () => {
    expect(unchanged(trimEnd(story, { clipId: "b", end: 168 }))).toBe(true);
  });
});

describe("split", () => {
  test("cuts a clip in two at a frame; the right half's in point is in + (at − start)", () => {
    const project = edited(split(story, { clipId: "b", at: 120, rightClipId: "b2" }));

    expect(clipsOn(project, "V1")).toEqual([
      clipById(story, "a"),
      { id: "b", assetId: "07-medium", start: 96, in: 36, duration: 24 },
      { id: "b2", assetId: "07-medium", start: 120, in: 60, duration: 48 },
    ]);
  });

  test("changes nothing on screen: every frame shows the source frame it showed before", () => {
    const before = clipById(story, "b");
    const project = edited(split(story, { clipId: "b", at: 130, rightClipId: "b2" }));
    const [left, right] = [clipById(project, "b"), clipById(project, "b2")];
    if (!before || !left || !right) throw new Error("Expected b, and b and b2 after the split");

    for (let frame = 96; frame < 168; frame++) {
      expect(sourceFrameAt(left, frame) ?? sourceFrameAt(right, frame)).toBe(
        sourceFrameAt(before, frame),
      );
    }
  });

  test("leaves the clips after it alone", () => {
    const project = edited(split(story, { clipId: "a", at: 30, rightClipId: "a2" }));

    expect(clipsOn(project, "V1").map((c) => [c.id, c.start, c.duration])).toEqual([
      ["a", 0, 30],
      ["a2", 30, 42],
      ["b", 96, 72],
    ]);
  });

  test("at a clip's last frame, leaves a one-frame right half", () => {
    const project = edited(split(story, { clipId: "b", at: 167, rightClipId: "b2" }));

    expect(clipById(project, "b")?.duration).toBe(71);
    expect(clipById(project, "b2")).toMatchObject({ start: 167, in: 107, duration: 1 });
  });

  test("at a clip's first frame or its end, there's nothing to split", () => {
    const nothing = {
      ok: false,
      error: {
        code: "nothing-to-split",
        message: "A split needs at least one frame of the clip on each side.",
      },
    };

    expect(split(story, { clipId: "b", at: 96, rightClipId: "b2" })).toEqual(nothing);
    expect(split(story, { clipId: "b", at: 168, rightClipId: "b2" })).toEqual(nothing);
    expect(split(story, { clipId: "b", at: 10, rightClipId: "b2" })).toEqual(nothing);
  });

  test("can't split a one-frame clip", () => {
    const project = withClips(story, {
      V2: [clip("one", "08-closeup", { start: 10, duration: 1 })],
    });

    expect(split(project, { clipId: "one", at: 10, rightClipId: "r" })).toMatchObject({
      ok: false,
      error: { code: "nothing-to-split" },
    });
    expect(split(project, { clipId: "one", at: 11, rightClipId: "r" })).toMatchObject({
      ok: false,
      error: { code: "nothing-to-split" },
    });
  });

  test("needs a new id for the right half", () => {
    expect(split(story, { clipId: "b", at: 120, rightClipId: "a" })).toEqual({
      ok: false,
      error: { code: "duplicate-id", message: "There's already a clip a." },
    });
    expect(split(story, { clipId: "b", at: 120, rightClipId: "b" })).toMatchObject({
      ok: false,
      error: { code: "duplicate-id" },
    });
  });

  test("takes whole frames and a clip that exists", () => {
    expect(split(story, { clipId: "b", at: 120.5, rightClipId: "b2" })).toMatchObject({
      ok: false,
      error: { code: "not-whole-frames" },
    });
    expect(split(story, { clipId: "nope", at: 120, rightClipId: "b2" })).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});

describe("deleteClips", () => {
  test("removes a clip and leaves a gap", () => {
    const project = edited(deleteClips(story, { clipIds: ["a"] }));

    expect(clipsOn(project, "V1")).toEqual([clipById(story, "b")]);
  });

  test("removes clips from several tracks at once", () => {
    const project = edited(deleteClips(story, { clipIds: ["a", "m"] }));

    expect(clipsOn(project, "V1").map((c) => c.id)).toEqual(["b"]);
    expect(clipsOn(project, "A1")).toEqual([]);
  });

  test("is all or nothing: an id that isn't there deletes nothing", () => {
    expect(deleteClips(story, { clipIds: ["a", "nope"] })).toEqual({
      ok: false,
      error: { code: "not-found", message: "There's no clip nope." },
    });
  });

  test("returns the same project for an empty list", () => {
    expect(unchanged(deleteClips(story, { clipIds: [] }))).toBe(true);
  });

  test("leaves the tracks it doesn't touch as they were", () => {
    const project = edited(deleteClips(story, { clipIds: ["b"] }));

    expect(trackOf(project, "V2")).toBe(trackOf(story, "V2"));
    expect(trackOf(project, "A1")).toBe(trackOf(story, "A1"));
  });
});
