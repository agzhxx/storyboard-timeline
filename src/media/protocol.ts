// The messages between the main thread and the import worker (spec section 4.5): typed unions,
// one request at a time per id, no library. Each request gets one final answer (`analyzed`,
// `peaks`, `done` or `error`), and copying and thumbnails send progress on the way.

import type { CantOpen } from "./codecs.ts";
import type { MediaFacts } from "./facts.ts";
import type { FailureKind } from "./import-state.ts";
import type { StoredMedia } from "./opfs.ts";
import type { Peaks } from "./peaks.ts";
import type { ThumbnailType } from "./thumbnails.ts";

export type WorkerRequest =
  /** Read a file's media and check that this browser decodes it, before anything is copied. */
  | { type: "analyze"; id: number; file: File }
  /** Boil decoded audio down to waveform peaks; the channels are transferred, not copied. */
  | { type: "peaks"; id: number; channels: Float32Array<ArrayBuffer>[]; sampleRate: number }
  /**
   * Copy a file into its asset's folder, with its peaks if it's audio; then write `meta` when
   * nothing comes after the copy.
   */
  | {
      type: "store";
      id: number;
      assetId: string;
      file: File;
      source: string;
      peaks: Peaks | null;
      meta: StoredMedia;
    }
  /** Make a stored video's thumbnails, one per second, then write its thumbnails.json. */
  | { type: "thumbnails"; id: number; meta: StoredMedia }
  /** Read a remote video's facts with range requests, and check that this browser decodes it. */
  | { type: "probe"; id: number; url: string }
  /** Make a remote video's thumbnails, one per second, kept in OPFS where the browser lets it. */
  | ({ type: "remote-thumbnails"; id: number } & RemoteThumbnails);

/**
 * Which of a Feed clip's thumbnails to send, and from which file: from index `from` on. With
 * `preview`, the file is the Feed's preview of the clip's first 2.5 s, and only the thumbnails it
 * holds are made, of the clip's `preview.count`; without, it's the whole clip (its 720p file),
 * whose thumbnails are then all stored, those before `from` too, with its meta.json.
 */
export interface RemoteThumbnails {
  assetId: string;
  url: string;
  from: number;
  preview: { count: number } | null;
}

/** The first frame as a thumbnail, which the bin shows as the file's poster. */
export interface Thumbnail {
  blob: Blob;
  type: ThumbnailType;
}

export type Analysis =
  { ok: true; facts: MediaFacts; poster: Thumbnail | null } | { ok: false; problem: CantOpen };

export type WorkerResponse =
  | { type: "analyzed"; id: number; analysis: Analysis }
  | { type: "peaks"; id: number; peaks: Peaks }
  | { type: "progress"; id: number; fraction: number }
  | { type: "thumbnail"; id: number; index: number; thumbnail: Thumbnail }
  | { type: "done"; id: number }
  | { type: "error"; id: number; kind: FailureKind; detail: string };
