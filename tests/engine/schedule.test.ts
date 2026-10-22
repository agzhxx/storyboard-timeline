import { describe, expect, test } from "vitest";
import { createProject } from "../../src/engine/project.ts";
import {
  dueUs,
  firstDueFrame,
  musicPlan,
  placeOnTimeline,
  videoPlan,
  type VideoRun,
} from "../../src/engine/schedule.ts";
import type { Asset, Project } from "../../src/engine/types.ts";
import { clip } from "./fixtures.ts";

function file(id: string, kind: "video" | "audio" = "video", durationSec = 10): Asset {
  return {
    id,
    kind,
    name: id,
    source: { type: "file", opfsPath: `assets/${id}/source.mp4` },
    durationSec,
  };
}

/**
 * At 24 fps:
 *   V2  c: 48–71 (source 24–47)
 *   V1  a: 0–47 (source 12–59) · f: a Feed clip 48–95 · b: 96–143
 *   A1  m: 24–263 (source 48–287) · n: 300–323
 */
function cut(): Project {
  const project = createProject({
    id: "p",
    fps: 24,
    assets: [
      file("a"),
      file("b"),
      file("c"),
      {
        ...file("f"),
        source: {
          type: "feed",
          itemId: "f",
          url: "https://media.example/originals/f.mp4",
          videoUrl: "https://media.example/m/f/v1/full.mp4",
          model: "Kling 2.5 Pro",
        },
      },
      file("m", "audio", 60),
      file("n", "audio", 60),
    ],
  });
  const [v2, v1, a1] = project.tracks;
  if (!v2 || !v1 || !a1) throw new Error("No tracks");
  v2.clips = [clip("c", "c", { start: 48, in: 24, duration: 24 })];
  v1.clips = [
    clip("a", "a", { start: 0, in: 12, duration: 48 }),
    clip("f", "f", { start: 48, duration: 48 }),
    clip("b", "b", { start: 96, duration: 48 }),
  ];
  a1.clips = [
    clip("m", "m", { start: 24, in: 48, duration: 240 }),
    clip("n", "n", { start: 300, duration: 24 }),
  ];
  return project;
}

const runIds = (project: Project, from: number) =>
  videoPlan(project, from).map(({ trackId, runs }) => [trackId, runs.map((run) => run.clipId)]);

describe("videoPlan", () => {
  test("each video track's clips from the start frame on, in order, files and Feed clips alike", () => {
    expect(runIds(cut(), 0)).toEqual([
      ["V2", ["c"]],
      ["V1", ["a", "f", "b"]],
    ]);
  });

  test("a clip under the start frame is included, and the ones before it aren't", () => {
    expect(runIds(cut(), 47)).toEqual([
      ["V2", ["c"]],
      ["V1", ["a", "f", "b"]],
    ]);
    expect(runIds(cut(), 48)).toEqual([
      ["V2", ["c"]],
      ["V1", ["f", "b"]],
    ]);
    expect(runIds(cut(), 72)).toEqual([["V1", ["f", "b"]]]);
    expect(runIds(cut(), 96)).toEqual([["V1", ["b"]]]);
    expect(runIds(cut(), 144)).toEqual([]);
  });

  test("a file is decoded from its copy in storage, a Feed clip from the Feed's 720p file", () => {
    const [, v1] = videoPlan(cut(), 0);
    expect(v1?.runs.map((run) => run.location)).toEqual([
      { type: "file", opfsPath: "assets/a/source.mp4" },
      { type: "url", url: "https://media.example/m/f/v1/full.mp4" },
      { type: "file", opfsPath: "assets/b/source.mp4" },
    ]);
  });

  test("a run starts where playback starts inside its clip, and decodes from the frame shown there", () => {
    const [, v1] = videoPlan(cut(), 10);
    const a = v1?.runs[0];
    expect(a).toMatchObject({
      clipId: "a",
      assetId: "a",
      location: { type: "file", opfsPath: "assets/a/source.mp4" },
      startUs: 416_667,
      endUs: 2_000_000,
      offsetUs: -500_000,
    });
    // Source frame 22 (12 + 10) starts at 0.916667 s; looked up a millisecond after it. The clip's
    // out point, source frame 60, is 2.5 s: decoding stops a millisecond before it.
    expect(a?.fromSec).toBeCloseTo(22 / 24 + 0.001, 9);
    expect(a?.toSec).toBeCloseTo(60 / 24 - 0.001, 9);
  });

  test("a later clip's run starts at its own start", () => {
    const [, v1] = videoPlan(cut(), 10);
    expect(v1?.runs[2]).toMatchObject({ clipId: "b", startUs: 4_000_000, endUs: 6_000_000 });
    expect(v1?.runs[2]?.fromSec).toBeCloseTo(0.001, 9);
  });
});

