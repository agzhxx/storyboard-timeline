// One clip on the timeline, in every state from the design's Clip states board: default, hover
// (white trim handles), selected (an accent frame and handles), one of several selected (handles
// without grips), keyboard focus (an outer ring), dragging (lifted, with its old place dashed and a
// chip with the new start), trimming (the cut part faint, the active handle wider), one frame long
// (at least 4 px wide, no label) and can't decode (its picture at 40 % under an error badge),
// which is also how a clip whose file is missing from storage shows. A clip shows its source's
// filmstrip or waveform (ClipMedia). It reads its own slice of the gesture store, so a drag
// re-renders only the clip being dragged. Its element stays the same in every state, so it keeps
// the pointer.
//
// For the keyboard (spec section 2): the clip is a Tab stop, a button that
// Enter selects. Once it's the only clip selected, its two trim handles follow it in the Tab order
// as W3C sliders: their value is the edge's frame, from as far as a drag could take it to as far
// the other way, said as a timecode. ← and → trim a frame, with ⇧ a second (Page Up and Page Down
// too), and Home and End go as far as the edge can; repeats are one undo step.

import { type HTMLAttributes, type KeyboardEvent, memo, type ReactNode, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { edgeSlider, revealFrames, trimEdgeBy, trimEdgeTo } from "../app/actions.ts";
import { WarningIcon } from "../app/icons.tsx";
import { focusedWithKeyboard } from "../app/keyboard.ts";
import { neighbors, type TrimLimit } from "../engine/limits.ts";
import { findAsset, findClip } from "../engine/project.ts";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { formatTimecode } from "../engine/time.ts";
import type { Asset, Clip, Fps, Frames, Project } from "../engine/types.ts";
import { useMissingMedia } from "../media/missing.ts";
import { usePlaybackStore } from "../media/playback-state.ts";
import { ClipMedia } from "./ClipMedia.tsx";
import { gestureOf, pressClip, useGestureStore } from "./gestures.ts";
import { clipWidth, NARROW_CLIP_WIDTH, rowOf } from "./layout.ts";

interface ClipViewProps {
  clip: Clip;
  trackId: string;
  name: string;
  /** Its source, whose filmstrip or waveform it draws; undefined if the document lost it. */
  asset: Asset | undefined;
  /** A video's width over its height, for its filmstrip. */
  aspect: number;
  /** How many thumbnails a video's filmstrip has, one per second. */
  thumbnailCount: number;
  pxPerFrame: number;
  fps: Fps;
  /** How many frames its source has, for the trim chip at the source's end. */
  sourceFrames: Frames;
}

type Selection = "none" | "only" | "several";

/** The clip's body, behind its filmstrip or waveform. */
const CLIP_BODY = "var(--color-clip)";

function selectionOf(selection: readonly string[], clipId: string): Selection {
  if (!selection.includes(clipId)) return "none";
  return selection.length > 1 ? "several" : "only";
}

export const ClipView = memo(function ClipView({
  clip,
  trackId,
  name,
  asset,
  aspect,
  thumbnailCount,
  pxPerFrame,
  fps,
  sourceFrames,
}: ClipViewProps) {
  const selection = useUiStore((state) => selectionOf(state.selection, clip.id));
  const gesture = useGestureStore((state) => gestureOf(state.gesture, clip.id));
  const failed = usePlaybackStore((state) => state.failed.includes(clip.id));
  const missing = useMissingMedia((state) => state.assetIds.includes(clip.assetId));
  // A handle with keyboard focus stays, as the one being dragged does, however narrow its clip.
  const [handleFocused, setHandleFocused] = useState(false);
  const row = rowOf(trackId);
  if (!row) return null;

  const tc = (frames: Frames) => formatTimecode(frames, fps);
  const moving = gesture?.kind === "move" ? gesture : null;
  const trimming = gesture?.kind === "trim" ? gesture : null;
  const selected = selection !== "none" || gesture !== null;
  const broken = failed || missing;
  const home = {
    left: clip.start * pxPerFrame,
    width: clipWidth(clip.duration, pxPerFrame),
    top: row.clipTop,
    height: row.clipHeight,
  };

  // Where the clip is drawn, and what it shows, in each state.
  let box = home;
  let shownLeft = home.left;
  let inPoint = clip.in;
  let moveBy: string | undefined;
  let labelAt = selected ? "left-2.5" : "left-1 group-hover:left-2.5";
  let chip: { text: string; at: string } | null = null;
  let handles: [HandleLook, HandleLook] | null = [handleLook(selection), handleLook(selection)];
  if (moving) {
    // Lifted 4 px and moved by translate3d; on another track, as tall as that track's clips.
    const target = rowOf(moving.trackId) ?? row;
    const dx = (moving.start - clip.start) * pxPerFrame;
    moveBy = `translate3d(${dx}px, ${target.clipTop - row.clipTop - 4}px, 0)`;
    shownLeft = home.left + dx;
    box = { ...home, height: target.clipHeight };
    labelAt = "left-1.5";
    handles = null;
    const moved = moving.start - clip.start;
    const sign = moved > 0 ? "+" : moved < 0 ? "−" : "";
    chip = {
      text: moving.fits
        ? `${tc(moving.start)} · ${sign}${Math.abs(moved)} f`
        : `No room on ${moving.trackId}`,
      at: "bottom-1.5 left-1.5",
    };
  } else if (trimming) {
    const fromStart = trimming.edge === "start";
    const atSource = trimming.limit === "source";
    inPoint = clip.in + (trimming.start - clip.start);
    box = {
      ...home,
      left: trimming.start * pxPerFrame,
      width: clipWidth(trimming.duration, pxPerFrame),
    };
    shownLeft = box.left;
    labelAt = fromStart ? "left-3" : "left-2.5";
    handles = fromStart ? ["active", "plain"] : ["plain", "active"];
    let text: string;
    if (fromStart) text = atSource ? `Source starts · ${tc(0)}` : `In ${tc(inPoint)}`;
    else
      text = atSource
        ? `Source ends · ${tc(sourceFrames)}`
        : `Out ${tc(inPoint + trimming.duration)}`;
    chip = { text, at: fromStart ? "bottom-1.5 left-3" : "right-3.5 bottom-1.5" };
  }
  const narrow = box.width < NARROW_CLIP_WIDTH;
  // A trim keeps its handles even when it makes the clip narrow: the held one has the pointer,
  // or the focused one the keyboard.
  if (narrow && !trimming && !handleFocused) handles = null;
  // The handles are sliders while this is the one clip selected and nothing is dragging it.
  const sliders = selection === "only" && !gesture;

  // Enter selects; Space plays, as everywhere in the editor.
  const select = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const ui = useUiStore.getState();
    if (event.shiftKey) ui.addToSelection(clip.id);
    else ui.selectClip(clip.id);
    ui.setActiveTrack(trackId);
  };

  const status = missing ? ", its file is missing" : failed ? ", can't decode" : "";
  return (
    <>
      {moving && (
        <div
          key="origin"
          aria-hidden="true"
          className="pointer-events-none absolute rounded-clip border border-dashed border-line-strong"
          style={home}
        />
      )}
      {trimming && (
        <div
          key="before"
          aria-hidden="true"
          className="pointer-events-none absolute overflow-hidden rounded-clip opacity-25"
          style={{ ...home, background: CLIP_BODY }}
        >
          {asset ? (
            <ClipMedia
              asset={asset}
              aspect={aspect}
              thumbnailCount={thumbnailCount}
              left={home.left}
              width={home.width}
              height={home.height}
              inPoint={clip.in}
              sourceFrames={sourceFrames}
              pxPerFrame={pxPerFrame}
              fps={fps}
              selected={false}
              dimmed={false}
            />
          ) : null}
        </div>
      )}
      <div
        key="clip"
        data-clip-id={clip.id}
        className={[
          "group pointer-events-auto absolute",
          narrow ? "rounded-[2px]" : "rounded-clip",
          // The only clip selected sits over its neighbors: its handles reach past its edges.
          gesture ? "z-20" : narrow || selection === "only" ? "z-10" : "",
          moving ? "shadow-popover" : "",
          moving && !moving.fits ? "opacity-50" : "",
        ].join(" ")}
        style={{ ...box, transform: moveBy }}
        onPointerDown={(event) => {
          pressClip(event, clip.id, "body");
        }}
      >
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          aria-label={`${name} on ${trackId}, starts ${tc(clip.start)}, ${tc(clip.duration)} long${status}`}
          className="group/clip absolute inset-0 focus-visible:outline-none!"
          onKeyDown={select}
          onFocus={(event) => {
            // Tab scrolls the tracks to the clip; a click doesn't, so a drag starts where it was.
            if (event.currentTarget.matches(":focus-visible")) {
              revealFrames(clip.start, clip.start + clip.duration);
            }
          }}
        >
          <div
            className={`absolute inset-0 overflow-hidden ${narrow ? "rounded-[2px] shadow-[0_0_0_1px_rgb(242_242_243/0.5)]" : "rounded-clip"}`}
            style={{ background: CLIP_BODY }}
          >
            {asset ? (
              <ClipMedia
                asset={asset}
                aspect={aspect}
                thumbnailCount={thumbnailCount}
                left={shownLeft}
                width={box.width}
                height={box.height}
                inPoint={inPoint}
                sourceFrames={sourceFrames}
                pxPerFrame={pxPerFrame}
                fps={fps}
                selected={selected}
                dimmed={broken}
              />
            ) : null}
            {narrow ? null : <Edge hoverable={!selected} line={asset?.kind === "audio"} />}
            {selected ? <Ring /> : null}
            {narrow ? null : <Label at={labelAt}>{name}</Label>}
            {chip ? <Chip at={chip.at}>{chip.text}</Chip> : null}
            {broken && !narrow ? <ErrorBadge missing={missing} /> : null}
          </div>
          {/* Keyboard focus, as drawn: 2 px of accent, 4 px outside the clip. */}
          <span className="pointer-events-none absolute -inset-1 hidden rounded-[7px] outline-2 outline-offset-0 outline-focus group-focus-visible/clip:block" />
        </div>
        {handles ? (
          <Handle
            clipId={clip.id}
            name={name}
            edge="start"
            look={handles[0]}
            slider={sliders}
            wide={selection === "only"}
            fps={fps}
            onFocusChange={setHandleFocused}
          />
        ) : null}
        {handles ? (
          <Handle
            clipId={clip.id}
            name={name}
            edge="end"
            look={handles[1]}
            slider={sliders}
            wide={selection === "only"}
            fps={fps}
            onFocusChange={setHandleFocused}
          />
        ) : null}
        {narrow && !gesture ? (
          <span
            role="tooltip"
            className="pointer-events-none absolute top-1/2 left-[calc(100%+11px)] z-30 hidden -translate-y-1/2 rounded-card bg-surface-raised px-2 py-0.5 text-xs whitespace-nowrap text-fg shadow-popover group-hover:block group-has-[:focus-visible]:block"
          >
            {name} · {clip.duration === 1 ? "1 frame" : `${clip.duration} frames`}
          </span>
        ) : null}
      </div>
    </>
  );
});

