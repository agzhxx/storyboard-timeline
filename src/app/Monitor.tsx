// The program monitor (spec section 3.1; Main and Messages boards): the frame at the playhead in a
// 16:9 picture, V2 over V1, then the timecode, the transport and the rate. The picture is a canvas
// that src/media/program.ts draws: exact frames from the decode worker, the nearest thumbnail
// marked "Preview" while scrubbing, a dimmed picture and a spinner while a jump's frame decodes,
// and playback's frames. A frame that won't decode during playback pauses it with the board's
// message; one whose media didn't load (the network) pauses it with its own, and Play again. With
// an empty project the monitor shows "Start a cut".

import { lazy, Suspense, useCallback, useLayoutEffect, useRef } from "react";
import { clipAt, findAsset, findClip, projectDuration } from "../engine/project.ts";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { formatTimecode } from "../engine/time.ts";
import type { Frames, Project } from "../engine/types.ts";
import { useMediaCache } from "../media/media-cache.ts";
import { useMissingMedia } from "../media/missing.ts";
import { type DecodeStop, usePlaybackStore } from "../media/playback-state.ts";
import { program, useProgramStore } from "../media/program.ts";
import { perfMode } from "../perf/counters.ts";
import { useGestureStore } from "../timeline/gestures.ts";
import { usePlayheadWriter } from "../timeline/playhead-loop.ts";
import {
  backOneFrame,
  forwardOneFrame,
  goToEnd,
  goToStart,
  playAgain,
  playFromNextClip,
  togglePlayback,
} from "./actions.ts";
import { chooseFiles } from "./file-picker.ts";
import {
  FrameBackIcon,
  FrameForwardIcon,
  GoToEndIcon,
  GoToStartIcon,
  PauseIcon,
  PlayIcon,
  SpinnerIcon,
  WarningIcon,
} from "./icons.tsx";
import { loadRobotStory, useStoryLoad } from "./story-loader.ts";
import { IconButton, PanelHeader, PrimaryButton, SecondaryButton } from "./ui.tsx";

/** The perf overlay loads, as its own chunk, only with `?perf=1` (spec section 4.8). */
const PerfOverlay = lazy(() => import("../perf/PerfOverlay.tsx"));

export function Monitor() {
  const width = useDocumentStore((state) => state.project.width);
  const height = useDocumentStore((state) => state.project.height);
  const fps = useDocumentStore((state) => state.project.fps);
  const empty = useDocumentStore((state) =>
    state.project.tracks.every((t) => t.clips.length === 0),
  );
  return (
    <section aria-label="Program monitor" className="flex min-w-0 flex-1 flex-col">
      <PanelHeader title="Program">
        <span className="rounded-badge bg-surface px-1.5 py-0.5 font-mono text-2xs text-fg-subtle">
          {width} × {height} · {fps} fps
        </span>
      </PanelHeader>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 [container-type:size]">
        <div className="relative aspect-video w-[min(100%,697px,calc(100cqh*16/9))] overflow-hidden bg-monitor">
          {empty ? <StartACut /> : <Picture />}
          {perfMode && (
            <Suspense fallback={null}>
              <PerfOverlay />
            </Suspense>
          )}
        </div>
      </div>
      <Transport empty={empty} />
    </section>
  );
}

function StartACut() {
  const loading = useStoryLoad((state) => state.loading);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="max-w-[420px]">
        <h2 className="text-lg font-semibold">Start a cut</h2>
        <p className="mt-2 text-base text-fg-muted">
          Load the robot story: 15 AI clips from the Generation Feed and a music track. Or add your
          own files. Nothing is uploaded; it all stays in this browser.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <PrimaryButton
          aria-disabled={loading}
          onClick={() => {
            void loadRobotStory();
          }}
        >
          {loading ? (
            <>
              <SpinnerIcon />
              Loading the robot story…
            </>
          ) : (
            "Load the robot story"
          )}
        </PrimaryButton>
        <SecondaryButton className="px-3.5" onClick={chooseFiles}>
          Add your own files
        </SecondaryButton>
      </div>
    </div>
  );
}

/** The clip a viewer would see at a frame: V2's when it has one there, else V1's. */
function topClipAt(project: Project, frame: Frames) {
  for (const track of project.tracks) {
    if (track.kind !== "video") continue;
    const clip = clipAt(track, frame);
    if (clip) return clip;
  }
  return undefined;
}

/**
 * The monitor's picture, over a 16:9 box its parent draws: the program canvas and its states. The
 * phone view shows it too.
 */
export function Picture() {
  const canvasRef = useProgramCanvas();
  const project = useDocumentStore((state) => state.project);
  // Re-renders only when the clip on top at the playhead changes, not on every frame.
  const clipId = useUiStore((state) => topClipAt(project, state.playhead)?.id);
  const clip = clipId === undefined ? undefined : findClip(project, clipId)?.clip;
  const asset = clip && findAsset(project, clip.assetId);
  const { preview, loading } = useProgramStore();
  const stop = usePlaybackStore((state) => state.stop);

  const label = !asset
    ? "No clip at the playhead"
    : preview
      ? `${asset.name}, a preview from its thumbnails`
      : `${asset.name} at the playhead`;
  const dim = stop ? "opacity-25" : loading ? "opacity-35" : "";
  return (
    <>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={`block size-full ${dim} ${preview ? "blur-[0.6px]" : ""}`}
      />
      {preview && !stop && (
        <span className="absolute top-2 left-2 rounded-badge bg-scrim px-1.5 text-2xs text-fg-muted">
          Preview
        </span>
      )}
      {loading && !stop && (
        <span className="absolute top-1/2 left-1/2 -mt-4 -ml-4 flex size-8 items-center justify-center rounded-pill bg-scrim">
          <SpinnerIcon size={18} />
          <span className="sr-only">Loading the frame</span>
        </span>
      )}
      {stop && <CantDecode stop={stop} fps={project.fps} />}
    </>
  );
}

