// The inspector (Inspector states board): read-only details of the selected clip, a summary of
// several, and the one field that edits: the playhead's timecode. Split and Delete do what S and
// Delete do.

import { useCallback, useId, useRef, useState } from "react";
import { findAsset, findClip } from "../engine/project.ts";
import { useDocumentStore, useUiStore } from "../engine/store.ts";
import { formatTimecode, parseTimecode } from "../engine/time.ts";
import type { Asset, Clip, Frames } from "../engine/types.ts";
import { formatFps } from "../media/facts.ts";
import { usePlayheadWriter } from "../timeline/playhead-loop.ts";
import { deleteSelection, movePlayhead, splitAtPlayhead } from "./actions.ts";
import { AssetPreview } from "./AssetPreview.tsx";
import { DeleteIcon, SplitIcon, WarningIcon } from "./icons.tsx";
import { AiBadge, Kbd, PanelHeader, SecondaryButton } from "./ui.tsx";

export function Inspector() {
  const selection = useUiStore((state) => state.selection);
  const hasClips = useDocumentStore((state) =>
    state.project.tracks.some((t) => t.clips.length > 0),
  );
  const [only] = selection;
  let content;
  if (!hasClips) {
    content = (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-sm text-fg-subtle">Select a clip to see its details here.</p>
      </div>
    );
  } else if (only === undefined) {
    content = (
      <>
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center">
          <p className="text-sm text-fg-muted">Select a clip to see its details here.</p>
          <p className="text-xs text-fg-subtle">Shift-click adds more clips.</p>
        </div>
        <div className="px-4 pb-4">
          <PlayheadField />
        </div>
      </>
    );
  } else if (selection.length === 1) {
    content = <ClipDetails clipId={only} />;
  } else {
    content = <SeveralClips clipIds={selection} />;
  }
  return (
    <section
      aria-label="Inspector"
      className="flex w-inspector flex-none flex-col border-l border-line bg-surface"
    >
      <PanelHeader title="Inspector" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{content}</div>
    </section>
  );
}

function ClipDetails({ clipId }: { clipId: string }) {
  const project = useDocumentStore((state) => state.project);
  const found = findClip(project, clipId);
  const asset = found && findAsset(project, found.clip.assetId);
  if (!found || !asset) return null;
  const { clip } = found;
  const tc = (frames: Frames) => formatTimecode(frames, project.fps);
  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <div className="relative">
        <AssetPreview
          asset={asset}
          sourceFrame={clip.in}
          fps={project.fps}
          exact
          className="block aspect-video w-full rounded-card"
        />
        {asset.source.type === "feed" && <AiBadge className="top-1.5 left-1.5" />}
      </div>
      <div>
        <h3 className="text-md font-semibold break-words">{asset.name}</h3>
        <p className="text-xs text-fg-muted">
          {origin(asset)}
          {asset.source.type === "feed" && <span className="sr-only">, AI-generated</span>}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-y border-line py-3 text-xs">
        <Detail term="Start" value={tc(clip.start)} mono />
        <Detail term="Duration" value={tc(clip.duration)} mono />
        <Detail term="In" value={tc(clip.in)} mono />
        <Detail term="Out" value={tc(clip.in + clip.duration)} mono />
        <Detail term="Source" value={sourceDetails(asset)} />
      </dl>
      <PlayheadField />
      <div className="grid grid-cols-2 gap-2">
        <SecondaryButton aria-keyshortcuts="S" onClick={splitAtPlayhead}>
          <SplitIcon />
          Split
          <Kbd>S</Kbd>
        </SecondaryButton>
        <SecondaryButton aria-keyshortcuts="Delete Backspace" onClick={deleteSelection}>
          <DeleteIcon />
          Delete
          <Kbd>⌫</Kbd>
        </SecondaryButton>
      </div>
    </div>
  );
}

function Detail({ term, value, mono = false }: { term: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-subtle">{term}</dt>
      <dd className={`text-right ${mono ? "font-mono tabular-nums" : "text-fg-muted"}`}>{value}</dd>
    </>
  );
}

/** Where an asset comes from, under its name: "From the Feed · Kling 2.5 Pro", as drawn. */
function origin(asset: Asset): string {
  switch (asset.source.type) {
    case "feed":
      return `From the Feed · ${asset.source.model}`;
    case "file":
      return "From your files";
    case "url":
      return "Comes with the app · license in the README";
  }
}

