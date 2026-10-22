// The export dialog (Export boards: "settings, progress, done" and "fallback, failed, canceled"): a
// modal at 520 px over the editor, its backdrop at 94 %. Settings: the size, the project's frame
// rate, the format this browser can encode (MP4, else WebM with the reason, else none) and the
// file's estimated size. Exporting: the frame being encoded, the progress and the time left, and
// Cancel. Done: the file's first frame, its name, size and length, the output check, and Download.
// Failed: what stopped where, details for a bug report, and Try again. Esc does what the step's
// Cancel or Close does. Its own chunk, loaded the first time Export opens (src/app/App.tsx).

import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { findAsset, projectDuration } from "../engine/project.ts";
import { useDocumentStore } from "../engine/store.ts";
import { formatTimecode } from "../engine/time.ts";
import { estimateBytes, type ExportSize, SIZES } from "../media/export-format.ts";
import { describeContents } from "./describe.ts";
import {
  askEncoders,
  cancelExport,
  chooseSize,
  closeExport,
  encodersFor,
  formatFor,
  hasMusic,
  type Making,
  type Step,
  startExport,
  useExportSession,
} from "./export-session.ts";
import {
  aboutSize,
  checkText,
  containerName,
  dimensions,
  failureParts,
  fileSize,
  formatLabel,
  frameOf,
  noFormatNote,
  speedText,
  timeLeftText,
  webmNote,
} from "./export-text.ts";
import { CheckIcon, CloseIcon, DownloadIcon, InfoIcon, WarningIcon } from "./icons.tsx";
import { PrimaryButton, SecondaryButton } from "./ui.tsx";

export default function ExportDialog() {
  const step = useExportSession((state) => state.step);
  const dialog = useRef<HTMLDialogElement>(null);

  // Opened before the step's focus moves into it, and closed while it's still in the page, so the
  // browser gives focus back to what had it (the toolbar's Export).
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => {
      element.close();
    };
  }, []);

  // Each step puts the keyboard on its main control: the chosen size, Cancel, Download, Try again.
  useLayoutEffect(() => {
    dialog.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [step.kind]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="export-title"
      className="m-auto flex w-[520px] flex-col gap-5 rounded-panel border-0 bg-surface p-6 text-fg shadow-popover backdrop:bg-backdrop"
      onCancel={(event) => {
        // Esc: the step's Cancel or Close, which closes the dialog through the store.
        event.preventDefault();
        if (step.kind === "exporting") cancelExport();
        else closeExport();
      }}
    >
      <StepView step={step} />
    </dialog>
  );
}

function StepView({ step }: { step: Step }) {
  switch (step.kind) {
    case "settings":
      return <Settings />;
    case "exporting":
      return <Exporting step={step} />;
    case "done":
      return <Done step={step} />;
    case "failed":
      return <Failed step={step} />;
  }
}