/**
 * Hands the canvas to the program picture, and tells it when to draw: the playhead moved (once per
 * animation frame), the document changed, a thumbnail came in, or the canvas changed size.
 */
function useProgramCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    program.attach(canvas);
    const unsubscribers = [
      useDocumentStore.subscribe(({ project }, previous) => {
        if (project !== previous.project) program.refresh();
      }),
      useMediaCache.subscribe(({ thumbnails }, previous) => {
        if (thumbnails !== previous.thumbnails) program.thumbnailsChanged();
      }),
    ];
    let size = canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : "";
    const resizes =
      canvas && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            const next = `${canvas.clientWidth}x${canvas.clientHeight}`;
            if (next === size) return;
            size = next;
            program.resized();
          })
        : null;
    if (canvas) resizes?.observe(canvas);
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      resizes?.disconnect();
      program.attach(null);
    };
  }, []);
  const write = useCallback((frame: Frames) => {
    program.moveTo(frame, useGestureStore.getState().gesture?.kind === "scrub");
  }, []);
  usePlayheadWriter(write);
  return ref;
}

/**
 * Messages board, "Decode error during playback: paused". A clip whose media didn't load (no
 * answer, an error status, offline) gets the same look with its own words, and Play again: the
 * next try may load it. So does a file whose copy is gone from this browser's storage.
 */
function CantDecode({ stop, fps }: { stop: DecodeStop; fps: Project["fps"] }) {
  const at = <span className="font-mono">{formatTimecode(stop.frame, fps)}</span>;
  const missing = useMissingMedia((state) => {
    const found = findClip(useDocumentStore.getState().project, stop.clipId);
    return found !== undefined && state.assetIds.includes(found.clip.assetId);
  });
  return (
    <div
      role="alert"
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center"
    >
      <WarningIcon size={18} stroke="var(--color-danger)" />
      {missing ? (
        <>
          <span className="text-xs font-semibold">Can't find {stop.name}</span>
          <span className="text-2xs text-fg-muted">
            Its copy isn&rsquo;t in this browser any more. Paused at {at}.
          </span>
        </>
      ) : stop.unreachable ? (
        <>
          <span className="text-xs font-semibold">Couldn't load {stop.name}</span>
          <span className="text-2xs text-fg-muted">
            Its file didn&rsquo;t answer. Paused at {at}; check your connection.
          </span>
        </>
      ) : (
        <>
          <span className="text-xs font-semibold">Can't decode {stop.name} here</span>
          <span className="text-2xs text-fg-muted">
            Paused at {at}. The rest of the cut still plays.
          </span>
        </>
      )}
      <button
        type="button"
        className="mt-0.5 h-7 rounded-card bg-surface-raised px-2.5 text-xs text-fg shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-(--dur-fast) hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
        onClick={stop.unreachable && !missing ? playAgain : playFromNextClip}
      >
        {stop.unreachable && !missing ? "Play again" : "Play from the next clip"}
      </button>
    </div>
  );
}

function Transport({ empty }: { empty: boolean }) {
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const fps = useDocumentStore((state) => state.project.fps);
  const duration = useDocumentStore((state) => projectDuration(state.project));
  const playing = usePlaybackStore((state) => state.status !== "paused");
  const rate = usePlaybackStore((state) => state.rate);
  const write = useCallback(
    (frame: Frames) => {
      if (timecodeRef.current) timecodeRef.current.textContent = formatTimecode(frame, fps);
    },
    [fps],
  );
  usePlayheadWriter(write);
  return (
    <div className="grid h-16 flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4">
      <div className="flex items-baseline gap-1.5 font-mono whitespace-nowrap tabular-nums">
        <span
          ref={timecodeRef}
          role="timer"
          aria-label="Playhead"
          className={`text-md ${empty ? "text-fg-subtle" : "text-fg"}`}
        />
        <span className="text-xs text-fg-subtle">/ {formatTimecode(duration, fps)}</span>
      </div>
      <div className="flex items-center gap-1">
        <IconButton
          aria-label="Go to start"
          aria-keyshortcuts="Home"
          disabled={empty}
          onClick={goToStart}
        >
          <GoToStartIcon size={18} />
        </IconButton>
        <IconButton
          aria-label="Back one frame"
          aria-keyshortcuts="ArrowLeft"
          disabled={empty}
          onClick={backOneFrame}
        >
          <FrameBackIcon size={18} />
        </IconButton>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          aria-keyshortcuts="Space"
          disabled={empty}
          className="mx-1 inline-flex size-11 flex-none items-center justify-center rounded-pill bg-fg text-bg transition-colors duration-(--dur-fast) hover:bg-fg-muted disabled:pointer-events-none disabled:opacity-40"
          onClick={togglePlayback}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <IconButton
          aria-label="Forward one frame"
          aria-keyshortcuts="ArrowRight"
          disabled={empty}
          onClick={forwardOneFrame}
        >
          <FrameForwardIcon size={18} />
        </IconButton>
        <IconButton
          aria-label="Go to end"
          aria-keyshortcuts="End"
          disabled={empty}
          onClick={goToEnd}
        >
          <GoToEndIcon size={18} />
        </IconButton>
      </div>
      <div className="flex justify-end">
        <span className="rounded-badge bg-surface px-1.5 py-0.5 font-mono text-2xs text-fg-subtle">
          <span className="sr-only">Playback rate </span>
          {rate}×
        </span>
      </div>
    </div>
  );
}
