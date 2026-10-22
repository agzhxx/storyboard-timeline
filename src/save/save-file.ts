// What autosave writes (spec section 3.5): the document and the view, as
// JSON, in one of two slots in this browser's private storage (OPFS):
//
//   saves/slot-a.json   saves/slot-b.json
//
// Saves take turns between the two, each with a sequence number one higher than the last, so a
// save that's cut short (the tab crashed, storage ran out) only ever damages the older slot: the
// newer one is the last good save, and the next start takes the newest slot that reads back
// whole (src/save/save-schema.ts). The undo history and the selection aren't saved. `version` is
// the format's, for migrations later.

import type { Frames, Project } from "../engine/types.ts";

export const SAVES_FOLDER = "saves";

/** The two slots' file names, in slot order. */
export const SLOT_FILES = ["slot-a.json", "slot-b.json"] as const;

export type Slot = 0 | 1;

export const SAVE_FORMAT = "storyboard-timeline";

/** The format's version: a save in another version is migrated, or not read. */
export const SAVE_VERSION = 1;

/** Where the editor was looking: the playhead, the zoom and the scroll. */
export interface SavedView {
  playhead: Frames;
  /** Pixels per frame. */
  pxPerFrame: number;
  scrollX: number;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_VERSION;
  /** One more than the save before it: the higher of the two slots is the newer. */
  seq: number;
  /** When it was written (Date.now()), for "Your last save, from 14:32, is safe." */
  savedAt: number;
  project: Project;
  view: SavedView;
}

/** The slot the next save goes into: the other one than the newest save's. */
export function nextSlot(newest: Slot | null): Slot {
  return newest === 0 ? 1 : 0;
}
