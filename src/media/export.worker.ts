// The export worker (spec section 4.7): it makes the film, off the main thread, from a snapshot of
// the project. Mediabunny's Output writes MP4 (fast start) or WebM into memory; a CanvasSource
// encodes an OffscreenCanvas at 1920 × 1080 or 1280 × 720, on which each output frame is drawn,
// V1 then V2, each source frame fitted with its shape kept (letterboxed) over black; an
// AudioSampleSource encodes the music the main thread mixed (Web Audio isn't in workers). Each
// clip is decoded once, forward (src/media/export-reader.ts), from its file in storage or its
// address with range requests; the frame loop awaits the encoder (src/media/export-job.ts).
//
// It reports each frame encoded, and a small picture of the frame being encoded about twice a
// second. A cancel stops the loop and cancels the output, and a failure does the same: neither
// keeps anything. A finished file is checked here before it's handed over: its first and last
// frames decode, and its length is the cut's within a frame (src/media/export-check.ts).
//
// It counts the VideoSamples it holds, and every message carries the count.

import {
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  QTFF,
  Quality,
  type VideoSample,
  VideoSampleSink,
  WEBM,
  WebMOutputFormat,
} from "mediabunny";
import { decodePasses, type DecodePass } from "../engine/export-schedule.ts";
import { exportLocation, locationKey, type MediaLocation } from "../engine/picture.ts";
import { findAsset, projectDuration } from "../engine/project.ts";
import { sourceSeconds } from "../engine/time.ts";
import type { Fps, Frames, Project } from "../engine/types.ts";
import type { Measured } from "./export-check.ts";
import {
  type Encoders,
  type ExportSize,
  FORMATS,
  MIX_CHANNELS,
  MIX_SAMPLE_RATE,
  SIZES,
} from "./export-format.ts";
import { encoderDelay } from "./encoder-delay.ts";
import { encodeFrames, StageError } from "./export-job.ts";
import type { MixedAudio } from "./export-mix.ts";
import type { ExportFailure, ExportJob, ExportRequest, ExportResponse } from "./export-protocol.ts";
import { type Pass, TrackReader } from "./export-reader.ts";
import { UnreachableError, unreachable } from "./remote.ts";
import { sourceOf } from "./sources.ts";

/** The containers a clip can be in: MP4, MOV and WebM, as the bin takes them. */
const INPUT_FORMATS = [MP4, QTFF, WEBM];

/** The dialog's picture of the frame being encoded, at most this often. */
const PREVIEW_MS = 500;

/** A frame that takes this long to come: the network stalled mid-file, or the decoder hung. */
const STALL_MS = 30_000;

/** The music is added a second of samples at a time. */
const AUDIO_CHUNK = MIX_SAMPLE_RATE;

/** The VideoSamples the worker holds right now. */
let open = 0;

function post(response: ExportResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer });
}

/** Each export asked for and not yet over, by number: a cancel stops it, under way or waiting. */
const exports = new Map<number, AbortController>();
/** Exports run one after another: a new one waits for a canceled one to let go of everything. */
let queue: Promise<void> = Promise.resolve();

self.addEventListener("message", (event: MessageEvent<ExportRequest>) => {
  const request = event.data;
  switch (request.type) {
    case "encoders":
      void encoders(request.id, request.size, request.fps);
      return;
    case "start": {
      const controller = new AbortController();
      exports.set(request.run, controller);
      queue = queue
        .then(() => run(request.run, request.job, controller.signal))
        .finally(() => exports.delete(request.run));
      return;
    }
    case "cancel":
      exports.get(request.run)?.abort();
      return;
  }
});

// Asking the browser ---------------------------------------------------------------------------

/** Which codecs encode at a size and its bitrate: asked of the browser, through Mediabunny. */
async function encoders(id: number, size: ExportSize, fps: Fps): Promise<void> {
  const { width, height, videoBitrate } = SIZES[size];
  const video = (codec: "avc" | "vp9") =>
    canEncodeVideo(codec, {
      width,
      height,
      frameRate: fps,
      quality: new Quality({ bitrate: videoBitrate }),
    }).catch(() => false);
  const audio = (codec: "aac" | "opus", bitrate: number) =>
    canEncodeAudio(codec, {
      numberOfChannels: MIX_CHANNELS,
      sampleRate: MIX_SAMPLE_RATE,
      quality: new Quality({ bitrate }),
    }).catch(() => false);
  const [avc, aac, vp9, opus] = await Promise.all([
    video("avc"),
    audio("aac", FORMATS.mp4.audioBitrate),
    video("vp9"),
    audio("opus", FORMATS.webm.audioBitrate),
  ]);
  const answer: Encoders = { avc, aac, vp9, opus };
  post({ type: "encoders", id, encoders: answer });
}

