// The messages between the main thread and the save worker (src/save/save.worker.ts): one answer
// per request, in the order they were sent.

import type { SaveFile, Slot } from "./save-file.ts";

export type SaveRequest =
  /** Read both slots back and check them: the newest good save, if any. */
  | { type: "read"; id: number }
  /** Write a save into its slot's file, replacing what was there. */
  | { type: "write"; id: number; file: string; text: string }
  /** Delete these folders at the root of OPFS, with everything in them (New project). */
  | { type: "clear"; id: number; folders: string[] };

/** What reading the slots found. */
export type ReadResult =
  /** Neither slot is there. */
  | { kind: "none" }
  /** The newest save that reads back whole, and the files of it storage no longer has. */
  | { kind: "restored"; save: SaveFile; slot: Slot; missing: string[] }
  /** A slot is there, but neither reads back. */
  | { kind: "unreadable" };

/**
 * Why a request failed: storage is full, this browser won't give the site storage, another tab's
 * worker holds the file, or anything else.
 */
export type SaveFailure = "quota" | "unavailable" | "busy" | "other";

export type SaveResponse =
  | { type: "done"; id: number }
  | { type: "read"; id: number; result: ReadResult }
  | { type: "error"; id: number; failure: SaveFailure; detail: string };
