// The import worker (spec section 4.5): everything that touches a file's bytes happens here, off
// the main thread, which never loads Mediabunny or decodes video. It reads a file's media and asks
// this browser whether it decodes it, boils decoded audio down to peaks, copies the file into OPFS
// with a sync access handle, and makes a video's thumbnails. The Feed's clips are read where they
// are, with range requests (src/media/remote.ts): their facts, and thumbnails from the Feed's
// lighter 720p file, kept in OPFS so they come back after a reload. The main thread starts it on
// the first import or Feed clip (src/media/import-client.ts; requests in src/media/protocol.ts).

import {
  BlobSource,
  CanvasSink,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  MP3,
  MP4,
  QTFF,
  WAVE,
  WEBM,
} from "mediabunny";
import type { CantOpen } from "./codecs.ts";
import { isHighBitDepth } from "./codecs.ts";
import type { VideoFacts } from "./facts.ts";
import type { FailureKind } from "./import-state.ts";
import {
  ASSETS_FOLDER,
  copyInChunks,
  isQuotaError,
  META_FILE,
  PEAKS_FILE,
  REMOTE_FOLDER,
  type RemoteMeta,
  type StoredMedia,
  type StoredThumbnails,
  type SyncWriter,
  THUMBNAILS_FILE,
  THUMBNAILS_FOLDER,
  thumbnailFileName,
  writeAll,
} from "./opfs.ts";
import { computePeaks, encodePeaks } from "./peaks.ts";
import type {
  Analysis,
  RemoteThumbnails,
  Thumbnail,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.ts";
import { remoteSource } from "./remote.ts";
import {
  previewTimestamps,
  THUMBNAIL_WIDTH,
  thumbnailTimestamps,
  thumbnailTypeOf,
  type ThumbnailType,
} from "./thumbnails.ts";

/** The containers the bin takes: MP4 and M4A, MOV, WebM, MP3 and WAV. Parsers for others stay out. */
const FORMATS = [MP4, QTFF, WEBM, MP3, WAVE];

/**
 * How long a frame may take to decode. A first frame that takes longer makes the file one that
 * doesn't decode; a later one ends the thumbnails.
 */
const FRAME_MS = 15_000;

/**
 * A promise's value, or null if it takes longer than `ms`. A promise left behind can still fail
 * later (when the input is disposed): that failure is expected, and dropped.
 */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  promise.catch(() => undefined);
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(resolve, ms, null))]);
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
});

function post(response: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer });
}

async function handle(request: WorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case "analyze":
        post({ type: "analyzed", id: request.id, analysis: await analyze(request.file) });
        return;
      case "peaks": {
        const peaks = computePeaks(request.channels, request.sampleRate);
        post({ type: "peaks", id: request.id, peaks }, [peaks.data.buffer]);
        return;
      }
      case "store":
        await store(request);
        post({ type: "done", id: request.id });
        return;
      case "thumbnails":
        await makeThumbnails(request.id, request.meta);
        post({ type: "done", id: request.id });
        return;
      case "probe":
        post({ type: "analyzed", id: request.id, analysis: await probe(request.url) });
        return;
      case "remote-thumbnails":
        await makeRemoteThumbnails(request.id, request);
        post({ type: "done", id: request.id });
        return;
    }
  } catch (error) {
    post({ type: "error", id: request.id, kind: failureKind(error), detail: String(error) });
  }
}

/** Storage this browser won't give the worker: no OPFS, or no sync access handles. */
class NoStorage extends Error {}

function failureKind(error: unknown): FailureKind {
  if (isQuotaError(error)) return "quota";
  if (error instanceof NoStorage) return "storage";
  if (error instanceof DOMException) {
    if (error.name === "NotReadableError" || error.name === "NotFoundError") return "unreadable";
    if (error.name === "SecurityError" || error.name === "NoModificationAllowedError") {
      return "storage";
    }
  }
  return "other";
}

// Reading ------------------------------------------------------------------------------------

