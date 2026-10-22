// The timeline (spec sections 3.1 and 4.4): the track names, the ruler, V2, V1 and A1 with their
// clips, the playhead, the snap line and the scroll bar. Clips are absolutely positioned in one
// layer that translate3d scrolls, so scrolling never re-renders them; zooming re-renders them
// with new positions. The wheel scrolls; Cmd/Ctrl + wheel zooms around the pointer.

import {
  memo,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";
import { MusicIcon, VideoTrackIcon } from "../app/icons.tsx";
import { projectDuration } from "../engine/project.ts";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { assetDurationFrames, formatTimecode } from "../engine/time.ts";
import type { Fps, Track } from "../engine/types.ts";
import { contentWidth, wheelZoomFactor } from "../engine/viewport.ts";
import { thumbnailCount } from "../media/thumbnails.ts";
import { ClipView, SourceLimit } from "./ClipView.tsx";
import { pressRuler, snapLineOf, useGestureStore } from "./gestures.ts";
import { lanesPoint, registerLanes, setHoverClientX } from "./lanes.ts";
import { clipWidth, rowOf, TRACKS_HEIGHT } from "./layout.ts";
import { Playhead } from "./Playhead.tsx";
import { RulerTicks } from "./Ruler.tsx";

/** Rows' heights and borders, as drawn: the tokens from `src/app/editor-tokens.css`. */
const ROW_STYLES: Record<string, string> = {
  V2: "h-track-v2 border-surface-raised",
  V1: "h-track-v1 border-surface-raised",
  A1: "h-track-a1 border-line",
};

export function Timeline() {
  const tracks = useDocumentStore((state) => state.project.tracks);
  return (
    <section aria-label="Timeline" className="flex h-73 flex-none touch-none select-none">
      <TrackNames tracks={tracks} />
      <Lanes tracks={tracks} />
    </section>
  );
}

/** The V2, V1 and A1 column. The active track, which S splits on, has the brighter name. */
function TrackNames({ tracks }: { tracks: readonly Track[] }) {
  const activeTrackId = useUiStore((state) => state.activeTrackId);
  return (
    <div className="flex w-track-header flex-none flex-col border-r border-line bg-surface">
      <div className="h-ruler flex-none border-b border-line" />
      {tracks.map((track) => (
        <div
          key={track.id}
          className={`flex flex-none items-center gap-2 border-b px-3 ${ROW_STYLES[track.id] ?? ""} ${track.id === activeTrackId ? "text-fg" : "text-fg-muted"}`}
        >
          {track.kind === "audio" ? <MusicIcon size={14} /> : <VideoTrackIcon size={14} />}
          <span className="font-mono text-xs">{track.id}</span>
        </div>
      ))}
    </div>
  );
}

function Lanes({ tracks }: { tracks: readonly Track[] }) {
  const lanesRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  useLanes(lanesRef, layerRef);

  const v1Empty = tracks.find((track) => track.id === "V1")?.clips.length === 0;
  const hints: Record<string, string | null> = {
    V2: v1Empty ? null : "Drop a clip here to layer it over V1",
    V1: "Drag clips here from the media bin, or select one there and press Enter to add it at the playhead.",
    A1: "Music goes here.",
  };

  return (
    <div
      ref={lanesRef}
      // Clip, not hidden: a hidden overflow can still be scrolled by the browser (to show a
      // focused clip), which would move everything away from where the pointer math puts it.
      className="relative min-w-0 flex-1 overflow-clip"
      onPointerDown={(event) => {
        // A press on an empty part of a track selects nothing and makes that track active.
        if (!(event.target instanceof HTMLElement)) return;
        const trackId = event.target.dataset.trackId;
        if (trackId === undefined || event.button !== 0) return;
        useUiStore.getState().clearSelection();
        useUiStore.getState().setActiveTrack(trackId);
      }}
      onPointerMove={(event) => {
        setHoverClientX(event.clientX);
      }}
      onPointerLeave={() => {
        setHoverClientX(null);
      }}
    >
      <div className="h-ruler border-b border-line bg-surface" />
      {tracks.map((track) => {
        const hint = track.clips.length === 0 ? hints[track.id] : null;
        return (
          <div
            key={track.id}
            data-track-id={track.id}
            className={`relative border-b ${ROW_STYLES[track.id] ?? ""}`}
          >
            {hint && (
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs text-fg-subtle">
                {hint}
              </span>
            )}
          </div>
        );
      })}

      <div
        ref={layerRef}
        className="pointer-events-none absolute top-0 left-0 will-change-transform"
      >
        <RulerTicks />
        <Clips tracks={tracks} />
        <DropGhost />
        <SnapLine />
        <Playhead />
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-ruler cursor-pointer"
        onPointerDown={pressRuler}
      />
      <Scrollbar />
    </div>
  );
}

/**
 * Wires the tracks' area on the page: registers it for pointer math, measures its width for the
 * zoom range, scrolls the clip layer with translate3d, and turns the wheel into scrolling and
 * zooming.
 */
function useLanes(
  lanesRef: RefObject<HTMLDivElement | null>,
  layerRef: RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    const lanes = lanesRef.current;
    const layer = layerRef.current;
    if (!lanes || !layer) return;
    registerLanes(lanes);

    const measure = () => {
      useUiStore.getState().setViewportWidth(lanes.clientWidth);
    };
    measure();
    const resizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizes?.observe(lanes);

    const scrollTo = (scrollX: number) => {
      layer.style.transform = `translate3d(${-scrollX}px, 0, 0)`;
    };
    scrollTo(useUiStore.getState().scrollX);
    const unsubscribe = useUiStore.subscribe((state, previous) => {
      if (state.scrollX !== previous.scrollX) scrollTo(state.scrollX);
    });

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Lines (Firefox) and pages become pixels, so every wheel moves the same distance.
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? lanes.clientWidth : 1;
      const ui = useUiStore.getState();
      if (event.ctrlKey || event.metaKey) {
        const x = lanesPoint(event.clientX, event.clientY)?.x ?? 0;
        ui.zoomBy(wheelZoomFactor(event.deltaY * scale), x);
        return;
      }
      // The tracks only scroll sideways, so an up-and-down wheel scrolls them too.
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      ui.setScrollX(ui.scrollX + delta * scale);
    };
    lanes.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      registerLanes(null);
      resizes?.disconnect();
      unsubscribe();
      lanes.removeEventListener("wheel", onWheel);
    };
  }, [lanesRef, layerRef]);
}