// Reading the clips ----------------------------------------------------------------------------

function received(sample: VideoSample | null): VideoSample | null {
  if (sample) open += 1;
  return sample;
}

function release(sample: VideoSample | null): void {
  if (!sample) return;
  sample.close();
  open -= 1;
}

/** A media file the export reads, as it opens. */
interface OpenFile {
  /** The Input, made as soon as its source is: disposing it stops its reads, its opening's too. */
  input: Promise<Input>;
  /** Its video, once the file's header is read. */
  sink: Promise<VideoSampleSink>;
  /** The clips' passes reading it. */
  users: number;
}

/**
 * Each media file the export reads, opened once and shared by its clips' passes (a split clip's
 * halves, say), and let go of when its last pass closes: that stops any read still under way.
 */
class Files {
  private readonly files = new Map<string, OpenFile>();

  /** A clip's pass over its file: Mediabunny decodes it forward from the pass's start. */
  pass(pass: DecodePass, location: MediaLocation): Pass<VideoSample> {
    const key = locationKey(location);
    let file = this.files.get(key);
    if (!file) {
      file = openFile(location);
      this.files.set(key, file);
    }
    file.users += 1;
    const samples = file.sink.then((sink) => sink.samples(pass.fromSec, pass.toSec));
    // A file that won't open fails the pass at its first frame; closing it then needs nothing.
    samples.catch(() => undefined);
    let closed = false;
    return {
      next: async () => {
        // Opening the file counts against the stall limit, as each frame does.
        const iterator = await withinStallLimit(samples);
        if (closed) return null;
        const next = await withinStallLimit(iterator.next(), (late) => {
          if (late.done !== true) late.value.close();
        });
        return next.done === true ? null : next.value;
      },
      close: async () => {
        if (closed) return;
        closed = true;
        // The file goes first: if this was its last pass, its reads stop, an opening's included,
        // so nothing here waits on the network.
        this.leave(key);
        const iterator = await samples.catch(() => null);
        await iterator?.return();
      },
    };
  }

  /** Lets go of every file, as an export ends or stops. */
  closeAll(): void {
    for (const key of [...this.files.keys()]) this.dispose(key);
  }

  private leave(key: string): void {
    const file = this.files.get(key);
    if (!file) return;
    file.users -= 1;
    if (file.users <= 0) this.dispose(key);
  }

  private dispose(key: string): void {
    const file = this.files.get(key);
    this.files.delete(key);
    void file?.input.then(
      (input) => {
        input.dispose();
      },
      () => undefined,
    );
  }
}

function openFile(location: MediaLocation): OpenFile {
  const input = sourceOf(location).then((source) => new Input({ formats: INPUT_FORMATS, source }));
  const sink = input.then(async (opened) => {
    const track = await opened.getPrimaryVideoTrack();
    if (!track) throw new Error("The media has no video.");
    return new VideoSampleSink(track);
  });
  input.catch(() => undefined);
  sink.catch(() => undefined);
  return { input, sink, users: 0 };
}

/**
 * What doesn't come within the stall limit (the network stalled mid-file, or the decoder hung)
 * fails as unreachable; if it comes after all, `late` lets go of it, as nobody waits for it.
 */
function withinStallLimit<T>(promise: Promise<T>, late?: (value: T) => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  void promise.then(
    (value) => {
      if (timedOut) late?.(value);
    },
    () => undefined,
  );
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new UnreachableError(`Nothing in ${STALL_MS / 1000} s`));
    }, STALL_MS);
  });
  return Promise.race([promise, stalled]).finally(() => {
    clearTimeout(timer);
  });
}

// The music ------------------------------------------------------------------------------------

/**
 * The mixed music, added to its encoder a second at a time, ahead of the picture. Its times are
 * the encoder's delay early (src/media/encoder-delay.ts), so the priming the encoder adds falls
 * before 0, where the file's edit list skips it, and the music lands on the picture.
 */
class Music {
  readonly source: AudioSampleSource;
  private readonly audio: MixedAudio;
  private readonly delay: number;
  /** The next sample to add. */
  private next = 0;