async function analyze(file: File): Promise<Analysis> {
  const input = new Input({ formats: FORMATS, source: new BlobSource(file) });
  try {
    if (!(await input.canRead())) return cantOpen({ kind: "not-media" });
    const container = (await input.getFormat()).name;
    // A video's own sound is left out (a spec non-goal): its picture decides.
    const video = await input.getPrimaryVideoTrack();
    if (video) return await analyzeVideo(video, container);
    const audio = await input.getPrimaryAudioTrack();
    if (audio) return await analyzeAudio(audio, container);
    return cantOpen({ kind: "not-media" });
  } catch (error) {
    // The file went away, or holds something Mediabunny can't make sense of.
    if (failureKind(error) === "unreadable") throw error;
    return cantOpen({ kind: "damaged" });
  } finally {
    input.dispose();
  }
}

function cantOpen(problem: CantOpen): Analysis {
  return { ok: false, problem };
}

/**
 * A video decodes when Mediabunny says this browser has a decoder for its codec (canDecode asks
 * WebCodecs' isConfigSupported with the track's own configuration) and its first frame really
 * decodes into a thumbnail, which becomes the poster.
 */
async function analyzeVideo(track: InputVideoTrack, container: string): Promise<Analysis> {
  const problem = await undecodable(track);
  if (problem) return cantOpen(problem);
  const poster = await firstThumbnail(track);
  if (!poster) return cantOpen({ kind: "first-frame" });
  return { ok: true, facts: await videoFacts(track, container), poster };
}

/** Why this browser can't decode a video's codec; null when it can. */
async function undecodable(track: InputVideoTrack): Promise<CantOpen | null> {
  if (await track.canDecode()) return null;
  const codecString = await track.getCodecParameterString();
  const internal = await track.getInternalCodecId();
  return {
    kind: "video",
    codec: await track.getCodec(),
    codecString,
    containerCodec: typeof internal === "string" ? internal : null,
    decodesHevc: codecString !== null && (await decodesHevc(codecString)),
  };
}

async function videoFacts(track: InputVideoTrack, container: string): Promise<VideoFacts> {
  const { bestGuessFrameRate } = await track.computeFrameRateMetrics();
  return {
    kind: "video",
    container,
    codec: await track.getCodec(),
    durationSec: await track.computeDuration(),
    width: await track.getDisplayWidth(),
    height: await track.getDisplayHeight(),
    fps: Number.isFinite(bestGuessFrameRate) && bestGuessFrameRate > 0 ? bestGuessFrameRate : null,
  };
}

/** For a 10-bit HEVC file: whether this browser decodes 8-bit HEVC (Main profile) at all. */
async function decodesHevc(codecString: string): Promise<boolean> {
  if (!/^(hvc1|hev1)\./.test(codecString) || !isHighBitDepth(codecString)) return false;
  try {
    const { supported } = await VideoDecoder.isConfigSupported({ codec: "hvc1.1.6.L93.B0" });
    return supported === true;
  } catch {
    return false;
  }
}

async function firstThumbnail(track: InputVideoTrack): Promise<Thumbnail | null> {
  const sink = new CanvasSink(track, { width: THUMBNAIL_WIDTH });
  const first = Math.max(0, await track.getFirstTimestamp());
  try {
    const frame = await within(sink.getCanvas(first), FRAME_MS);
    return frame ? await encode(frame.canvas) : null;
  } catch {
    return null;
  }
}

/** Audio's decodability is decided on the main thread, by decodeAudioData, as playback will. */
async function analyzeAudio(track: InputAudioTrack, container: string): Promise<Analysis> {
  return {
    ok: true,
    facts: {
      kind: "audio",
      container,
      codec: await track.getCodec(),
      durationSec: await track.computeDuration(),
      channels: await track.getNumberOfChannels(),
      sampleRate: await track.getSampleRate(),
    },
    poster: null,
  };
}

// Thumbnails ---------------------------------------------------------------------------------

/** Whether this browser's OffscreenCanvas encodes WebP: learned from the first blob. */
let webpEncodes: boolean | null = null;

