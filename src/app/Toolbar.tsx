// The timeline's toolbar (Toolbar, ruler and playhead board): snapping, zoom, undo and redo with
// the step Undo would take back, the cut's length, and Export. Export is off with nothing to
// export, and in a browser that can't encode video it says why and which browsers can.

import type { CSSProperties } from "react";
import { projectDuration } from "../engine/project.ts";
import { useDocumentStore, useHistoryLabels, useUiStore } from "../engine/store.ts";
import { formatTimecode } from "../engine/time.ts";
import { sliderToZoom, zoomRange, zoomToSlider } from "../engine/viewport.ts";
import { fitCut, redo, toggleSnapping, undo, zoomIn, zoomOut, zoomTo } from "./actions.ts";
import { describeContents } from "./describe.ts";
import { encodesVideo, openExport } from "./export-open.ts";
import {
  ExportIcon,
  InfoIcon,
  MagnetIcon,
  MagnetOffIcon,
  RedoIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./icons.tsx";
import { IconButton, Kbd, PrimaryButton } from "./ui.tsx";

export function Toolbar() {
  const history = useHistoryLabels();
  return (
    <div className="flex h-toolbar flex-none items-center gap-1 border-b border-line bg-surface px-2">
      <SnappingToggle />
      <Divider />
      <ZoomControls />
      <Divider />
      <IconButton
        aria-label={history.undo === null ? "Undo" : `Undo ${history.undo}`}
        aria-keyshortcuts="Meta+Z Control+Z"
        disabled={history.undo === null}
        onClick={undo}
      >
        <UndoIcon />
      </IconButton>
      <IconButton
        aria-label={history.redo === null ? "Redo" : `Redo ${history.redo}`}
        aria-keyshortcuts="Shift+Meta+Z Shift+Control+Z"
        disabled={history.redo === null}
        onClick={redo}
      >
        <RedoIcon />
      </IconButton>
      {history.undo !== null && (
        <span className="ml-1 truncate rounded-card bg-surface-raised px-2 py-0.5 text-xs whitespace-nowrap text-fg-muted">
          Undo: {history.undo}
        </span>
      )}
      <div className="flex-1" />
      <CutSummary />
      {encodesVideo() ? <ExportButton /> : <ExportUnavailable />}
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1.5 h-5 w-px flex-none bg-line" />;
}

function SnappingToggle() {
  const snapping = useUiStore((state) => state.snapping);
  return (
    <button
      type="button"
      aria-pressed={snapping}
      aria-keyshortcuts="N"
      className={`inline-flex h-control flex-none items-center gap-2 rounded-control px-2.5 text-sm transition-colors duration-(--dur-fast) ${snapping ? "bg-surface-raised text-fg" : "text-fg-muted hover:bg-surface-raised hover:text-fg"}`}
      onClick={toggleSnapping}
    >
      {snapping ? <MagnetIcon stroke="var(--color-accent)" /> : <MagnetOffIcon />}
      {snapping ? "Snapping" : "Snapping off"}
      <Kbd>N</Kbd>
    </button>
  );
}

/** − and + around the slider, then Fit: the zoom goes from fitting the cut to 48 px per frame. */
function ZoomControls() {
  const pxPerFrame = useUiStore((state) => state.pxPerFrame);
  const viewportWidth = useUiStore((state) => state.viewportWidth);
  const duration = useDocumentStore((state) => projectDuration(state.project));
  const fps = useDocumentStore((state) => state.project.fps);
  const range = zoomRange(duration, fps, viewportWidth || 1440);
  const position = zoomToSlider(pxPerFrame, range);
  return (
    <>
      <IconButton
        aria-label="Zoom out"
        aria-keyshortcuts="-"
        disabled={viewportWidth > 0 && pxPerFrame <= range.min}
        onClick={zoomOut}
      >
        <ZoomOutIcon />
      </IconButton>
      <input
        type="range"
        aria-label="Zoom"
        aria-valuetext={`${pxPerFrame < 10 ? pxPerFrame.toFixed(1) : Math.round(pxPerFrame)} pixels per frame`}
        min={0}
        max={1000}
        step={1}
        value={Math.round(position * 1000)}
        className="zoom-slider"
        style={{ "--fill": `${6 + position * 84}px` } as CSSProperties}
        onChange={(event) => {
          zoomTo(sliderToZoom(Number(event.currentTarget.value) / 1000, range));
        }}
      />
      <IconButton
        aria-label="Zoom in"
        aria-keyshortcuts="+"
        disabled={pxPerFrame >= range.max}
        onClick={zoomIn}
      >
        <ZoomInIcon />
      </IconButton>
      <button
        type="button"
        aria-keyshortcuts="Shift+Z"
        className="inline-flex h-control flex-none items-center gap-2 rounded-control px-2.5 text-sm text-fg-muted transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-fg"
        onClick={fitCut}
      >
        Fit
        <Kbd>⇧Z</Kbd>
      </button>
    </>
  );
}

/** "15 clips and music · 00:00:45:00": what's on the timeline, and how long the cut is. */
function CutSummary() {
  const onTracks = useDocumentStore((state) => describeContents(state.project));
  const duration = useDocumentStore((state) => projectDuration(state.project));
  const fps = useDocumentStore((state) => state.project.fps);
  if (onTracks === null) return null;
  return (
    <span className="px-3 text-xs whitespace-nowrap text-fg-subtle">
      {onTracks} · <span className="font-mono">{formatTimecode(duration, fps)}</span>
    </span>
  );
}

function ExportButton() {
  const empty = useDocumentStore((state) => projectDuration(state.project) === 0);
  return (
    <PrimaryButton
      disabled={empty}
      className="flex-none disabled:pointer-events-none disabled:opacity-40"
      onClick={openExport}
    >
      <ExportIcon />
      Export
    </PrimaryButton>
  );
}

/** No video encoder in this browser: Export is off and, hovered or focused, says why. */
function ExportUnavailable() {
  return (
    <div className="group relative flex-none">
      <button
        type="button"
        aria-disabled="true"
        aria-describedby="no-encoder"
        className="inline-flex h-control cursor-not-allowed items-center gap-2 rounded-control bg-surface-raised px-3.5 text-sm font-semibold text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]"
      >
        <InfoIcon />
        Export unavailable
      </button>
      <div
        id="no-encoder"
        role="tooltip"
        className="invisible absolute top-full -right-2 z-20 mt-3 w-[360px] rounded-control bg-surface-raised px-3 py-2.5 text-xs text-fg shadow-popover group-focus-within:visible group-hover:visible"
      >
        Export needs video encoding (WebCodecs), which this browser doesn't offer. Open the app in a
        current Chrome, Edge, Safari or Firefox. Editing still works here.
      </div>
    </div>
  );
}
