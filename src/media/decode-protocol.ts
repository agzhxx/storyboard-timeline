// The messages between the main thread and the decode worker (spec section 4.5): typed unions, no
// library. Two kinds of work. Stills ("frameAt"): one exact frame for the paused monitor, as an
// ImageBitmap at its size, latest wins per slot. Playback: a session that sends each video track's
// frames in timeline order, as VideoFrames, with backpressure through acks. Every message from the
// worker says how many VideoSamples and VideoFrames it holds, for the open-frame counter.

import type { MediaLocation } from "../engine/picture.ts";
import type { TrackPlan } from "../engine/schedule.ts";

/** One exact frame, fitted inside a box of device pixels with its shape kept. */
export interface StillRequest {
  /** Which picture it's for: a monitor layer ("V1", "V2"). A newer request for it wins. */
  slot: string;
  seq: number;
  assetId: string;
  /** Where its media is: a copy in storage, or an address. */
  location: MediaLocation;
  /** Where to look the frame up in the source, in seconds (`sourceSeconds`). */
  seconds: number;
  width: number;
  height: number;
}

/** Clockwise, as Mediabunny reads it from the file: a phone's portrait video is 90. */
export type Rotation = 0 | 90 | 180 | 270;

export type DecodeRequest =
  | { type: "still"; request: StillRequest }
  | { type: "play"; session: number; tracks: TrackPlan[]; capacity: number }
  /** The main thread closed `count` of a track's frames: the worker may send that many more. */
  | { type: "ack"; session: number; trackId: string; count: number }
  | { type: "stop"; session: number };

export type DecodeResponse =
  /** A still; null when the source has no frame there (before its first one). */
  | { type: "still"; slot: string; seq: number; bitmap: ImageBitmap | null; open: number }
  /** `unreachable`: reading the media failed (no answer, an error status), not decoding it. */
  | { type: "still-failed"; slot: string; seq: number; unreachable: boolean; open: number }
  /** A playback frame, placed on the timeline in µs. */
  | {
      type: "frame";
      session: number;
      trackId: string;
      clipId: string;
      presentUs: number;
      endUs: number;
      rotation: Rotation;
      flip: boolean;
      frame: VideoFrame;
      open: number;
    }
  /**
   * A clip's frames stopped coming; `atUs` is where the first missing one shows. `unreachable`:
   * reading the media failed (no answer, an error status), not decoding it.
   */
  | {
      type: "failed";
      session: number;
      trackId: string;
      clipId: string;
      atUs: number;
      unreachable: boolean;
      open: number;
    }
  /** The worker let go of frames on its own, as when a playback stopped. */
  | { type: "open"; open: number };