function Header({
  title,
  subtitle,
  close,
}: {
  title: string;
  subtitle: ReactNode;
  close: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 id="export-title" className="text-md font-semibold">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
      </div>
      {close && (
        <button
          type="button"
          aria-label="Close"
          className="inline-flex size-8 flex-none items-center justify-center rounded-control text-fg-muted transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-fg"
          onClick={closeExport}
        >
          <CloseIcon strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

function Timecode({ frames, fps }: { frames: number; fps: Making["project"]["fps"] }) {
  return <span className="font-mono">{formatTimecode(frames, fps)}</span>;
}

/** Cancel and Close as text, beside the accent button. */
function QuietButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex h-control items-center rounded-control px-3.5 text-sm text-fg-muted transition-colors duration-(--dur-fast) hover:text-fg"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Settings -------------------------------------------------------------------------------------

function Settings() {
  const project = useDocumentStore((state) => state.project);
  const size = useExportSession((state) => state.size);
  const encoders = useExportSession(() => encodersFor(size, project.fps));
  const format = useExportSession(() => formatFor(project, size));
  const frames = projectDuration(project);
  const music = hasMusic(project);

  // Asked when the dialog opens and when the size changes.
  useEffect(() => {
    askEncoders(size, project.fps);
  }, [size, project.fps]);

  const exportable = format !== undefined && format !== null && frames > 0;
  return (
    <>
      <Header
        title="Export"
        close
        subtitle={
          <>
            {project.name} · <Timecode frames={frames} fps={project.fps} /> ·{" "}
            {describeContents(project)}
          </>
        }
      />
      <div className="flex flex-col gap-2">
        <span id="export-size" className="text-xs text-fg-subtle">
          Size
        </span>
        <div role="group" aria-labelledby="export-size" className="grid grid-cols-2 gap-2">
          {(["1080p", "720p"] as const).map((choice) => (
            <SizeButton key={choice} size={choice} pressed={choice === size} />
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-y border-line py-3.5 text-sm">
        <dt className="text-fg-subtle">Frame rate</dt>
        <dd>{project.fps} fps, the project's</dd>
        <dt className="text-fg-subtle">Format</dt>
        <dd>
          {format === undefined
            ? "Checking what this browser can encode…"
            : format === null
              ? "None at this size"
              : formatLabel(format, music)}
          {format === "mp4" && (
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-subtle">
              <CheckIcon size={14} />
              This browser can encode it
            </span>
          )}
        </dd>
        <dt className="text-fg-subtle">Estimated size</dt>
        <dd>{aboutSize(estimateBytes(format ?? "mp4", size, frames / project.fps, music))}</dd>
      </dl>
      {encoders && format === "webm" && <Note>{webmNote(encoders)}</Note>}
      {format === null && <Note>{noFormatNote(size)}</Note>}
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-fg-subtle">Made on this device. Nothing is uploaded.</p>
        <div className="flex flex-none gap-2">
          <QuietButton onClick={closeExport}>Cancel</QuietButton>
          <PrimaryButton
            disabled={!exportable}
            className="px-4 disabled:pointer-events-none disabled:opacity-40"
            onClick={startExport}
          >
            {format === "webm" ? "Export WebM" : "Export"}
          </PrimaryButton>
        </div>
      </div>
    </>
  );
}

function SizeButton({ size, pressed }: { size: ExportSize; pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-autofocus={pressed ? true : undefined}
      className={`flex flex-col items-start gap-0.5 rounded-control bg-surface-raised px-3 py-2.5 text-left ${pressed ? "shadow-[inset_0_0_0_2px_var(--color-accent)]" : "shadow-[inset_0_0_0_1px_var(--color-line)] hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"}`}
      onClick={() => {
        chooseSize(size);
      }}
    >
      <span className="text-sm font-semibold">{size}</span>
      <span className="font-mono text-2xs text-fg-muted">{dimensions(size)}</span>
    </button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-control bg-surface-raised p-3">
      <span className="mt-px text-fg-muted">
        <InfoIcon />
      </span>
      <p className="text-xs">{children}</p>
    </div>
  );
}

// Exporting ------------------------------------------------------------------------------------

function Exporting({ step }: { step: Extract<Step, { kind: "exporting" }> }) {
  const { making, encoded, picture, secondsLeft } = step;
  const { fps } = making.project;
  // Whole percent, rounded down (29 of 100 is 29 %): 100 % only once every frame is in.
  const percent = Math.floor((encoded * 100) / making.frames);
  const finishing = encoded >= making.frames;
  return (
    <>
      <Header
        title="Exporting…"
        close={false}
        subtitle={`${containerName(making.format)} · ${dimensions(making.size)} · ${fps} fps`}
      />
      <Picture bitmap={picture?.bitmap ?? null} label="The frame being encoded">
        {picture && (
          <span className="absolute bottom-2 left-2 rounded-badge bg-scrim px-1.5 font-mono text-2xs">
            {frameOf(picture.frame, making.frames)}
          </span>
        )}
      </Picture>
      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label="Export progress"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 overflow-hidden rounded-pill bg-line"
        >
          <div className="h-1.5 bg-accent" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex justify-between text-xs">
          <span className="tabular-nums">{percent}%</span>
          <span className="text-fg-muted">
            {finishing ? "Finishing the file…" : timeLeftText(secondsLeft)}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-fg-subtle">Keep this tab open. Your project doesn't change.</p>
        <SecondaryButton data-autofocus className="flex-none px-3.5" onClick={cancelExport}>
          Cancel
        </SecondaryButton>
      </div>
    </>
  );
}

/** A 16:9 picture from the worker: the frame being encoded, or the film's first frame. */
function Picture({
  bitmap,
  label,
  children,
}: {
  bitmap: ImageBitmap | null;
  label: string;
  children?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    if (!bitmap) {
      context.clearRect(0, 0, element.width, element.height);
      return;
    }
    element.width = bitmap.width;
    element.height = bitmap.height;
    context.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-card bg-monitor">
      <canvas ref={canvas} role="img" aria-label={label} className="block size-full" />
      {children}
    </div>
  );
}

// Done -----------------------------------------------------------------------------------------

function Done({ step }: { step: Extract<Step, { kind: "done" }> }) {
  const { making, finished } = step;
  const { fps } = making.project;
  const { width, height } = SIZES[making.size];
  const { check } = finished;
  return (
    <>
      <Header
        title="Your film is ready"
        close
        subtitle={speedText(finished.elapsedMs, making.frames / fps)}
      />
      <Picture bitmap={finished.firstFrame} label="The film's first frame" />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{finished.name}</span>
        <span className="text-xs text-fg-muted">
          {fileSize(finished.bytes)} · {width} × {height} · {fps} fps ·{" "}
          <Timecode frames={making.frames} fps={fps} />
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-xs text-fg-subtle">
          {check.ok ? (
            <CheckIcon size={14} />
          ) : (
            <WarningIcon size={14} stroke="var(--color-danger)" />
          )}
          {checkText(check, making.frames, fps)}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <QuietButton onClick={closeExport}>Close</QuietButton>
        <a
          data-autofocus
          href={finished.url}
          download={finished.name}
          className="inline-flex h-control items-center gap-2 rounded-control bg-accent px-4 text-sm font-semibold text-on-accent transition-colors duration-(--dur-fast) hover:bg-accent-hover"
        >
          <DownloadIcon />
          Download
        </a>
      </div>
    </>
  );
}

// Failed ---------------------------------------------------------------------------------------

function Failed({ step }: { step: Extract<Step, { kind: "failed" }> }) {
  const { making, failure } = step;
  const asset = "assetId" in failure ? (findAsset(making.project, failure.assetId) ?? null) : null;
  const { lead, timecode, details } = failureParts(failure, {
    size: making.size,
    fps: making.project.fps,
    frames: making.frames,
    asset,
  });
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-pill bg-surface-raised">
          <WarningIcon size={18} stroke="var(--color-danger)" />
        </span>
        <div>
          <h2 id="export-title" className="text-md font-semibold">
            Export failed
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            {lead}
            {timecode !== null && (
              <>
                {" ("}
                <span className="font-mono">{timecode}</span>)
              </>
            )}
            . Nothing was saved, and your project is unchanged.
          </p>
        </div>
      </div>
      <details className="rounded-control bg-bg shadow-[inset_0_0_0_1px_var(--color-line)]">
        <summary className="cursor-pointer px-3 py-2.5 text-xs text-fg-muted">
          Details for a bug report
        </summary>
        <pre className="px-3 pb-3 font-mono text-2xs whitespace-pre-wrap text-fg-subtle">
          {details}
        </pre>
      </details>
      <div className="flex justify-end gap-2">
        <QuietButton onClick={closeExport}>Close</QuietButton>
        <PrimaryButton data-autofocus className="px-4" onClick={startExport}>
          Try again
        </PrimaryButton>
      </div>
    </>
  );
}
