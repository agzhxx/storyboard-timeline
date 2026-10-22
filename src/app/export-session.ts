// The export dialog's steps (Export boards) and what moves it between them: settings, then
// exporting, then done or failed. A canceled export closes the dialog with a toast, and so does
// one stopped by media that didn't load, with Retry. Export takes a snapshot of the document when
// it's pressed: the modal dialog keeps the person from editing, and the export never reads the
// document again, so the project is never changed by an export. The finished file lives in memory
// until the dialog closes; a failed or canceled export keeps nothing.

import { create } from "zustand";
import { findAsset, projectDuration } from "../engine/project.ts";
import { useDocumentStore } from "../engine/store.ts";
import type { Frames, Project } from "../engine/types.ts";
import { compareOutput, type OutputCheck } from "../media/export-check.ts";
import { discard, type ExportEvent, exportWorker } from "../media/export-client.ts";
import {
  chooseFormat,
  type Encoders,
  type ExportFormat,
  type ExportSize,
  FORMATS,
} from "../media/export-format.ts";
import { mixForExport, mixPlan, MusicError } from "../media/export-mix.ts";
import { TimeLeft } from "../media/export-progress.ts";
import type { ExportFailure } from "../media/export-protocol.ts";
import { counters } from "../perf/counters.ts";
import { closeExportDialog, openExport } from "./export-open.ts";
import { checkLine, fileName, stoppedText } from "./export-text.ts";
import { showProblem, showToast } from "./toast-store.ts";

/** The dialog's pictures: its 520 px less 24 px of padding on each side, at 16:9. */
export const PICTURE_WIDTH = 472;

/** What an export makes, from the snapshot taken when Export was pressed. */
export interface Making {
  project: Project;
  size: ExportSize;
  format: ExportFormat;
  frames: Frames;
}

export interface Picture {
  frame: Frames;
  bitmap: ImageBitmap;
}

export interface Finished {
  url: string;
  name: string;
  bytes: number;
  elapsedMs: number;
  check: OutputCheck;
  firstFrame: ImageBitmap | null;
}

export type Step =
  | { kind: "settings" }
  | {
      kind: "exporting";
      making: Making;
      /** How many frames are in the encoder. */
      encoded: Frames;
      picture: Picture | null;
      secondsLeft: number | null;
    }
  | { kind: "done"; making: Making; finished: Finished }
  | { kind: "failed"; making: Making; failure: Exclude<ExportFailure, { kind: "unreachable" }> };

interface Session {
  size: ExportSize;
  /** What encodes at each size and frame rate ("1080p 24"), as the browser answered. */
  encoders: Partial<Record<string, Encoders>>;
  step: Step;
}

export const useExportSession = create<Session>(() => ({
  size: "1080p",
  encoders: {},
  step: { kind: "settings" },
}));

const session = () => useExportSession.getState();

function encodersKey(size: ExportSize, fps: number): string {
  return `${size} ${fps}`;
}

/** What encodes at a size and rate; undefined until the browser answers. */
export function encodersFor(size: ExportSize, fps: number): Encoders | undefined {
  return session().encoders[encodersKey(size, fps)];
}

const asking = new Set<string>();
/** Answers from a worker that broke before it answered: nothing encodes, until the dialog closes. */
const broken = new Set<string>();

const NONE: Encoders = { avc: false, aac: false, vp9: false, opus: false };

/** Asks the browser what encodes at a size and rate, once a session. */
export function askEncoders(size: ExportSize, fps: Project["fps"]): void {
  const key = encodersKey(size, fps);
  if (asking.has(key) || session().encoders[key]) return;
  asking.add(key);
  const store = (encoders: Encoders) => {
    asking.delete(key);
    useExportSession.setState((state) => ({ encoders: { ...state.encoders, [key]: encoders } }));
  };
  exportWorker.encoders(size, fps).then(store, () => {
    broken.add(key);
    store(NONE);
  });
}

export function chooseSize(size: ExportSize): void {
  useExportSession.setState({ size });
}

/** Whether a project's cut has music, so its file gets an audio track. */
export function hasMusic(project: Project): boolean {
  return mixPlan(project) !== null;
}

/** The format an export of the project would have at a size, once the browser has answered. */
export function formatFor(project: Project, size: ExportSize): ExportFormat | null | undefined {
  const encoders = encodersFor(size, project.fps);
  return encoders && chooseFormat(encoders, hasMusic(project));
}

/** The export under way: its news is dropped once it's no longer this. */
interface Attempt {
  run: number | null;
  startedAt: number;
  mixMs: number;
  timeLeft: TimeLeft;
}

let attempt: Attempt | null = null;

/** Export: a snapshot of the document, exported at the chosen size in the format it allows. */
export function startExport(): void {
  const project = useDocumentStore.getState().project;
  const { size } = session();
  const format = formatFor(project, size);
  const frames = projectDuration(project);
  if (!format || frames === 0) return;
  void begin({ project, size, format, frames });
}