/**
 * The clip's 1 px inner edge: dark over a filmstrip or a color, a divider's gray around a waveform
 * (as drawn), and light on hover when it isn't selected.
 */
function Edge({ hoverable, line }: { hoverable: boolean; line: boolean }) {
  return (
    <span
      className={`pointer-events-none absolute inset-0 rounded-clip ${line ? "shadow-[inset_0_0_0_1px_var(--color-line)]" : "shadow-[inset_0_0_0_1px_rgb(0_0_0/0.55)]"} ${hoverable ? "group-hover:shadow-[inset_0_0_0_1px_rgb(242_242_243/0.32)]" : ""}`}
    />
  );
}

/**
 * A clip whose frames wouldn't decode, or whose file is gone from storage: the danger mark on a
 * 20 px scrim, top right.
 */
function ErrorBadge({ missing }: { missing: boolean }) {
  return (
    <span
      role="img"
      aria-label={missing ? "File missing" : "Decode error"}
      className="pointer-events-none absolute top-1 right-1 flex size-5 items-center justify-center rounded-badge bg-scrim"
    >
      <WarningIcon size={14} stroke="var(--color-danger)" />
    </span>
  );
}

/** The selection: a 2 px accent frame inside the clip. */
function Ring() {
  return (
    <span className="pointer-events-none absolute inset-0 rounded-clip shadow-[inset_0_0_0_2px_var(--color-selection)]" />
  );
}