/** A thumbnail as WebP when the blob really comes out as WebP, else as JPEG. */
async function encode(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Thumbnail> {
  if (!(canvas instanceof OffscreenCanvas)) throw new Error("Workers draw on OffscreenCanvas.");
  if (webpEncodes !== false) {
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
    webpEncodes = thumbnailTypeOf(blob) === "image/webp";
    if (webpEncodes) return { blob, type: "image/webp" };
  }
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return { blob, type: "image/jpeg" };
}

/**
 * One thumbnail per second of a stored video, read from its copy: each is saved to the asset's
 * thumbs folder and sent to the main thread as soon as it's made, so the filmstrip fills in. Then
 * thumbnails.json, which says they're done. A frame that won't decode, or takes over 15 s, ends
 * the thumbnails: the copy is good, and the filmstrip leaves the rest empty. Storage failing
 * fails the request, at thumbnails.json at the latest. CanvasSink decodes and closes the frames
 * itself.
 */
async function makeThumbnails(id: number, meta: StoredMedia): Promise<void> {
  const folder = await assetFolder(meta.id);
  const thumbs = await folder.getDirectoryHandle(THUMBNAILS_FOLDER, { create: true });
  const file = await (await folder.getFileHandle(meta.source)).getFile();
  const input = new Input({ formats: FORMATS, source: new BlobSource(file) });
  let type: ThumbnailType = "image/jpeg";
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("The stored copy has no video.");
    const sink = new CanvasSink(track, { width: THUMBNAIL_WIDTH });
    const times = thumbnailTimestamps(meta.durationSec, await track.getFirstTimestamp());
    const frames = sink.canvasesAtTimestamps(times);
    try {
      for (let index = 0; index < times.length; index += 1) {
        const next = await within(frames.next(), FRAME_MS);
        if (!next || next.done === true) break;
        if (!next.value) continue;
        const thumbnail = await encode(next.value.canvas);
        type = thumbnail.type;
        const bytes = new Uint8Array(await thumbnail.blob.arrayBuffer());
        await writeFile(thumbs, thumbnailFileName(index, thumbnail.type), bytes);
        post({ type: "thumbnail", id, index, thumbnail });
      }
    } catch {
      // The thumbnails stop here; thumbnails.json below says whether storage still works.
    }
    const made: StoredThumbnails = { count: times.length, type };
    await writeFile(folder, THUMBNAILS_FILE, new TextEncoder().encode(JSON.stringify(made)));
  } finally {
    input.dispose();
  }
}

// Remote media -------------------------------------------------------------------------------

/**
 * A remote video's facts, read with range requests: its header and sample tables, not its frames
 * (one request for a Feed clip, whose header comes first). It must decode here, as for a file;
 * its first frame isn't decoded, since its thumbnails will show whether its frames do.
 */
async function probe(url: string): Promise<Analysis> {
  const input = new Input({ formats: FORMATS, source: remoteSource(url) });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return cantOpen({ kind: "not-media" });
    const problem = await undecodable(video);
    if (problem) return cantOpen(problem);
    return {
      ok: true,
      facts: await videoFacts(video, (await input.getFormat()).name),
      poster: null,
    };
  } finally {
    input.dispose();
  }
}

/**
 * A remote video's thumbnails, one per second, each from index `from` on sent to the main thread
 * as it's made. From the Feed's preview of a clip (its first 2.5 s at 480p, a tenth of the 720p
 * file's bytes), only the thumbnails it holds. From the whole clip, all of them, kept in the
 * asset's folder where this browser lets the site store files, then meta.json with its facts once
 * every one is stored: a later session reads them back instead of fetching the video again. The
 * ones before `from`, which the preview sent, are made again only to be stored: the 720p file has
 * a single key frame, so its frames before `from` are decoded on the way anyway. Thumbnails that
 * stop early (the connection dropped) or that storage didn't keep leave no meta.json, so the next
 * session makes them again.
 */
