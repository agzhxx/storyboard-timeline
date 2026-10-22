// One file's import, step by step (spec section 4.5), with what it needs passed in so the tests
// can run it with a fake worker:
//
// 1. analyzing: the worker reads the file's media and asks the browser whether it decodes it: a
//    video's codec, then its first frame, which becomes the poster. Music is decoded here with
//    decodeAudioData, which playback then plays, and the worker boils it down to peaks.
// 2. copying: the worker copies the file into OPFS, a chunk at a time, reporting progress, then
//    its meta.json. The file can be placed from here on, so nothing after this undoes the copy.
// 3. thumbnails: the worker makes a video's thumbnails, one per second, from the copy. Each goes
//    to the filmstrips as it's made.
//
// The steps are performance marks too ("import:analyzed" and so on, with the file's name), which
// the import bench reads (bench/import.ts).

import type { DecodedAudio } from "./audio.ts";
import { cantOpenMessage } from "./codecs.ts";
import { ImportFailure, type ImportWorker } from "./import-client.ts";
import {
  FAILURE_MESSAGES,
  type FailureKind,
  type ImportEntry,
  type ImportEvent,
  storedMedia,
} from "./import-state.ts";
import type { Peaks } from "./peaks.ts";

export interface ImportDeps {
  worker: ImportWorker;
  decodeAudio: (file: File) => Promise<DecodedAudio | null>;
  dispatch: (event: ImportEvent) => void;
  /** Keeps a thumbnail (the first is the poster) for drawing. */
  keepThumbnail: (assetId: string, index: number, blob: Blob) => void;
  keepPeaks: (assetId: string, peaks: Peaks) => void;
  /** Keeps decoded music for playback, once its file is stored. */
  keepAudio: (assetId: string, buffer: AudioBuffer) => void;
  /** Deletes what storage holds for an asset, if anything. */
  discard: (assetId: string) => Promise<void>;
}

/** Imports one queued file, until it's ready or it's clear why it can't be. Never throws. */
export async function runImport(entry: ImportEntry, file: File, deps: ImportDeps): Promise<void> {
  const { id } = entry;
  const { worker, dispatch } = deps;
  const mark = (step: string) => performance.mark(`import:${step}`, { detail: entry.name });
  dispatch({ type: "started", id });
  mark("started");
  try {
    const analysis = await worker.analyze(file);
    if (!analysis.ok) {
      dispatch({ type: "unsupported", id, message: cantOpenMessage(analysis.problem) });
      return;
    }
    const { facts, poster } = analysis;
    let peaks: Peaks | null = null;
    let music: AudioBuffer | null = null;
    if (facts.kind === "audio") {
      const decoded = await deps.decodeAudio(file);
      if (!decoded) {
        const message = cantOpenMessage({ kind: "audio", codec: facts.codec });
        dispatch({ type: "unsupported", id, message });
        return;
      }
      music = decoded.buffer;
      peaks = await worker.peaks(decoded.channels, decoded.sampleRate);
      deps.keepPeaks(id, peaks);
    }
    if (poster) deps.keepThumbnail(id, 0, poster.blob);
    dispatch({ type: "analyzed", id, facts });
    mark("analyzed");

    const meta = storedMedia(entry, facts);
    await worker.store({ assetId: id, file, source: meta.source, peaks, meta }, (progress) => {
      dispatch({ type: "copy-progress", id, progress });
    });
    dispatch({ type: "copied", id });
    mark("copied");
    // Playback plays the music decoded here, without decoding it again.
    if (music) deps.keepAudio(id, music);

    if (facts.kind === "video") {
      // The file may be on the timeline already: thumbnails that stop early (storage running
      // out, the worker stopping) end the import without undoing it. The filmstrip leaves the
      // rest empty, and the next start makes them again.
      await worker
        .thumbnails(meta, (index, thumbnail) => {
          deps.keepThumbnail(id, index, thumbnail.blob);
          dispatch({ type: "thumbnail-made", id, imageType: thumbnail.type });
        })
        .catch(() => undefined);
      dispatch({ type: "finished", id });
    }
    mark("ready");
  } catch (error) {
    dispatch({ type: "failed", id, message: FAILURE_MESSAGES[failureKindOf(error)] });
    // Whatever was stored won't be used: a copy whose meta.json couldn't be written, or the half
    // copy of a worker that stopped mid-way.
    await deps.discard(id);
  }
}

function failureKindOf(error: unknown): FailureKind {
  if (error instanceof ImportFailure) return error.kind;
  // Reading the file on this thread (music, for decoding) failed: it moved or went away.
  if (error instanceof DOMException && ["NotReadableError", "NotFoundError"].includes(error.name)) {
    return "unreadable";
  }
  return "other";
}