function Label({ at, children }: { at: string; children: ReactNode }) {
  return (
    <span
      className={`pointer-events-none absolute top-1 rounded-badge bg-scrim px-[5px] text-2xs whitespace-nowrap ${at}`}
    >
      {children}
    </span>
  );
}

function Chip({ at, children }: { at: string; children: ReactNode }) {
  return (
    <span
      className={`pointer-events-none absolute rounded-badge bg-scrim px-[5px] font-mono text-2xs whitespace-nowrap ${at}`}
    >
      {children}
    </span>
  );
}

/** How a trim handle looks: white on hover, accent when selected, plain for several, wide when held. */
type HandleLook = "hover" | "selected" | "plain" | "active";

function handleLook(selection: Selection): HandleLook {
  if (selection === "only") return "selected";
  return selection === "several" ? "plain" : "hover";
}

const HANDLE_LOOKS: Record<HandleLook, { handle: string; grip: string | null }> = {
  hover: {
    handle: "w-trim-handle bg-fg/85 opacity-0 group-hover:opacity-100",
    grip: "h-4 bg-bg/50",
  },
  selected: { handle: "w-trim-handle bg-selection", grip: "h-4 bg-on-accent/55" },
  plain: { handle: "w-trim-handle bg-selection", grip: null },
  active: { handle: "w-2 bg-accent-hover", grip: "h-5 bg-on-accent/60" },
};