async function makeRemoteThumbnails(
  id: number,
  { assetId, url, from, preview }: RemoteThumbnails,
): Promise<void> {
  const folder = preview ? null : await remoteFolder(assetId).catch(() => null);
  const thumbs = await folder
    ?.getDirectoryHandle(THUMBNAILS_FOLDER, { create: true })
    .catch(() => null);
  const input = new Input({ formats: FORMATS, source: remoteSource(url) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("The video has no picture.");
    const first = await track.getFirstTimestamp();
    let facts: VideoFacts | null = null;
    let times: number[];
    if (preview) {
      times = previewTimestamps(preview.count, await track.computeDuration(), first);
    } else {
      facts = await videoFacts(track, (await input.getFormat()).name);
      times = thumbnailTimestamps(facts.durationSec, first);
    }
    // All of them when they're to be stored, else only the ones to send.
    const start = thumbs ? 0 : from;
    const sink = new CanvasSink(track, { width: THUMBNAIL_WIDTH });
    const frames = sink.canvasesAtTimestamps(times.slice(start));
    let type: ThumbnailType = "image/jpeg";
    let kept = 0;
    let made = 0;
    try {
      for (let index = start; index < times.length; index += 1) {
        const next = await within(frames.next(), FRAME_MS);
        if (!next || next.done === true) break;
        if (!next.value) continue;
        const thumbnail = await encode(next.value.canvas);
        type = thumbnail.type;
        if (index >= from) {
          made += 1;
          post({ type: "thumbnail", id, index, thumbnail });
        }
        if (!thumbs) continue;
        const bytes = new Uint8Array(await thumbnail.blob.arrayBuffer());
        const stored = await writeFile(thumbs, thumbnailFileName(index, type), bytes).then(
          () => true,
          () => false,
        );
        if (stored) kept += 1;
      }
    } catch {
      // The thumbnails stop here: without all of them, no meta.json.
    }
    if (made === 0 && times.length > from) throw new Error("No thumbnail decoded.");
    if (!facts || !folder || kept < times.length) return;
    const meta: RemoteMeta = {
      version: 1,
      id: assetId,
      facts,
      thumbnails: { count: kept, type },
    };
    await writeFile(folder, META_FILE, new TextEncoder().encode(JSON.stringify(meta))).catch(
      () => undefined,
    );
  } finally {
    input.dispose();
  }
}

async function remoteFolder(assetId: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const remote = await root.getDirectoryHandle(REMOTE_FOLDER, { create: true });
  return remote.getDirectoryHandle(assetId, { create: true });
}

// Storage ------------------------------------------------------------------------------------

/** TypeScript's DOM types leave out this worker-only call. */
interface SyncFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle?: () => Promise<SyncWriter & { close(): void }>;
}

async function openSync(folder: FileSystemDirectoryHandle, name: string) {
  const handle: SyncFileHandle = await folder.getFileHandle(name, { create: true });
  if (typeof handle.createSyncAccessHandle !== "function") throw new NoStorage();
  return handle.createSyncAccessHandle();
}

async function assetsFolder(): Promise<FileSystemDirectoryHandle> {
  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch {
    throw new NoStorage();
  }
  return root.getDirectoryHandle(ASSETS_FOLDER, { create: true });
}

async function assetFolder(assetId: string): Promise<FileSystemDirectoryHandle> {
  return (await assetsFolder()).getDirectoryHandle(assetId, { create: true });
}

async function writeFile(folder: FileSystemDirectoryHandle, name: string, bytes: Uint8Array) {
  const handle = await openSync(folder, name);
  try {
    handle.truncate(0);
    writeAll(handle, bytes);
    handle.flush();
  } finally {
    handle.close();
  }
}

async function writeJson(folder: FileSystemDirectoryHandle, meta: StoredMedia): Promise<void> {
  await writeFile(folder, META_FILE, new TextEncoder().encode(JSON.stringify(meta)));
}

/**
 * Copies a file into its asset's folder, reporting progress, then its peaks if it has any and its
 * meta.json, which marks the copy finished. If anything fails, such as storage running out, the
 * folder goes too: no half copy stays behind.
 */
async function store(request: Extract<WorkerRequest, { type: "store" }>): Promise<void> {
  const assets = await assetsFolder();
  const folder = await assets.getDirectoryHandle(request.assetId, { create: true });
  try {
    const handle = await openSync(folder, request.source);
    try {
      await copyInChunks(request.file, handle, (fraction) => {
        post({ type: "progress", id: request.id, fraction });
      });
    } finally {
      handle.close();
    }
    if (request.peaks) await writeFile(folder, PEAKS_FILE, encodePeaks(request.peaks));
    await writeJson(folder, request.meta);
  } catch (error) {
    await assets.removeEntry(request.assetId, { recursive: true }).catch(() => undefined);
    throw error;
  }
}
