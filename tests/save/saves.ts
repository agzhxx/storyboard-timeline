// Saves for the tests: the robot story (Feed clips and the demo music) with one file of the
// person's own on V2, as autosave writes them.

import { placeAsset } from "../../src/engine/commands.ts";
import type { Asset, Project } from "../../src/engine/types.ts";
import {
  SAVE_FORMAT,
  SAVE_VERSION,
  type SavedView,
  type SaveFile,
} from "../../src/save/save-file.ts";
import { testStory } from "../app/story.ts";

/** A file the person added: its copy in OPFS is assets/<id>/source.mp4. */
export const OWN_FILE: Asset = {
  id: "file-1",
  kind: "video",
  name: "05-wide.mp4",
  source: { type: "file", opfsPath: "assets/file-1/source.mp4" },
  durationSec: 5,
  width: 1920,
  height: 1080,
  fps: 24,
};

/** The story, with OWN_FILE's first 2 seconds on V2 from frame 24. */
export function savedProject(): Project {
  const placed = placeAsset(testStory(), {
    asset: OWN_FILE,
    clipId: "own",
    trackId: "V2",
    start: 24,
    duration: 48,
  });
  if (!placed.ok) throw new Error(placed.error.message);
  return placed.project;
}

export const VIEW: SavedView = { playhead: 462, pxPerFrame: 4, scrollX: 600 };

export function saveFile(seq: number, project: Project = savedProject()): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    seq,
    savedAt: 1_760_000_000_000 + seq,
    project,
    view: VIEW,
  };
}

/** A save as its slot's text. */
export function slotText(seq: number, project?: Project): string {
  return JSON.stringify(saveFile(seq, project));
}