/** Every clip, positioned at the zoom, with the hatching for a trim at a source's end under them. */
function Clips({ tracks }: { tracks: readonly Track[] }) {
  const pxPerFrame = useUiStore((state) => state.pxPerFrame);
  const fps = useDocumentStore((state) => state.project.fps);
  return (
    <>
      <SourceLimit pxPerFrame={pxPerFrame} />
      {tracks.map((track) => (
        <TrackClips key={track.id} track={track} pxPerFrame={pxPerFrame} fps={fps} />
      ))}
    </>
  );
}

const TrackClips = memo(function TrackClips({
  track,
  pxPerFrame,
  fps,
}: {
  track: Track;
  pxPerFrame: number;
  fps: Fps;
}) {
  const assets = useDocumentStore((state) => state.project.assets);
  return track.clips.map((clip) => {
    const asset = Object.hasOwn(assets, clip.assetId) ? assets[clip.assetId] : undefined;
    return (
      <ClipView
        key={clip.id}
        clip={clip}
        trackId={track.id}
        name={asset?.name ?? clip.id}
        asset={asset}
        aspect={asset?.width && asset.height ? asset.width / asset.height : 16 / 9}
        thumbnailCount={asset?.kind === "video" ? thumbnailCount(asset.durationSec) : 0}
        pxPerFrame={pxPerFrame}
        fps={fps}
        sourceFrames={asset ? assetDurationFrames(asset, fps) : clip.in + clip.duration}
      />
    );
  });
});

