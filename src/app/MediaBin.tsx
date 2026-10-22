// The media bin (spec section 3.1, Media bin states board), with two tabs. "My files" lists every
// file imported into this browser, each row in its import's state: waiting, reading, copying,
// ready, or why it can't be opened. Files come from "Add files" or a drop on the bin, which shows
// My files. Enter or a click adds a ready file at the playhead, and it can be dragged onto a track.
// "From the Feed" shows the Feed's clips (src/app/FeedClips.tsx), from a chunk of their own.

import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { showFeed, showFiles, useFeedTab } from "../feed/feed-store.ts";
import { metaLine } from "../media/facts.ts";
import { ACCEPTED_FILES, assetOf, canPlace, type ImportEntry } from "../media/import-state.ts";
import { removeFile, useLibrary } from "../media/library.ts";
import { usePoster } from "../media/media-cache.ts";
import { pressAsset } from "../timeline/gestures.ts";
import { addAtPlayhead, addFiles, removeFromMyFiles } from "./actions.ts";
import { chunk } from "./chunks.ts";
import { chooseFiles, registerFilePicker } from "./file-picker.ts";
import {
  AddIcon,
  CloseIcon,
  DropIcon,
  MusicIcon,
  SpinnerIcon,
  UploadIcon,
  WarningIcon,
} from "./icons.tsx";
import { LazyHost } from "./lazy.tsx";
import { Kbd, SecondaryButton } from "./ui.tsx";

const FORMATS = "MP4, MOV, WebM · MP3, M4A, WAV";

/**
 * The Feed tab's clips are their own chunk, which the first screen doesn't need (docs/PERF.md,
 * M8). It's fetched as soon as the pointer or the keyboard reaches the tab, so it's usually in by
 * the press, and the press asks for the Feed's first page at once either way (`showFeed`).
 */
const feedClipsChunk = chunk(() => import("./FeedClips.tsx"));
const loadFeedClips = () => feedClipsChunk().then((module) => module.FeedClips);
const prefetchFeedClips = () => {
  feedClipsChunk().catch(() => undefined);
};

export function MediaBin() {
  const entries = useLibrary((state) => state.entries);
  const tab = useFeedTab((state) => state.tab);
  const { dragged, dropTarget } = useFileDrop();
  const ids = { files: useId(), feed: useId() };
  useFileDropsElsewhereRefused();
  return (
    <section
      aria-label="Media bin"
      className="relative flex w-bin flex-none flex-col border-r border-line bg-surface"
      {...dropTarget}
    >
      <Tabs tab={tab} ids={ids} />
      <div
        role="tabpanel"
        id={`${ids[tab]}-panel`}
        aria-labelledby={ids[tab]}
        className={`flex min-h-0 flex-1 flex-col ${dragged === null ? "" : "opacity-35"}`}
      >
        {tab === "feed" ? (
          <FeedPanel />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {entries.length === 0 ? <DropZone /> : <Files entries={entries} />}
          </div>
        )}
      </div>
      {dragged !== null && <DropHint count={dragged} />}
      <input
        ref={registerFilePicker}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        hidden
        onChange={(event) => {
          const { files } = event.currentTarget;
          if (files) addFiles(Array.from(files));
          // Picking the same file again must still be a change.
          event.currentTarget.value = "";
        }}
      />
    </section>
  );
}

type Tab = "files" | "feed";

const TABS: readonly { tab: Tab; label: string; show: () => void }[] = [
  { tab: "files", label: "My files", show: showFiles },
  { tab: "feed", label: "From the Feed", show: showFeed },
];

/**
 * "My files" | "From the Feed", as drawn: a tab list, so the arrow keys move between the two and
 * Tab goes on to the panel.
 */