async function begin(making: Making): Promise<void> {
  const started: Attempt = {
    run: null,
    startedAt: performance.now(),
    mixMs: 0,
    timeLeft: new TimeLeft(),
  };
  attempt = started;
  setStep({ kind: "exporting", making, encoded: 0, picture: null, secondsLeft: null });
  const mixed = await mixForExport(making.project).then(
    (audio) => ({ audio }),
    (error: unknown) => ({ error }),
  );
  // Canceled while the music mixed.
  if (attempt !== started) return;
  if ("error" in mixed) {
    const { error } = mixed;
    attempt = null;
    if (!(error instanceof MusicError)) {
      failed(making, {
        kind: "output",
        message: error instanceof Error ? error.message : String(error),
      });
    } else if (error.reason === "unreadable" && error.asset.source.type !== "file") {
      // Music at an address that didn't come: the network's, as for a Feed clip.
      stopped(making, error.asset.id);
    } else {
      failed(making, { kind: "music", assetId: error.asset.id, reason: error.reason });
    }
    return;
  }
  const { audio } = mixed;
  started.mixMs = performance.now() - started.startedAt;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(PICTURE_WIDTH * scale);
  started.run = exportWorker.start(
    {
      project: making.project,
      size: making.size,
      format: making.format,
      audio,
      preview: { width, height: Math.round((width * 9) / 16) },
    },
    (event) => {
      if (attempt === started) receive(started, making, event);
      else discard(event);
    },
  );
}

function receive(started: Attempt, making: Making, event: ExportEvent): void {
  switch (event.type) {
    case "progress": {
      const encoded = event.frame + 1;
      started.timeLeft.update(encoded, performance.now());
      updateExporting((step) => ({
        ...step,
        encoded,
        secondsLeft: started.timeLeft.seconds(making.frames),
      }));
      return;
    }
    case "preview":
      updateExporting((step) => {
        step.picture?.bitmap.close();
        return { ...step, picture: { frame: event.frame, bitmap: event.bitmap } };
      });
      return;
    case "done": {
      attempt = null;
      const elapsedMs = performance.now() - started.startedAt;
      const { fps } = making.project;
      const check = compareOutput(event.measured, making.frames, fps);
      counters.exportCheck = checkLine(check, making.frames, fps);
      performance.measure("export", {
        start: started.startedAt,
        detail: {
          size: making.size,
          format: making.format,
          frames: making.frames,
          bytes: event.file.size,
          mixMs: started.mixMs,
          ...event.timings,
          check,
        },
      });
      setStep({
        kind: "done",
        making,
        finished: {
          url: URL.createObjectURL(event.file),
          name: fileName(making.project.name, FORMATS[making.format].extension),
          bytes: event.file.size,
          elapsedMs,
          check,
          firstFrame: event.firstFrame,
        },
      });
      return;
    }
    case "failed":
      attempt = null;
      if (event.failure.kind === "unreachable") stopped(making, event.failure.assetId);
      else failed(making, event.failure);
      return;
    case "crashed":
      attempt = null;
      failed(making, { kind: "output", message: "The export worker stopped." });
      return;
    case "canceled":
      return;
  }
}

/** The export failed: the dialog says why, with Try again. */
function failed(making: Making, failure: Exclude<ExportFailure, { kind: "unreachable" }>): void {
  setStep({ kind: "failed", making, failure });
}

/** Media at an address didn't load: the dialog closes, and a toast says which, with Retry. */
function stopped(making: Making, assetId: string): void {
  closeExport();
  const asset = findAsset(making.project, assetId) ?? null;
  showProblem(stoppedText(asset), null, () => {
    chooseSize(making.size);
    openExport();
    startExport();
  });
}

/** Cancel, while exporting: the export stops and keeps nothing; the dialog closes. */
export function cancelExport(): void {
  const canceled = attempt;
  attempt = null;
  if (canceled?.run != null) exportWorker.cancel(canceled.run);
  closeExport();
  showToast("Export canceled. Nothing was saved, and your project is unchanged.", null, {
    label: "Export again",
    run: openExport,
  });
}

/**
 * Closes the dialog: the finished file and the pictures are let go of, and an answer from a broken
 * worker is forgotten, so the next opening asks again.
 */
export function closeExport(): void {
  setStep({ kind: "settings" });
  if (broken.size > 0) {
    const { encoders } = session();
    useExportSession.setState({
      encoders: Object.fromEntries(Object.entries(encoders).filter(([key]) => !broken.has(key))),
    });
    broken.clear();
  }
  closeExportDialog();
}

function setStep(step: Step): void {
  release(session().step, step);
  useExportSession.setState({ step });
}

function updateExporting(
  update: (step: Extract<Step, { kind: "exporting" }>) => Extract<Step, { kind: "exporting" }>,
): void {
  const { step } = session();
  if (step.kind === "exporting") useExportSession.setState({ step: update(step) });
}

/** Lets go of what a step held that the next one doesn't. */
function release(step: Step, next: Step): void {
  if (step.kind === "exporting" && step.picture) step.picture.bitmap.close();
  if (step.kind === "done" && step !== next) {
    URL.revokeObjectURL(step.finished.url);
    step.finished.firstFrame?.close();
  }
}
