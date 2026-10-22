// The messages between the main thread and the export worker (spec section 4.7): typed unions, no
// library. The dialog asks which codecs encode at a size, then starts an export with a snapshot of
// the project and the mixed music; the worker reports each frame encoded, a small picture of the
// frame being encoded about twice a second, and the finished file with its check, or why it
// stopped. Each export has a number, so a late message from one that was canceled is told apart
// from the next one's. Every message from the worker says how many VideoSamples it holds, for the
// open-frame counter.

import type { Fps, Frames, Project } from "../engine/types.ts";
import type { Measured } from "./export-check.ts";
import type { Encoders, ExportFormat, ExportSize } from "./export-format.ts";
import type { LoopTimings } from "./export-job.ts";
import type { MixedAudio } from "./export-mix.ts";

export interface ExportJob {
  /** The project as it was when Export was pressed: the export never reads the document again. */
  project: Project;
  size: ExportSize;
  format: ExportFormat;
  /** A1's mix, or null for a cut without music (no audio track). */
  audio: MixedAudio | null;
  /** The size of the pictures the dialog shows, in device pixels. */
  preview: { width: number; height: number };
}

export type ExportRequest =
  | { type: "encoders"; id: number; size: ExportSize; fps: Fps }
  | { type: "start"; run: number; job: ExportJob }
  | { type: "cancel"; run: number };

/** Why an export stopped. */
export type ExportFailure =
  /** A Feed clip's file (or other media at an address) didn't load, after retries. */
  | { kind: "unreachable"; assetId: string }
  /** A clip's frames stopped decoding at output frame `frame`. */
  | { kind: "decode"; assetId: string; frame: Frames; message: string }
  /** An encoder stopped at output frame `frame`; `codec` is its full codec string. */
  | { kind: "encoder"; track: "video" | "audio"; frame: Frames; message: string; codec: string }
  /** The file couldn't be put together once every frame was in. */
  | { kind: "output"; message: string }
  /** A music file didn't come or didn't decode, as the main thread mixed A1. */
  | { kind: "music"; assetId: string; reason: "unreadable" | "undecodable" };

/** How long the worker's parts of an export took, in ms, for the benches. */
export interface WorkerTimings extends LoopTimings {
  /** From the start message to the last frame in the encoder. */
  framesMs: number;
  /** The rest of the music, flushing the encoders and finishing the file. */
  finishMs: number;
  /** The output check. */
  checkMs: number;
}

export type ExportResponse =
  | { type: "encoders"; id: number; encoders: Encoders }
  /** Output frame `frame` is in the encoder. */
  | { type: "progress"; run: number; frame: Frames; open: number }
  /** The frame being encoded, at the dialog's size. */
  | { type: "preview"; run: number; frame: Frames; bitmap: ImageBitmap; open: number }
  | {
      type: "done";
      run: number;
      file: Blob;
      measured: Measured;
      /** The file's first frame as the check decoded it, at the dialog's size. */
      firstFrame: ImageBitmap | null;
      timings: WorkerTimings;
      open: number;
    }
  | { type: "failed"; run: number; failure: ExportFailure; open: number }
  | { type: "canceled"; run: number; open: number };
