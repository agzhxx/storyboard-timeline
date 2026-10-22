// The playhead and every timecode that shows it follow the UI store from requestAnimationFrame,
// writing to the DOM through refs instead of re-rendering React (spec section 4.4). However often
// the playhead moves in a frame (a fast scrub, or playback), each writer runs once, with the
// latest frame, right before the browser paints.

import { useLayoutEffect } from "react";
import { useUiStore } from "../engine/store.ts";
import type { Frames } from "../engine/types.ts";

/** Draws the playhead somewhere: `pxPerFrame` comes along for writers that place it on the tracks. */
export type PlayheadWriter = (frame: Frames, pxPerFrame: number) => void;

const writers = new Set<PlayheadWriter>();
let pending = false;

function flush() {
  if (!pending) return;
  pending = false;
  const { playhead, pxPerFrame } = useUiStore.getState();
  for (const write of writers) write(playhead, pxPerFrame);
}

/**
 * Writes a playhead move now, in this animation frame, instead of the next one: playback moves the
 * playhead from its own requestAnimationFrame callback, and the picture and the playhead must show
 * the same frame.
 */
export function flushPlayhead(): void {
  flush();
}

useUiStore.subscribe((state, previous) => {
  const moved = state.playhead !== previous.playhead || state.pxPerFrame !== previous.pxPerFrame;
  if (!moved || pending || writers.size === 0) return;
  pending = true;
  requestAnimationFrame(flush);
});

/**
 * Keeps an element in step with the playhead. `write` runs once right away, so new elements start
 * in the right place, then once per animation frame in which the playhead or the zoom changed.
 * Pass a stable callback (`useCallback`): a new one re-registers and writes again.
 */
export function usePlayheadWriter(write: PlayheadWriter): void {
  useLayoutEffect(() => {
    const { playhead, pxPerFrame } = useUiStore.getState();
    write(playhead, pxPerFrame);
    writers.add(write);
    return () => {
      writers.delete(write);
    };
  }, [write]);
}
