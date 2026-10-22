// The phone view (spec section 3.6, "Phone width"; Phone board, 390 × 844): read-only. The saved
// project plays on the monitor, with Play and the timecode, a filmstrip of the whole cut with the
// part already played dimmed and the playhead, the clip at the playhead, a note that editing works
// best on a laptop, and where the clips come from. With nothing saved, it offers to play the robot
// story. Its own chunk, loaded only on a narrow screen (src/app/Root.tsx).

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { togglePlayback } from "../app/actions.ts";
import { LaptopIcon, Logo, PauseIcon, PlayIcon, SpinnerIcon } from "../app/icons.tsx";
import { Picture } from "../app/Monitor.tsx";
import { loadRobotStory, useStoryLoad } from "../app/story-loader.ts";
import { Toasts } from "../app/Toasts.tsx";
import { PrimaryButton } from "../app/ui.tsx";
import { projectDuration } from "../engine/project.ts";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { formatTimecode, sourceSeconds } from "../engine/time.ts";
import type { Frames } from "../engine/types.ts";
import { audioContext } from "../media/audio.ts";
import { requestMedia } from "../media/library.ts";
import { useMediaCache } from "../media/media-cache.ts";
import { playback } from "../media/playback.ts";
import { usePlaybackStore } from "../media/playback-state.ts";
import { thumbnailCount, thumbnailIndexAt } from "../media/thumbnails.ts";
import { canvasContext } from "../timeline/draw.ts";
import { usePlayheadWriter } from "../timeline/playhead-loop.ts";
import { cutCredits, cutPieces, type Piece, pieceAt } from "./cut-strip.ts";

export default function PhoneView() {
  const name = useDocumentStore((state) => state.project.name);
  const empty = useDocumentStore((state) => projectDuration(state.project) === 0);
  const credits = useDocumentStore((state) => cutCredits(state.project));
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex h-[52px] flex-none items-center gap-2.5 border-b border-line px-4">
        <Logo />
        <h1 className="text-sm font-semibold whitespace-nowrap">Storyboard Timeline</h1>
        <span className="ml-auto truncate text-xs text-fg-subtle">{name}</span>
      </header>
      <section aria-label="Program monitor" className="relative aspect-video flex-none bg-monitor">
        {empty ? <OfferStory /> : <Picture />}
      </section>
      <div className="flex flex-col gap-3.5 p-4">
        <Transport empty={empty} />
        {!empty && <CutStrip />}
        <div className="flex gap-3 rounded-panel bg-surface p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <span className="mt-px text-fg-muted">
            <LaptopIcon size={18} />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Editing works best on a laptop</h2>
            <p className="mt-1 text-xs text-fg-muted">
              Here you can watch the cut. To trim, split and export, open this page on a computer
              with a keyboard and mouse.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1 pt-1 text-xs text-fg-subtle">
          {credits !== null && <p>{credits}</p>}
          <p>Saved in this browser only.</p>
        </div>
      </div>
      <Toasts />
    </div>
  );
}

/**
 * Nothing saved here: the robot story, which plays once it's in. The sound starts inside the tap,
 * as phones ask, before the story loads.
 */
function OfferStory() {
  const loading = useStoryLoad((state) => state.loading);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-sm text-fg-muted">Nothing is saved in this browser yet.</p>
      <PrimaryButton
        aria-disabled={loading}
        onClick={() => {
          if (loading) return;
          wakeSound();
          void loadRobotStory().then(() => {
            if (projectDuration(useDocumentStore.getState().project) > 0) playback.play(1);
          });
        }}
      >
        {loading ? (
          <>
            <SpinnerIcon />
            Loading the robot story…
          </>
        ) : (
          "Play the robot story"
        )}
      </PrimaryButton>
    </div>
  );
}

/** Lets sound start, inside the tap, as phones ask. Without Web Audio, playback runs silent. */
function wakeSound(): void {
  try {
    void audioContext()
      .resume()
      .catch(() => undefined);
  } catch {
    // No Web Audio here: the clock follows performance.now() (src/media/clock.ts).
  }
}