/** What holds an edge at the end of its range, said after its timecode. */
function limitText(limit: TrimLimit, edge: "start" | "end", neighbor: string | null): string {
  switch (limit) {
    case "source":
      return edge === "start" ? "the start of its source" : "the end of its source";
    case "neighbor":
      return `against ${neighbor ?? "the next clip"}`;
    case "timeline-start":
      return "the start of the timeline";
    case "one-frame":
      return "one frame long";
  }
}

/** The clip next to an edge on its track, by name: what a trim stops against. */
function neighborName(project: Project, clipId: string, edge: "start" | "end"): string | null {
  const found = findClip(project, clipId);
  if (!found) return null;
  const { previous, next } = neighbors(found.track, found.clip);
  const neighbor = edge === "start" ? previous : next;
  return neighbor ? (findAsset(project, neighbor.assetId)?.name ?? null) : null;
}

/**
 * Where a handle takes presses: the 6 px it's drawn at, or, on the only clip selected, 24 px across
 * its clip's edge, as WCAG 2.2 asks of a target (2.5.8), with the 6 px drawn at the edge inside.
 */
const HANDLE_TARGETS = {
  start: { narrow: "left-0 w-trim-handle", wide: "-left-3 w-6", bar: "left-3" },
  end: { narrow: "right-0 w-trim-handle", wide: "-right-3 w-6", bar: "right-3" },
} as const;

/**
 * A trim handle: 6 px at a clip's edge (8 px while held), with a grip in its middle. A slider for
 * the keyboard while its clip is the only one selected; only a target for the pointer otherwise.
 * Keyboard focus rings the 6 px drawn, not the wider target around it.
 */