  constructor(audio: MixedAudio, source: AudioSampleSource, delay: number) {
    this.audio = audio;
    this.source = source;
    this.delay = delay;
  }

  private get length(): number {
    return this.audio.channels[0]?.length ?? 0;
  }

  /** Adds the music up to `seconds` into the cut, in whole chunks. */
  async until(seconds: number): Promise<void> {
    const end = Math.min(this.length, Math.ceil(seconds * this.audio.sampleRate));
    while (this.next < end) {
      const from = this.next;
      const to = Math.min(this.length, from + AUDIO_CHUNK);
      const count = to - from;
      const data = new Float32Array(count * this.audio.channels.length);
      this.audio.channels.forEach((channel, index) => {
        data.set(channel.subarray(from, to), index * count);
      });
      const sample = new AudioSample({
        data,
        format: "f32-planar",
        numberOfChannels: this.audio.channels.length,
        sampleRate: this.audio.sampleRate,
        timestamp: (from - this.delay) / this.audio.sampleRate,
      });
      this.next = to;
      try {
        await this.source.add(sample);
      } finally {
        sample.close();
      }
    }
  }

  /** Adds the rest, and closes the track. */
  async finish(): Promise<void> {
    await this.until(this.length / this.audio.sampleRate);
    this.source.close();
  }
}

// The export -----------------------------------------------------------------------------------

async function run(id: number, job: ExportJob, signal: AbortSignal): Promise<void> {
  // Canceled while it waited for the export before it.
  if (signal.aborted) {
    post({ type: "canceled", run: id, open });
    return;
  }
  const { project, size, format, audio, preview } = job;
  const { width, height, videoBitrate } = SIZES[size];
  const spec = FORMATS[format];
  const { fps } = project;
  const frames = projectDuration(project);
  const started = performance.now();
  const codecs: { video: string; audio: string } = { video: spec.video, audio: spec.audio };
  const tracks = decodePasses(project);
  const files = new Files();
  const readers = new Map(
    tracks.map(({ trackId, passes }) => [
      trackId,
      new TrackReader<VideoSample>(passes, {
        open: (pass) => {
          const asset = findAsset(project, pass.assetId);
          if (!asset) throw new Error(`No asset ${pass.assetId}`);
          return files.pass(pass, exportLocation(asset, height));
        },
        opened: () => {
          open += 1;
        },
        closed: () => {
          open -= 1;
        },
      }),
    ]),
  );
  const closeReaders = () => Promise.all([...readers.values()].map((reader) => reader.close()));
  let output: Output | null = null;
  const cancelOutput = async () => {
    if (output && output.state !== "canceled" && output.state !== "finalized") {
      await output.cancel().catch(() => undefined);
    }
  };
  // A cancel stops the reads and the encoders under way, so whatever the loop waits for ends now
  // rather than when the network answers.
  const stop = () => {
    void closeReaders();
    files.closeAll();
    void cancelOutput();
  };
  signal.addEventListener("abort", stop, { once: true });

  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    const pictures = new OffscreenCanvas(preview.width, preview.height);
    const pictureContext = pictures.getContext("2d");
    if (!context || !pictureContext) throw new Error("No 2D context in this worker.");
    const target = new BufferTarget();
    output = new Output({
      format:
        format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
      target,
    });
    const video = new CanvasSource(canvas, {
      codec: spec.video,
      quality: new Quality({ bitrate: videoBitrate }),
      onEncoderConfig: (config) => {
        codecs.video = config.codec;
      },
    });
    output.addVideoTrack(video, { frameRate: fps });
    const music = audio
      ? new Music(
          audio,
          new AudioSampleSource({
            codec: spec.audio,
            quality: new Quality({ bitrate: spec.audioBitrate }),
            onEncoderConfig: (config) => {
              codecs.audio = config.codec;
            },
          }),
          // AAC's priming isn't in the stream, so it's measured and skipped by the MP4's edit list;
          // Opus states its own (pre-skip) in its header, which WebM players honor.
          spec.audio === "aac"
            ? await encoderDelay({
                codec: "mp4a.40.2",
                sampleRate: audio.sampleRate,
                numberOfChannels: audio.channels.length,
                bitrate: spec.audioBitrate,
              })
            : 0,
        )
      : null;
    if (music) output.addAudioTrack(music.source);

    let lastPicture = -Infinity;
    /** The frame on the canvas, drawn small for the dialog. */
    const picture = (): ImageBitmap => {
      pictureContext.drawImage(canvas, 0, 0, preview.width, preview.height);
      return pictures.transferToImageBitmap();
    };

    await output.start();
    const loop = await encodeFrames(project, {
      readers,
      draw: (shown) => {
        context.fillStyle = "#000";
        context.fillRect(0, 0, width, height);
        for (const sample of shown) sample.drawWithFit(context, { fit: "contain" });
      },
      addVideo: (frame) => video.add(frame / fps, 1 / fps),
      addAudio: (seconds) => music?.until(seconds) ?? Promise.resolve(),
      progress: (frame) => {
        const now = performance.now();
        if (now - lastPicture >= PREVIEW_MS) {
          lastPicture = now;
          const bitmap = picture();
          post({ type: "preview", run: id, frame, bitmap, open }, [bitmap]);
        }
        post({ type: "progress", run: id, frame, open });
      },
      signal,
    });
    const framesMs = performance.now() - started;
    await closeReaders();
    video.close();
    await music?.finish();
    await output.finalize();
    const { buffer } = target;
    if (!buffer) throw new Error("The file came out empty.");
    const file = new Blob([buffer], { type: spec.mimeType });
    const finished = performance.now();
    const { measured, firstFrame } = await measure(file, frames, fps, pictures);
    post(
      {
        type: "done",
        run: id,
        file,
        measured,
        firstFrame,
        timings: {
          ...loop,
          framesMs,
          finishMs: finished - started - framesMs,
          checkMs: performance.now() - finished,
        },
        open,
      },
      firstFrame ? [firstFrame] : [],
    );
  } catch (error) {
    await closeReaders();
    await cancelOutput();
    if (aborted(signal)) post({ type: "canceled", run: id, open });
    else post({ type: "failed", run: id, failure: failureOf(error, project, codecs), open });
  } finally {
    signal.removeEventListener("abort", stop);
    files.closeAll();
  }
}

