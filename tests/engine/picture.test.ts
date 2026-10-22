import { describe, expect, test } from "vitest";
import {
  exportLocation,
  layersAt,
  locationKey,
  previewLocation,
} from "../../src/engine/picture.ts";
import { createProject } from "../../src/engine/project.ts";
import { SOURCE_TOLERANCE_SEC, sourceSeconds } from "../../src/engine/time.ts";
import type { Asset, Fps, Project } from "../../src/engine/types.ts";
import { clip } from "./fixtures.ts";

function file(id: string, durationSec = 5): Asset {
  return {
    id,
    kind: "video",
    name: `${id}.mp4`,
    source: { type: "file", opfsPath: `assets/${id}/source.mp4` },
    durationSec,
  };
}

/** V1: a 0–47 (source 10–57), gap, b 72–119; V2: c 24–59 over them. */
function layered(): Project {
  const project = createProject({ id: "p", fps: 24, assets: [file("a"), file("b"), file("c")] });
  const [v2, v1] = project.tracks;
  if (!v2 || !v1) throw new Error("No video tracks");
  v1.clips = [
    clip("a", "a", { start: 0, in: 10, duration: 48 }),
    clip("b", "b", { start: 72, duration: 48 }),
  ];
  v2.clips = [clip("c", "c", { start: 24, in: 5, duration: 36 })];
  return project;
}

const shown = (project: Project, frame: number) =>
  layersAt(project, frame).map((layer) => `${layer.trackId} ${layer.clip.id}@${layer.sourceFrame}`);

describe("layersAt", () => {
  test("gives each video track's clip at a frame, V1 first, so V2 draws over it", () => {
    expect(shown(layered(), 30)).toEqual(["V1 a@40", "V2 c@11"]);
  });

  test("a clip shows source frame in + (frame − start)", () => {
    expect(shown(layered(), 0)).toEqual(["V1 a@10"]);
    expect(shown(layered(), 47)).toEqual(["V1 a@57", "V2 c@28"]);
    expect(shown(layered(), 72)).toEqual(["V1 b@0"]);
  });

  test("a clip covers its start but not its end, and a gap shows nothing", () => {
    expect(shown(layered(), 48)).toEqual(["V2 c@29"]);
    expect(shown(layered(), 60)).toEqual([]);
    expect(shown(layered(), 120)).toEqual([]);
  });

  test("A1 is never a layer", () => {
    const project = createProject({ id: "p", fps: 24, assets: [file("m")] });
    const a1 = project.tracks[2];
    if (a1) a1.clips = [clip("m", "m")];
    expect(layersAt(project, 0)).toEqual([]);
  });
});

describe("previewLocation", () => {
  test("a file is read from its copy in storage", () => {
    expect(previewLocation(file("a"))).toEqual({
      type: "file",
      opfsPath: "assets/a/source.mp4",
    });
  });

  test("a Feed clip is previewed from the Feed's 720p file, not its 1080p original", () => {
    const clipFromFeed: Asset = {
      ...file("f"),
      source: {
        type: "feed",
        itemId: "f",
        url: "https://media.example/originals/f.mp4",
        videoUrl: "https://media.example/m/f/v1/full.mp4",
        model: "Kling 2.5 Pro",
      },
    };
    expect(previewLocation(clipFromFeed)).toEqual({
      type: "url",
      url: "https://media.example/m/f/v1/full.mp4",
    });
  });

  test("media that comes with the app is read from its address", () => {
    const music: Asset = {
      id: "demo-music",
      kind: "audio",
      name: "Demo music",
      source: { type: "url", url: "/demo/music.mp3" },
      durationSec: 46,
    };
    expect(previewLocation(music)).toEqual({ type: "url", url: "/demo/music.mp3" });
  });

  test("two locations have the same key only when they're the same media", () => {
    const path = { type: "file", opfsPath: "assets/a/source.mp4" } as const;
    expect(locationKey(path)).toBe(locationKey({ ...path }));
    expect(locationKey(path)).not.toBe(locationKey({ type: "url", url: "assets/a/source.mp4" }));
  });
});

