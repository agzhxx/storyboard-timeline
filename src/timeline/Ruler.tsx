// The ruler's ticks and timecodes (spec section 4.4). The steps come from `rulerSteps`, so labels
// never collide at any zoom. Only the ticks near the view are drawn: the ones a page either side
// of it, which a scroll within that page doesn't change.

import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { formatTimecode } from "../engine/time.ts";
import { rulerSteps } from "../engine/ruler.ts";
import { RULER_HEIGHT } from "./layout.ts";

/** Before the tracks are measured (and in tests), a page is the design's width. */
const DEFAULT_PAGE = 1440;

export function RulerTicks() {
  const pxPerFrame = useUiStore((state) => state.pxPerFrame);
  const page = useUiStore((state) => state.viewportWidth || DEFAULT_PAGE);
  // Which page the view starts on: the ticks change only when it moves to another one.
  const pageIndex = useUiStore((state) => Math.floor(state.scrollX / page));
  const fps = useDocumentStore((state) => state.project.fps);

  const { tick, label } = rulerSteps(pxPerFrame, fps);
  const from = Math.max(0, Math.floor(((pageIndex - 1) * page) / pxPerFrame / tick) * tick);
  const to = Math.ceil(((pageIndex + 2) * page) / pxPerFrame);
  const marks = [];
  for (let frame = from; frame <= to; frame += tick) {
    const left = frame * pxPerFrame;
    if (frame % label === 0) {
      marks.push(
        <div key={frame}>
          <div className="absolute bottom-0 h-2.5 w-px bg-tick-major" style={{ left }} />
          <span
            className="absolute top-1 font-mono text-2xs leading-[14px] whitespace-nowrap text-fg-subtle tabular-nums"
            style={{ left: left + 4 }}
          >
            {formatTimecode(frame, fps)}
          </span>
        </div>,
      );
    } else {
      marks.push(
        <div key={frame} className="absolute bottom-0 h-[5px] w-px bg-tick" style={{ left }} />,
      );
    }
  }
  return (
    <div aria-hidden="true" className="absolute top-0 left-0" style={{ height: RULER_HEIGHT - 1 }}>
      {marks}
    </div>
  );
}
