import { describe, expect, test } from "vitest";
import {
  PAUSED,
  type PlaybackEvent,
  type PlaybackState,
  playbackReducer,
} from "../../src/media/playback-state.ts";

const run = (...events: PlaybackEvent[]): PlaybackState => events.reduce(playbackReducer, PAUSED);

const stop = { clipId: "c10", name: "10-wide", frame: 648, unreachable: false };

describe("playbackReducer", () => {
  test("play starts, then plays once the clock runs; L makes it 2×; pause goes back to 1×", () => {
    expect(run({ type: "start", rate: 1 }).status).toBe("starting");
    const playing = run({ type: "start", rate: 1 }, { type: "playing" });
    expect(playing).toMatchObject({ status: "playing", rate: 1 });
    expect(playbackReducer(playing, { type: "rate", rate: 2 }).rate).toBe(2);
    expect(run({ type: "start", rate: 1 }, { type: "rate", rate: 2 }, { type: "pause" })).toEqual(
      PAUSED,
    );
  });

  test("a rate change while paused, or a second 'playing', changes nothing", () => {
    expect(run({ type: "rate", rate: 2 })).toBe(PAUSED);
    const playing = run({ type: "start", rate: 1 }, { type: "playing" });
    expect(playbackReducer(playing, { type: "playing" })).toBe(playing);
  });

  test("a decode error pauses at the clip, with the monitor's message and the clip's badge", () => {
    const state = run(
      { type: "start", rate: 2 },
      { type: "playing" },
      { type: "decode-error", stop },
    );
    expect(state).toEqual({ status: "paused", rate: 1, stop, failed: ["c10"] });
  });

  test("the message goes when the playhead moves or playback starts again; the badge stays", () => {
    const failed = run({ type: "decode-error", stop });
    expect(playbackReducer(failed, { type: "playhead-moved" })).toEqual({
      ...PAUSED,
      failed: ["c10"],
    });
    expect(playbackReducer(failed, { type: "start", rate: 1 })).toMatchObject({
      stop: null,
      failed: ["c10"],
    });
  });

  test("the message goes with its clip; the badge stays for an undo that brings it back", () => {
    const failed = run({ type: "decode-error", stop });
    expect(playbackReducer(failed, { type: "clip-gone" })).toEqual({ ...PAUSED, failed: ["c10"] });
  });

  test("a paused frame that won't decode badges its clip once, with no message", () => {
    const state = run(
      { type: "frame-failed", clipId: "c3" },
      { type: "frame-failed", clipId: "c3" },
    );
    expect(state).toEqual({ ...PAUSED, failed: ["c3"] });
  });

  test("a clip whose media didn't load pauses with a message, but gets no badge: it may load next time", () => {
    const state = run(
      { type: "start", rate: 1 },
      { type: "decode-error", stop: { ...stop, unreachable: true } },
    );
    expect(state).toEqual({
      status: "paused",
      rate: 1,
      stop: { ...stop, unreachable: true },
      failed: [],
    });
  });

  test("another project clears everything", () => {
    expect(run({ type: "decode-error", stop }, { type: "project-loaded" })).toBe(PAUSED);
  });

  test("events that change nothing keep the same state, so nothing re-renders", () => {
    expect(playbackReducer(PAUSED, { type: "pause" })).toBe(PAUSED);
    expect(playbackReducer(PAUSED, { type: "playhead-moved" })).toBe(PAUSED);
  });
});
