// Playback as the UI shows it (spec sections 3.3 and 3.6): paused, starting (decoding its first
// frames) or playing, at 1× or 2×, and the clip it stopped on when a frame wouldn't decode. A pure
// reducer behind a small store. It lives outside the document, so undo never touches it, and a
// decode error is never part of the project.

import { create } from "zustand";
import type { Frames } from "../engine/types.ts";

export type PlaybackStatus = "paused" | "starting" | "playing";
export type Rate = 1 | 2;

/** Where playback stopped because a clip's frame didn't come. */
export interface DecodeStop {
  clipId: string;
  /** The clip's name, for "Can't decode 10-wide here". */
  name: string;
  /** Where it paused: the first frame that didn't come. */
  frame: Frames;
  /**
   * Its media didn't load (no answer, an error status), so it may on the next try: "Couldn't load
   * 10-wide", and no error badge. Otherwise it wouldn't decode.
   */
  unreachable: boolean;
}

export interface PlaybackState {
  status: PlaybackStatus;
  rate: Rate;
  /** The monitor's "Can't decode" message, until the playhead moves or playback starts again. */
  stop: DecodeStop | null;
  /** The clips whose frames wouldn't decode: they keep their error badge. */
  failed: readonly string[];
}

export type PlaybackEvent =
  /** Space or L: playback starts, once its first frames are decoded. */
  | { type: "start"; rate: Rate }
  /** The clock runs. */
  | { type: "playing" }
  /** L while playing. */
  | { type: "rate"; rate: Rate }
  /** K, Space, an edit, a jump, or the end of the cut. */
  | { type: "pause" }
  /** A frame wouldn't decode during playback: it paused there. */
  | { type: "decode-error"; stop: DecodeStop }
  /** A paused frame wouldn't decode. */
  | { type: "frame-failed"; clipId: string }
  | { type: "playhead-moved" }
  /** The clip the message is about is gone: deleted, or undone. */
  | { type: "clip-gone" }
  /** Another project: no clip has failed yet. */
  | { type: "project-loaded" };

export const PAUSED: PlaybackState = { status: "paused", rate: 1, stop: null, failed: [] };

function withFailed(failed: readonly string[], clipId: string): readonly string[] {
  return failed.includes(clipId) ? failed : [...failed, clipId];
}

export function playbackReducer(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  switch (event.type) {
    case "start":
      return { ...state, status: "starting", rate: event.rate, stop: null };
    case "playing":
      return state.status === "starting" ? { ...state, status: "playing" } : state;
    case "rate":
      return state.status === "paused" || state.rate === event.rate
        ? state
        : { ...state, rate: event.rate };
    case "pause":
      return state.status === "paused" && state.rate === 1
        ? state
        : { ...state, status: "paused", rate: 1 };
    case "decode-error":
      return {
        status: "paused",
        rate: 1,
        stop: event.stop,
        failed: event.stop.unreachable ? state.failed : withFailed(state.failed, event.stop.clipId),
      };
    case "frame-failed": {
      const failed = withFailed(state.failed, event.clipId);
      return failed === state.failed ? state : { ...state, failed };
    }
    case "playhead-moved":
    case "clip-gone":
      return state.stop === null ? state : { ...state, stop: null };
    case "project-loaded":
      return PAUSED;
  }
}

export const usePlaybackStore = create<PlaybackState>(() => PAUSED);

export function dispatchPlayback(event: PlaybackEvent): void {
  usePlaybackStore.setState((state) => playbackReducer(state, event));
}