function Tabs({ tab, ids }: { tab: Tab; ids: Record<Tab, string> }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = TABS.find((candidate) => candidate.tab !== tab);
    next?.show();
    if (next) document.getElementById(ids[next.tab])?.focus();
  };
  return (
    <div className="flex-none px-3 pt-3 pb-2.5">
      <div
        role="tablist"
        aria-label="Media"
        className="grid grid-cols-2 gap-0.5 rounded-control bg-bg p-0.5 shadow-[inset_0_0_0_1px_var(--color-line)]"
        onKeyDown={onKeyDown}
      >
        {TABS.map(({ tab: id, label, show }) => {
          const selected = id === tab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={ids[id]}
              aria-selected={selected}
              aria-controls={`${ids[id]}-panel`}
              tabIndex={selected ? 0 : -1}
              className={`h-[30px] rounded-card text-sm transition-colors duration-(--dur-fast) ${selected ? "bg-surface-raised font-semibold text-fg" : "text-fg-muted hover:text-fg"}`}
              onClick={show}
              {...(id === "feed"
                ? { onPointerEnter: prefetchFeedClips, onFocus: prefetchFeedClips }
                : {})}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The Feed's clips, once their chunk is in; if it won't load (offline), why, and Retry. */
function FeedPanel() {
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => {
    setFailed(true);
  }, []);
  if (!failed) return <LazyHost open load={loadFeedClips} failed={fail} />;
  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <p role="alert" className="text-sm text-fg-muted">
        The Feed&rsquo;s clips couldn&rsquo;t load: check your connection.
      </p>
      <SecondaryButton
        className="px-3.5"
        onClick={() => {
          setFailed(false);
        }}
      >
        Retry
      </SecondaryButton>
    </div>
  );
}

/** Whether a drag carries files (and not, say, text from another page). */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

/**
 * Files dragged over the bin: how many (0 when the browser won't say), or null when none are. A
 * drag passes over the bin's children too, each with its own enter and leave, so it counts them.
 */
function useFileDrop() {
  const depth = useRef(0);
  const [dragged, setDragged] = useState<number | null>(null);
  const dropTarget = {
    onDragEnter: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      const items = Array.from(event.dataTransfer.items);
      setDragged(items.filter((item) => item.kind === "file").length);
    },
    onDragOver: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragged(null);
    },
    onDrop: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragged(null);
      addFiles(Array.from(event.dataTransfer.files));
    },
  };
  return { dragged, dropTarget };
}

/**
 * Files dropped anywhere but the bin would make the browser open them in place of the editor,
 * losing the cut: such drops are refused (the bin's own handlers come first).
 */
function useFileDropsElsewhereRefused(): void {
  useEffect(() => {
    const refuse = (event: globalThis.DragEvent) => {
      if (event.defaultPrevented || !event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      if (event.type === "dragover") event.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", refuse);
    window.addEventListener("drop", refuse);
    return () => {
      window.removeEventListener("dragover", refuse);
      window.removeEventListener("drop", refuse);
    };
  }, []);
}

/** Files dragged over the bin: where they'll land, and what it takes. */
function DropHint({ count }: { count: number }) {
  const what = count === 0 ? "files" : count === 1 ? "1 file" : `${count} files`;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-14 bottom-3 flex flex-col items-center justify-center gap-2.5 rounded-panel border-[1.5px] border-dashed border-accent bg-accent/8 text-center">
      <span className="text-accent">
        <DropIcon size={28} />
      </span>
      <p className="text-sm font-semibold">Drop to add {what}</p>
      <p className="text-xs text-fg-muted">
        {FORMATS}
        <br />
        They stay on this device.
      </p>
    </div>
  );
}

/** No files yet: a place to drop them, and the file picker. */
function DropZone() {
  return (
    <div className="flex flex-1 px-3 pb-3">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-panel border border-dashed border-line-strong p-6 text-center">
        <span className="text-fg-muted">
          <UploadIcon size={28} />
        </span>
        <div>
          <p className="text-sm font-semibold">Drop video or audio files here</p>
          <p className="mt-1 text-xs text-fg-subtle">{FORMATS}</p>
        </div>
        <SecondaryButton className="px-3.5" onClick={chooseFiles}>
          Choose files
        </SecondaryButton>
        <p className="text-2xs text-fg-subtle">Files stay on this device.</p>
      </div>
    </div>
  );
}

function Files({ entries }: { entries: readonly ImportEntry[] }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-control bg-surface-raised px-3 text-sm text-fg shadow-[inset_0_0_0_1px_var(--color-line)] transition-shadow duration-(--dur-fast) hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
          onClick={chooseFiles}
        >
          <AddIcon />
          Add files
        </button>
        <span className="text-xs text-fg-subtle">
          {entries.length === 1 ? "1 file" : `${entries.length} files`}
        </span>
      </div>
      <ul className="flex flex-col px-1.5 pb-3">
        {entries.map((entry) => (
          <li key={entry.id}>
            <FileRow entry={entry} />
          </li>
        ))}
      </ul>
    </>
  );
}

