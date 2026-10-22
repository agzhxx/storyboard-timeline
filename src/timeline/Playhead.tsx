// The playhead (Toolbar, ruler and playhead board): a 1 px accent line with a 13 × 16 head. While
// scrubbing, a 2 px line, an 18 × 20 head and a bubble with the time. Zoomed in until a frame is
// as wide as the head, an accent band covers the playhead's whole frame and the head spans it.
// It moves from requestAnimationFrame through a ref, never by re-rendering (spec section 4.4).

import { useCallback, useRef } from "react";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { formatTimecode } from "../engine/time.ts";
import { useGestureStore } from "./gestures.ts";
import { TRACKS_HEIGHT } from "./layout.ts";
import { usePlayheadWriter } from "./playhead-loop.ts";

const HEAD_WIDTH = 13;
const HEAD = "[clip-path:polygon(0_0,100%_0,100%_62%,50%_100%,0_62%)]";

export function Playhead() {
  const playheadRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const scrubbing = useGestureStore((state) => state.gesture?.kind === "scrub");
  const pxPerFrame = useUiStore((state) => state.pxPerFrame);
  const fps = useDocumentStore((state) => state.project.fps);

  // The bubble mounts when a scrub starts, so the writer changes with `scrubbing` and fills it in.
  const write = useCallback(
    (frame: number, zoom: number) => {
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translate3d(${frame * zoom}px, 0, 0)`;
      }
      if (scrubbing && bubbleRef.current) {
        bubbleRef.current.textContent = formatTimecode(frame, fps);
      }
    },
    [fps, scrubbing],
  );
  usePlayheadWriter(write);

  const frameWide = pxPerFrame >= HEAD_WIDTH;
  const head = frameWide
    ? { left: 0, width: pxPerFrame, height: scrubbing ? 20 : 16 }
    : scrubbing
      ? { left: -8, width: 18, height: 20 }
      : { left: -6, width: HEAD_WIDTH, height: 16 };
  return (
    <div
      ref={playheadRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-40 w-0 will-change-transform"
      style={{ height: TRACKS_HEIGHT }}
    >
      {frameWide && (
        <div className="absolute inset-y-0 left-0 bg-playhead/16" style={{ width: pxPerFrame }} />
      )}
      <div className={`absolute inset-y-0 left-0 bg-playhead ${scrubbing ? "w-0.5" : "w-px"}`} />
      <div className={`absolute top-0 bg-playhead ${HEAD}`} style={head} />
      {scrubbing && (
        <span
          ref={bubbleRef}
          className="absolute top-1 rounded-badge bg-playhead px-1.5 py-px font-mono text-2xs font-semibold whitespace-nowrap text-on-accent"
          style={{ left: frameWide ? pxPerFrame + 4 : 16 }}
        />
      )}
    </div>
  );
}