function Handle({
  clipId,
  name,
  edge,
  look,
  slider,
  wide,
  fps,
  onFocusChange,
}: {
  clipId: string;
  name: string;
  edge: "start" | "end";
  look: HandleLook;
  slider: boolean;
  /** Whether it takes presses 24 px across its edge. */
  wide: boolean;
  fps: Fps;
  onFocusChange: (focused: boolean) => void;
}) {
  const { handle, grip } = HANDLE_LOOKS[look];
  const target = HANDLE_TARGETS[edge];
  const bar = `${wide ? target.bar : edge === "start" ? "left-0" : "right-0"} ${edge === "start" ? "rounded-l-clip" : "rounded-r-clip"}`;
  const sliderProps = useSliderProps(clipId, name, edge, fps, slider);
  return (
    <span
      data-edge={edge}
      className={`group/handle absolute inset-y-0 cursor-ew-resize focus-visible:outline-none! ${wide ? target.wide : target.narrow}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        pressClip(event, clipId, edge);
      }}
      onFocus={() => {
        onFocusChange(focusedWithKeyboard());
      }}
      onBlur={() => {
        onFocusChange(false);
      }}
      {...sliderProps}
    >
      <span
        className={`pointer-events-none absolute inset-y-0 flex items-center justify-center outline-offset-2 outline-focus group-focus-visible/handle:outline-2 ${bar} ${handle}`}
      >
        {grip ? <span className={`w-0.5 rounded-[1px] ${grip}`} /> : null}
      </span>
    </span>
  );
}

/**
 * A handle's slider attributes and keys (the W3C slider pattern), from the document as it is: a
 * neighbor that moves changes how far the edge can go. Hidden from assistive technology when it
 * isn't a slider.
 */
function useSliderProps(
  clipId: string,
  name: string,
  edge: "start" | "end",
  fps: Fps,
  enabled: boolean,
): HTMLAttributes<HTMLSpanElement> {
  const state = useDocumentStore(
    useShallow((document) => {
      const found = enabled ? edgeSlider(document.project, clipId, edge) : null;
      if (!found) return null;
      const { value, range } = found;
      const limit =
        value === range.min ? range.minLimit : value === range.max ? range.maxLimit : null;
      const neighbor = limit === "neighbor" ? neighborName(document.project, clipId, edge) : null;
      return { value, min: range.min, max: range.max, limit, neighbor };
    }),
  );
  if (!state) return { "aria-hidden": true };
  const { value, min, max, limit, neighbor } = state;
  const at = formatTimecode(value, fps);
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    // ⌥ with the arrows nudges the clip instead (src/app/keyboard.ts).
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const second = event.shiftKey ? fps : 1;
    const step: Record<string, Frames> = {
      ArrowLeft: -second,
      ArrowDown: -second,
      ArrowRight: second,
      ArrowUp: second,
      PageDown: -fps,
      PageUp: fps,
    };
    const by = step[event.key];
    if (by !== undefined) trimEdgeBy(clipId, edge, by);
    else if (event.key === "Home") trimEdgeTo(clipId, edge, "min");
    else if (event.key === "End") trimEdgeTo(clipId, edge, "max");
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return {
    role: "slider",
    tabIndex: 0,
    "aria-label": `${edge === "start" ? "Start" : "End"} of ${name}`,
    "aria-orientation": "horizontal",
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": value,
    "aria-valuetext": limit === null ? at : `${at}, ${limitText(limit, edge, neighbor)}`,
    onKeyDown,
  };
}
/** How far the hatching reaches past a source's end; the tracks' edge or the next clip cuts it off. */
const HATCH_WIDTH = 4096;

/**
 * Past the end of a source, hatched, while a trim handle is held there: frames the clip can't
 * have. Drawn under the clips, so a neighbor covers its part.
 */
export function SourceLimit({ pxPerFrame }: { pxPerFrame: number }) {
  const gesture = useGestureStore((state) =>
    state.gesture?.kind === "trim" && state.gesture.limit === "source" ? state.gesture : null,
  );
  const trackId = useDocumentStore((state) =>
    gesture ? findClip(state.project, gesture.clipId)?.track.id : undefined,
  );
  const row = trackId === undefined ? undefined : rowOf(trackId);
  if (!gesture || !row) return null;
  const fromStart = gesture.edge === "start";
  const x = (fromStart ? gesture.start : gesture.start + gesture.duration) * pxPerFrame;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bg-[repeating-linear-gradient(135deg,var(--color-surface)_0_6px,var(--color-bg)_6px_12px)]"
      style={{
        left: fromStart ? x - HATCH_WIDTH : x,
        width: HATCH_WIDTH,
        top: row.clipTop,
        height: row.clipHeight,
      }}
    />
  );
}
