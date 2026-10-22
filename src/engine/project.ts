// Making a project and reading it: pure helpers that the commands, snapping and the UI share.

import type { Asset, Clip, Fps, Frames, Project, Track } from "./types.ts";

export interface NewProject {
  id: string;
  /** "Untitled project" by default. */
  name?: string;
  /** 30 by default (spec section 4.2); the demo uses its clips' own rate. */
  fps?: Fps;
  width?: number;
  height?: number;
  assets?: Asset[];
}

/**
 * An empty project with the MVP's three tracks, top to bottom: V2, which draws over V1, then A1
 * for the music. A track's id is its name.
 */
export function createProject({
  id,
  name = "Untitled project",
  fps = 30,
  width = 1920,
  height = 1080,
  assets = [],
}: NewProject): Project {
  return {
    id,
    name,
    fps,
    width,
    height,
    assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
    tracks: [
      { id: "V2", kind: "video", clips: [] },
      { id: "V1", kind: "video", clips: [] },
      { id: "A1", kind: "audio", clips: [] },
    ],
  };
}

/**
 * An asset by id. `project.assets` is a plain object, so `assets["constructor"]` would find
 * a built-in; only the project's own entries count.
 */
export function findAsset(project: Project, assetId: string): Asset | undefined {
  return Object.hasOwn(project.assets, assetId) ? project.assets[assetId] : undefined;
}

/** Where a clip ends: the first frame after it, where the next clip can start. */
export function clipEnd(clip: Clip): Frames {
  return clip.start + clip.duration;
}

export interface FoundClip {
  clip: Clip;
  track: Track;
  /** The clip's position in `track.clips`. */
  index: number;
}

/** A clip by id, on whichever track it is. */
export function findClip(project: Project, clipId: string): FoundClip | undefined {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    const clip = track.clips[index];
    if (clip) return { clip, track, index };
  }
  return undefined;
}

/** The clip on a track that covers a frame, such as the one under the playhead. */
export function clipAt(track: Track, frame: Frames): Clip | undefined {
  return track.clips.find((clip) => clip.start <= frame && frame < clipEnd(clip));
}

/** The cut's length: where its last clip ends, on any track. */
export function projectDuration(project: Project): Frames {
  return Math.max(0, ...project.tracks.flatMap((track) => track.clips.map(clipEnd)));
}
