import { createProject } from "../../src/engine/project.ts";
import type { Asset, Clip, Project, Track } from "../../src/engine/types.ts";

/** A clip from the Feed, named like the robot story's shots. Its id is its name. */
export function videoAsset(name: string, durationSec = 5): Asset {
  return {
    id: name,
    kind: "video",
    name,
    source: {
      type: "feed",
      itemId: name,
      url: `https://media.example/originals/${name}.mp4`,
      videoUrl: `https://media.example/m/${name}/v1/full.mp4`,
      model: "Kling 2.5 Pro",
    },
    durationSec,
    width: 1920,
    height: 1080,
    fps: 24,
  };
}

/** A music file the user dropped in. Its id is its name. */
export function audioAsset(name: string, durationSec = 60): Asset {
  return {
    id: name,
    kind: "audio",
    name,
    source: { type: "file", opfsPath: `/media/${name}.mp3` },
    durationSec,
  };
}

/** A clip; by default one second long from the start of its source. */
export function clip(
  id: string,
  assetId: string,
  { start = 0, in: inPoint = 0, duration = 24 }: Partial<Omit<Clip, "id" | "assetId">> = {},
): Clip {
  return { id, assetId, start, in: inPoint, duration };
}

/**
 * Part of the robot story at 24 fps, with three video sources of 5 s (120 frames) each and 45 s
 * of music:
 *
 *   V2  (empty)
 *   V1  a: 06-tracking 0–71 · gap 72–95 · b: 07-medium 96–167 (source frames 36–107)
 *   A1  m: music 0–1079 (all of it)
 */
export function storyProject(): Project {
  const project = createProject({
    id: "story",
    fps: 24,
    assets: [
      videoAsset("06-tracking"),
      videoAsset("07-medium"),
      videoAsset("08-closeup"),
      audioAsset("music", 45),
    ],
  });
  const clips: Record<string, Clip[]> = {
    V1: [
      clip("a", "06-tracking", { start: 0, duration: 72 }),
      clip("b", "07-medium", { start: 96, in: 36, duration: 72 }),
    ],
    A1: [clip("m", "music", { start: 0, duration: 1_080 })],
  };
  return withClips(project, clips);
}

/** The project with some tracks' clips replaced, as given (keep them sorted). */
export function withClips(project: Project, clips: Record<string, Clip[]>): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({ ...track, clips: clips[track.id] ?? track.clips })),
  };
}

/** A track by id, for tests that know it's there. */
export function trackOf(project: Project, trackId: string): Track {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error(`The project has no track ${trackId}`);
  return track;
}

/**
 * Freezes a value and everything in it, so that code that changes it in place throws a
 * TypeError (modules run in strict mode). Commands must never change the project they're given.
 */
export function frozen<T>(value: T): T {
  deepFreeze(value);
  return value;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}