/** Where a card dragged from the media bin would land: a dashed accent outline. */
function DropGhost() {
  const drop = useGestureStore((state) => (state.gesture?.kind === "drop" ? state.gesture : null));
  const pxPerFrame = useUiStore((state) => state.pxPerFrame);
  const placement = drop?.placement;
  const row = placement ? rowOf(placement.trackId) : undefined;
  if (!drop || !placement || !row) return null;
  return (
    <div
      aria-hidden="true"
      className={`absolute z-20 rounded-clip border-[1.5px] border-dashed ${placement.fits ? "border-accent bg-accent/12" : "border-line-strong opacity-70"}`}
      style={{
        left: placement.start * pxPerFrame,
        width: clipWidth(placement.duration, pxPerFrame),
        top: row.clipTop,
        height: row.clipHeight,
      }}
    >
      <span className="absolute top-1 left-1.5 text-2xs whitespace-nowrap text-fg">
        {drop.name}
      </span>
      <span className="absolute bottom-1.5 left-1.5 font-mono text-2xs whitespace-nowrap text-fg-muted">
        {placement.fits
          ? `at ${formatTimecode(placement.start, drop.fps)}`
          : `No room on ${placement.trackId}`}
      </span>
    </div>
  );
}

/** The snap line: 1 px of white across the ruler and the tracks, with a small diamond on top. */
function SnapLine() {
  const at = useGestureStore((state) => snapLineOf(state.gesture));
  const pxPerFrame = useUiStore((state) => state.pxPerFrame);
  if (at === null) return null;
  const x = at * pxPerFrame;
  return (
    <div
      aria-hidden="true"
      data-snap-line={at}
      className="absolute top-0 left-0 z-30"
      style={{ height: TRACKS_HEIGHT }}
    >
      <div className="absolute inset-y-0 w-px bg-snap" style={{ left: x - 0.5 }} />
      <div
        className="absolute top-0 size-1.5 bg-snap"
        style={{ left: x - 3, transform: "rotate(45deg) translate(-2px, -2px)" }}
      />
    </div>
  );
}

/**
 * The scroll bar under the tracks, as drawn: a rounded track and a thumb as wide as the share of
 * the content in view. Drag the thumb, or press the track to jump there. The wheel and the keys do
 * the same for keyboard and trackpad users, so it's hidden from assistive technology.
 */
function Scrollbar() {
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollX = useUiStore((state) => state.scrollX);
  const pxPerFrame = useUiStore((state) => state.pxPerFrame);
  const viewportWidth = useUiStore((state) => state.viewportWidth);
  const duration = useDocumentStore((state) => projectDuration(state.project));

  const content = contentWidth(duration, pxPerFrame, viewportWidth);
  const trackWidth = Math.max(0, viewportWidth - 16);
  const thumbWidth = Math.min(trackWidth, Math.max(24, (trackWidth * viewportWidth) / content));
  const maxScroll = content - viewportWidth;
  const travel = trackWidth - thumbWidth;
  const thumbLeft = maxScroll > 0 && travel > 0 ? (scrollX / maxScroll) * travel : 0;

  /** Follows the pointer from a press until release, keeping the thumb's grab point under it. */
  const drag = (event: ReactPointerEvent<HTMLElement>, grabX: number) => {
    const track = trackRef.current;
    if (!track || travel <= 0) return;
    const left = track.getBoundingClientRect().left;
    const follow = (clientX: number) => {
      const thumbX = Math.min(travel, Math.max(0, clientX - left - grabX));
      useUiStore.getState().setScrollX((thumbX / travel) * maxScroll);
    };
    follow(event.clientX);
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      follow(move.clientX);
    };
    const onUp = () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
  };

  return (
    <div aria-hidden="true" className="absolute inset-x-0 bottom-2 h-2 px-2">
      <div
        ref={trackRef}
        className="relative h-2 rounded-pill bg-surface"
        onPointerDown={(event) => {
          if (event.button === 0) drag(event, thumbWidth / 2);
        }}
      >
        <div
          className="absolute top-0 h-2 rounded-pill bg-line transition-colors duration-(--dur-fast) hover:bg-line-strong"
          style={{ left: thumbLeft, width: viewportWidth > 0 ? thumbWidth : "100%" }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            drag(event, event.clientX - event.currentTarget.getBoundingClientRect().left);
          }}
        />
      </div>
    </div>
  );
}