describe("exportLocation", () => {
  const fromFeed: Asset = {
    ...file("f"),
    source: {
      type: "feed",
      itemId: "f",
      url: "https://media.example/originals/f.mp4",
      videoUrl: "https://media.example/m/f/v1/full.mp4",
      model: "Kling 2.5 Pro",
    },
  };

  test("a 1080p export reads a Feed clip's 1080p original", () => {
    expect(exportLocation(fromFeed, 1080)).toEqual({
      type: "url",
      url: "https://media.example/originals/f.mp4",
    });
  });

  test("a 720p export reads the Feed's 720p file", () => {
    expect(exportLocation(fromFeed, 720)).toEqual({
      type: "url",
      url: "https://media.example/m/f/v1/full.mp4",
    });
  });

  test("a file is read from its copy in storage at any size", () => {
    expect(exportLocation(file("a"), 1080)).toEqual(previewLocation(file("a")));
    expect(exportLocation(file("a"), 720)).toEqual(previewLocation(file("a")));
  });
});

/**
 * Which stored frame a decoder returns for a time: the last one that starts at or before it, as
 * Mediabunny's sinks do. `stored` are the frames' times in seconds, as the container keeps them.
 */
function frameAt(stored: readonly number[], seconds: number): number {
  return stored.findLastIndex((time) => time <= seconds);
}

/** The times of `count` frames at `rate`, rounded to the container's units per second. */
function storedTimes(count: number, rate: number, unitsPerSecond: number): number[] {
  return Array.from(
    { length: count },
    (_, k) => Math.round((k / rate) * unitsPerSecond) / unitsPerSecond,
  );
}

describe("which source frame a timeline frame shows", () => {
  test.each([
    ["MP4, exact times", 24, 12_288],
    ["MP4, 90 kHz", 30, 90_000],
    ["WebM, whole milliseconds", 24, 1_000],
    ["WebM, whole milliseconds", 30, 1_000],
    ["QuickTime, 600 units a second", 24, 600],
  ] as const)("%s at %i fps: frame n of the source shows frame n", (_, rate, units) => {
    const stored = storedTimes(120, rate, units);
    for (let n = 0; n < 120; n += 1) expect(frameAt(stored, sourceSeconds(n, rate as Fps))).toBe(n);
  });

  test("without the tolerance, WebM's rounding would show the frame before, one frame in three", () => {
    const stored = storedTimes(30, 30, 1_000);
    // Frame 2 starts at 66.67 ms but is stored as 67 ms.
    expect(frameAt(stored, 2 / 30 + 1e-6)).toBe(1);
    expect(frameAt(stored, sourceSeconds(2, 30))).toBe(2);
    const wrong = stored.filter((_, n) => frameAt(stored, n / 30 + 1e-6) !== n);
    expect(wrong).toHaveLength(10);
  });

  test("a 30 fps source in a 24 fps project shows its nearest earlier frame", () => {
    const stored = storedTimes(150, 30, 90_000);
    // Timeline frame n of 24 shows source time n / 24: source frames 0, 1, 2, 3, 5, 6…
    const shownFrames = Array.from({ length: 8 }, (_, n) => frameAt(stored, sourceSeconds(n, 24)));
    expect(shownFrames).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });

  test("a 24 fps source in a 30 fps project shows some frames twice", () => {
    const stored = storedTimes(120, 24, 12_288);
    const shownFrames = Array.from({ length: 6 }, (_, n) => frameAt(stored, sourceSeconds(n, 30)));
    expect(shownFrames).toEqual([0, 0, 1, 2, 3, 4]);
  });

  test("the tolerance is far below a frame, so the next frame never shows early", () => {
    expect(SOURCE_TOLERANCE_SEC).toBeLessThan(1 / 120 / 4);
  });
});