function FileRow({ entry }: { entry: ImportEntry }) {
  const { status, name } = entry;
  if (canPlace(entry)) return <PlaceableFile entry={entry} />;
  switch (status.step) {
    case "queued":
    case "analyzing":
      return (
        <div className="flex items-center gap-2.5 p-1.5">
          <span className="flex h-9 w-16 flex-none items-center justify-center rounded-badge bg-skeleton text-fg-subtle">
            <SpinnerIcon spinning={status.step === "analyzing"} />
          </span>
          <RowText name={name} muted>
            {status.step === "queued"
              ? "Waiting to be read… can't be placed yet"
              : "Reading its length… can't be placed yet"}
          </RowText>
        </div>
      );
    case "copying": {
      const percent = Math.round(status.progress * 100);
      return (
        <div className="flex items-center gap-2.5 p-1.5">
          <Poster entry={entry} dimmed />
          <span className="block min-w-0 flex-1">
            <span className="block truncate text-sm text-fg-muted">{name}</span>
            <span className="mt-1 flex items-center gap-2">
              <span
                role="progressbar"
                aria-label={`Copying ${name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-1 flex-1 overflow-hidden rounded-pill bg-line"
              >
                <span className="block h-1 bg-accent" style={{ width: `${percent}%` }} />
              </span>
              <span className="text-2xs whitespace-nowrap text-fg-subtle">Copying {percent}%</span>
            </span>
          </span>
        </div>
      );
    }
    case "unsupported":
    case "failed":
      return (
        <div className="flex items-start gap-2.5 p-1.5">
          <span className="flex h-9 w-16 flex-none items-center justify-center rounded-badge bg-skeleton">
            <WarningIcon stroke="var(--color-danger)" />
          </span>
          <span className="block min-w-0 flex-1">
            <span className="block truncate text-sm">{name}</span>
            <span className="block text-2xs text-fg">{status.message}</span>
          </span>
          <button
            type="button"
            aria-label={`Remove ${name}`}
            className="inline-flex size-7 flex-none items-center justify-center rounded-card text-fg-subtle transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-fg"
            onClick={() => {
              removeFile(entry.id);
            }}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      );
    default:
      return null;
  }
}

/** A row's name and its second line. The space between them keeps them apart in its name. */
function RowText({ name, muted, children }: { name: string; muted: boolean; children: string }) {
  return (
    <span className="block min-w-0 flex-1">
      <span className={`block truncate text-sm ${muted ? "text-fg-muted" : ""}`}>{name}</span>{" "}
      <span className="block text-2xs text-fg-subtle">{children}</span>
    </span>
  );
}

/**
 * A file that can go on the timeline: Enter or a click adds it at the playhead, and it can be
 * dragged onto a track. Named by its visible text, as axe asks; what Enter does is its description.
 * Once it's ready, Remove (on hover or focus) takes it out of this browser, unless a clip uses it.
 */
function PlaceableFile({ entry }: { entry: ImportEntry }) {
  // A drag onto the tracks ends with a click on the row, which mustn't add the file again.
  const dragged = useRef(false);
  const detailsId = useId();
  const { facts } = entry;
  if (!facts) return null;
  const asset = () => assetOf({ ...entry, facts });
  const removable = entry.status.step === "ready";
  return (
    <div className="group/file relative">
      <button
        type="button"
        aria-describedby={detailsId}
        className={`group flex w-full min-w-0 cursor-grab items-center gap-2.5 rounded-control p-1.5 text-left transition-colors duration-(--dur-fast) hover:bg-surface-raised focus-visible:bg-surface-raised ${removable ? "pr-9" : ""}`}
        onPointerDown={(event) => {
          dragged.current = false;
          pressAsset(event, asset(), () => {
            dragged.current = true;
          });
        }}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          addAtPlayhead(asset());
        }}
      >
        <Poster entry={entry} />
        <RowText name={entry.name} muted={false}>
          {metaLine(facts)}
        </RowText>
        <span aria-hidden="true" className="hidden group-hover:flex group-focus-visible:flex">
          <Kbd>↵</Kbd>
        </span>
        <span id={detailsId} hidden>
          Enter adds it at the playhead.
        </span>
      </button>
      {removable && (
        <button
          type="button"
          aria-label={`Remove ${entry.name}`}
          className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-card text-fg-subtle opacity-0 transition-colors duration-(--dur-fast) group-hover/file:opacity-100 hover:bg-surface hover:text-fg focus-visible:opacity-100"
          onClick={() => {
            removeFromMyFiles(entry.id, entry.name);
          }}
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}

/** A file's first frame, or a note for music; dimmed while the file is still being copied. */
function Poster({ entry, dimmed = false }: { entry: ImportEntry; dimmed?: boolean }) {
  const poster = usePoster(entry.id);
  if (entry.facts?.kind === "audio") {
    return (
      <span className="flex h-9 w-16 flex-none items-center justify-center rounded-badge bg-skeleton text-fg-muted">
        <MusicIcon />
      </span>
    );
  }
  return (
    <span className="h-9 w-16 flex-none overflow-hidden rounded-badge bg-skeleton">
      {poster !== undefined && (
        // Not draggable itself: a press on it starts the row's own drag onto the tracks.
        <img
          src={poster}
          alt=""
          draggable={false}
          className={`block size-full object-cover ${dimmed ? "opacity-40" : ""}`}
        />
      )}
    </span>
  );
}