describe("placeOnTimeline", () => {
  const run: VideoRun = {
    clipId: "a",
    assetId: "a",
    location: { type: "file", opfsPath: "assets/a/source.mp4" },
    startUs: 416_667,
    endUs: 2_000_000,
    fromSec: 22 / 24 + 0.001,
    toSec: 60 / 24 - 0.001,
    offsetUs: -500_000,
  };

  test("a source frame shows at its source time plus the clip's offset, until the next one", () => {
    // Source frame 30 (1.25 s) is timeline frame 18 (0.75 s).
    expect(placeOnTimeline(run, { timestamp: 1.25, duration: 1 / 24 })).toEqual({
      presentUs: 750_000,
      endUs: 791_667,
    });
  });

  test("the frame showing where the run starts shows from its start", () => {
    // Source frame 22 starts before the run does in a 25 fps source: it still shows at once.
    expect(placeOnTimeline(run, { timestamp: 0.9, duration: 0.04 }).presentUs).toBe(416_667);
  });

  test("a frame without a length lasts until the clip ends; none outlasts it", () => {
    expect(placeOnTimeline(run, { timestamp: 2.4, duration: 0 }).endUs).toBe(2_000_000);
    expect(placeOnTimeline(run, { timestamp: 2.4, duration: 1 }).endUs).toBe(2_000_000);
  });

  test("the frame due at a timeline frame: one placed at or before its start plus 1 ms", () => {
    expect(dueUs(18, 24)).toBe(751_000);
    // A WebM frame stored half a millisecond late still comes due on its frame.
    const late = placeOnTimeline(run, { timestamp: 1.2505, duration: 1 / 24 });
    expect(late.presentUs).toBeLessThanOrEqual(dueUs(18, 24));
  });
});

describe("firstDueFrame", () => {
  test.each([24, 25, 30] as const)("is dueUs's inverse, frame for frame (%i fps)", (fps) => {
    for (let frame = 0; frame < 2_000; frame += 1) {
      expect(firstDueFrame(dueUs(frame, fps), fps)).toBe(frame);
    }
  });

  test("a picture missing from where frame 48 starts fails frame 48, at 24 fps", () => {
    expect(firstDueFrame(2_000_000, 24)).toBe(48);
  });

  test("with a source at another rate, the frame before still showed a good picture", () => {
    // A 24 fps source in a 30 fps project stops after its frame 24, which shows until 1.041667 s.
    // Timeline frame 31 (1.0333 s) still shows it; frame 32 (1.0667 s) needs the missing one.
    expect(firstDueFrame(1_041_667, 30)).toBe(32);
  });
});

describe("musicPlan", () => {
  test("a clip under the playhead starts at once, from where the playhead is in it", () => {
    expect(musicPlan(cut(), 120)).toEqual([
      { clipId: "m", assetId: "m", delaySec: 0, offsetSec: 6, durationSec: 6 },
      { clipId: "n", assetId: "n", delaySec: 7.5, offsetSec: 0, durationSec: 1 },
    ]);
  });

  test("a later clip starts when the playhead will reach it, from its in point", () => {
    expect(musicPlan(cut(), 0)[0]).toEqual({
      clipId: "m",
      assetId: "m",
      delaySec: 1,
      offsetSec: 2,
      durationSec: 10,
    });
  });

  test("clips that ended before the playhead aren't played", () => {
    expect(musicPlan(cut(), 264).map((run) => run.clipId)).toEqual(["n"]);
    expect(musicPlan(cut(), 324)).toEqual([]);
  });
});