/** Read through a call: the export can be canceled while it awaits anything. */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** What stopped an export, as the dialog explains it. */
function failureOf(
  error: unknown,
  project: Project,
  codecs: { video: string; audio: string },
): ExportFailure {
  if (!(error instanceof StageError)) {
    return { kind: "output", message: error instanceof Error ? error.message : String(error) };
  }
  const { stage, frame, message } = error;
  if (stage !== "read") {
    return { kind: "encoder", track: stage, frame, message, codec: codecs[stage] };
  }
  const asset = error.assetId === null ? undefined : findAsset(project, error.assetId);
  const assetId = asset?.id ?? error.assetId ?? "";
  // Media at an address that didn't load, after its retries; a file in storage can't be offline.
  if (asset && asset.source.type !== "file" && unreachable(error.cause)) {
    return { kind: "unreachable", assetId };
  }
  return { kind: "decode", assetId, frame, message };
}

// The output check -----------------------------------------------------------------------------

/**
 * Reads the finished file back: its length (its picture's: an AAC track runs on a frame or two of
 * silence, as its last packet is padded), and whether its first and last frames decode; the first
 * one is also drawn on `pictures`, small, for the done screen.
 */
async function measure(
  file: Blob,
  frames: Frames,
  fps: Fps,
  pictures: OffscreenCanvas,
): Promise<{ measured: Measured; firstFrame: ImageBitmap | null }> {
  const input = new Input({ formats: [MP4, WEBM], source: new BlobSource(file) });
  let first: VideoSample | null = null;
  let last: VideoSample | null = null;
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) {
      return {
        measured: { durationSec: null, firstFrame: false, lastFrame: false },
        firstFrame: null,
      };
    }
    const durationSec = await track.computeDuration().catch(() => null);
    const sink = new VideoSampleSink(track);
    first = received(await sink.getSample(await track.getFirstTimestamp()).catch(() => null));
    const context = pictures.getContext("2d");
    let firstFrame: ImageBitmap | null = null;
    if (first && context) {
      context.fillStyle = "#000";
      context.fillRect(0, 0, pictures.width, pictures.height);
      first.drawWithFit(context, { fit: "contain" });
      firstFrame = pictures.transferToImageBitmap();
    }
    last = received(await sink.getSample(sourceSeconds(frames - 1, fps)).catch(() => null));
    const lastFrame = last !== null && Math.abs(last.timestamp - (frames - 1) / fps) < 0.5 / fps;
    return { measured: { durationSec, firstFrame: first !== null, lastFrame }, firstFrame };
  } finally {
    release(first);
    release(last);
    input.dispose();
  }
}