/** "1920 × 1080 · 24 fps · 5 s" for a video, "Audio · 45 s" for music. */
function sourceDetails(asset: Asset): string {
  const seconds = `${Number(asset.durationSec.toFixed(2))} s`;
  if (asset.kind === "audio") return `Audio · ${seconds}`;
  const size = asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : "";
  const rate = asset.fps ? `${formatFps(asset.fps)} · ` : "";
  return `${size}${rate}${seconds}`;
}

function SeveralClips({ clipIds }: { clipIds: readonly string[] }) {
  const project = useDocumentStore((state) => state.project);
  const tc = (frames: Frames) => formatTimecode(frames, project.fps);
  const found = clipIds
    .map((clipId) => findClip(project, clipId))
    .filter((entry) => entry !== undefined);
  const order = project.tracks.map((track) => track.id);
  found.sort(
    (a, b) => a.clip.start - b.clip.start || order.indexOf(a.track.id) - order.indexOf(b.track.id),
  );
  const total = found.reduce((sum, { clip }) => sum + clip.duration, 0);
  const tracks = order.filter((trackId) => found.some((entry) => entry.track.id === trackId));
  const where =
    tracks.length === 1
      ? `all on ${tracks[0] ?? ""}`
      : `on ${tracks.slice(0, -1).join(", ")} and ${tracks.at(-1) ?? ""}`;
  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <div>
        <h3 className="text-md font-semibold">{found.length} clips selected</h3>
        <p className="text-xs text-fg-muted">
          <span className="font-mono">{tc(total)}</span> in total, {where}
        </p>
      </div>
      <ul className="flex flex-col gap-2 border-y border-line py-3">
        {found.map(({ clip }) => (
          <SelectedClip key={clip.id} clip={clip} />
        ))}
      </ul>
      <SecondaryButton aria-keyshortcuts="Delete Backspace" onClick={deleteSelection}>
        Delete {found.length} clips
        <Kbd>⌫</Kbd>
      </SecondaryButton>
      <p className="text-xs text-fg-subtle">
        Split and trim work on one clip at a time. Deleting leaves gaps; undo brings the clips back.
      </p>
      <PlayheadField />
    </div>
  );
}

function SelectedClip({ clip }: { clip: Clip }) {
  const project = useDocumentStore((state) => state.project);
  const asset = findAsset(project, clip.assetId);
  return (
    <li className="flex items-center gap-2.5">
      {asset && (
        <AssetPreview
          asset={asset}
          sourceFrame={clip.in}
          fps={project.fps}
          className="h-[27px] w-12 flex-none rounded-badge"
        />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{asset?.name ?? clip.id}</span>
      <span className="font-mono text-2xs text-fg-subtle">
        {formatTimecode(clip.start, project.fps)}
      </span>
    </li>
  );
}

/**
 * The playhead's timecode. It follows the playhead until focused; then Enter jumps to what's typed
 * (shorthand like 19:06 works), Esc puts back the playhead's time, and a timecode that doesn't
 * parse says how to write one.
 */
function PlayheadField() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fps = useDocumentStore((state) => state.project.fps);
  const hintId = useId();

  const write = useCallback(
    (frame: Frames) => {
      const input = inputRef.current;
      if (input && document.activeElement !== input) input.value = formatTimecode(frame, fps);
    },
    [fps],
  );
  usePlayheadWriter(write);

  const restore = () => {
    if (inputRef.current) {
      inputRef.current.value = formatTimecode(useUiStore.getState().playhead, fps);
    }
    setError(null);
  };

  return (
    <label className="flex flex-col gap-1.5 text-xs text-fg-subtle">
      Playhead
      <input
        ref={inputRef}
        type="text"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error !== null}
        aria-describedby={editing || error !== null ? hintId : undefined}
        className="h-control rounded-control bg-surface-raised px-2.5 font-mono text-sm text-fg tabular-nums shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
        onFocus={(event) => {
          setEditing(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          setEditing(false);
          restore();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            restore();
          } else if (event.key === "Enter") {
            event.preventDefault();
            const parsed = parseTimecode(event.currentTarget.value, fps);
            if (!parsed.ok) {
              setError(parsed.error.message);
              return;
            }
            movePlayhead(parsed.frames);
            restore();
          }
        }}
        onInput={() => {
          if (error !== null) setError(null);
        }}
      />
      {error !== null ? (
        <span id={hintId} role="alert" className="flex items-start gap-1.5 text-2xs text-fg">
          <span className="mt-px">
            <WarningIcon size={14} stroke="var(--color-danger)" />
          </span>
          {error}
        </span>
      ) : (
        editing && (
          <span id={hintId} className="text-2xs text-fg-subtle">
            Enter jumps there · Esc puts it back
          </span>
        )
      )}
    </label>
  );
}