/** Play or Pause, round and white, and the timecode over the cut's length. */
function Transport({ empty }: { empty: boolean }) {
  const timecode = useRef<HTMLSpanElement>(null);
  const fps = useDocumentStore((state) => state.project.fps);
  const duration = useDocumentStore((state) => projectDuration(state.project));
  const playing = usePlaybackStore((state) => state.status !== "paused");
  const write = useCallback(
    (frame: Frames) => {
      if (timecode.current) timecode.current.textContent = formatTimecode(frame, fps);
    },
    [fps],
  );
  usePlayheadWriter(write);
  return (
    <div className="flex items-center gap-3.5">
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        disabled={empty}
        className="inline-flex size-12 flex-none items-center justify-center rounded-pill bg-fg text-bg transition-colors duration-(--dur-fast) hover:bg-fg-muted disabled:pointer-events-none disabled:opacity-40"
        onClick={togglePlayback}
      >
        {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
      </button>
      <div className="flex flex-col font-mono tabular-nums">
        <span ref={timecode} role="timer" aria-label="Playhead" className="text-md" />
        <span className="text-xs text-fg-subtle">of {formatTimecode(duration, fps)}</span>
      </div>
    </div>
  );
}

/**
 * The whole cut, 44 px tall: each stretch's picture as wide as it lasts, the part already played
 * dimmed, the playhead, and the clip at the playhead under it. Screen readers get the clip line.
 */
function CutStrip() {
  const project = useDocumentStore((state) => state.project);
  const pieces = useMemo(() => cutPieces(project), [project]);
  const duration = projectDuration(project);
  const index = useUiStore((state) => pieceAt(pieces, state.playhead));
  const played = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const write = useCallback(
    (frame: Frames) => {
      const share = `${(duration > 0 ? Math.min(1, frame / duration) : 0) * 100}%`;
      if (played.current) played.current.style.width = share;
      if (line.current) line.current.style.left = share;
    },
    [duration],
  );
  usePlayheadWriter(write);
  const clips = pieces.filter((piece) => piece.clip !== null);
  const shown = pieces[index];
  const position = shown?.clip ? clips.indexOf(shown) + 1 : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        aria-hidden="true"
        className="relative h-11 overflow-hidden rounded-card bg-surface-raised"
      >
        <StripPictures pieces={pieces} duration={duration} />
        <div ref={played} className="absolute inset-y-0 left-0 bg-bg/35" />
        <div ref={line} className="absolute inset-y-0 -ml-px w-0.5 bg-playhead" />
      </div>
      <p className="text-xs text-fg-subtle">
        {shown?.asset
          ? `${shown.asset.name} · clip ${position} of ${clips.length}`
          : "No clip at the playhead"}
      </p>
    </div>
  );
}

/** The line between two stretches: the page's color (`--color-bg`), which a canvas can't read. */
const DIVIDER = "#0b0b0c";

/** Each stretch's picture, cropped to fill its share of the strip, with a dark line between. */
function StripPictures({ pieces, duration }: { pieces: readonly Piece[]; duration: Frames }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const thumbnails = useMediaCache((cache) => cache.thumbnails);
  const fps = useDocumentStore((state) => state.project.fps);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => {
      setWidth(element.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const resizes = new ResizeObserver(measure);
    resizes.observe(element);
    return () => {
      resizes.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    for (const piece of pieces) if (piece.asset) requestMedia(piece.asset);
  }, [pieces]);

  useLayoutEffect(() => {
    const element = canvas.current;
    const height = element?.clientHeight ?? 0;
    const context = element && width > 0 ? canvasContext(element, width, height) : null;
    if (!context || duration <= 0) return;
    context.clearRect(0, 0, width, height);
    for (const piece of pieces) {
      const x = (piece.start / duration) * width;
      const w = (piece.duration / duration) * width;
      const { clip, asset } = piece;
      const list = asset ? thumbnails[asset.id] : undefined;
      if (clip && asset && list) {
        const seconds = sourceSeconds(clip.in + (piece.start - clip.start), fps);
        const image = list[thumbnailIndexAt(seconds, thumbnailCount(asset.durationSec))];
        if (image) drawCover(context, image, x, w, height);
      }
      // A 1 px line of the page's color after each stretch, as drawn.
      if (piece.start + piece.duration < duration) {
        context.fillStyle = DIVIDER;
        context.fillRect(Math.round(x + w) - 1, 0, 1, height);
      }
    }
  }, [pieces, thumbnails, duration, width, fps]);

  return <canvas ref={canvas} className="absolute inset-0 size-full" />;
}

/** An image scaled to fill a stretch of the strip, its middle in the middle, cut to the stretch. */
function drawCover(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / image.width, height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  context.save();
  context.beginPath();
  context.rect(x, 0, width, height);
  context.clip();
  context.drawImage(
    image,
    x + (width - drawnWidth) / 2,
    (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
  context.restore();
}
