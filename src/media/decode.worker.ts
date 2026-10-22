// The decode worker (spec section 4.5): every video frame the monitor shows is decoded here, off
// the main thread. It owns one Mediabunny Input per media file, opened from a copy in OPFS or, for
// the Feed's clips, from their address with range requests (src/media/remote.ts), and does two
// kinds of work (src/media/decode-protocol.ts):
//
// - Stills, for the paused monitor: the exact frame at a source time, fitted into an ImageBitmap
//   at the monitor's size in device pixels. Latest wins per slot: a request that comes in replaces
//   the one waiting and stops the one under way (src/media/latest-wins.ts).
// - Playback: each video track's frames in timeline order, as VideoFrames transferred to the main
//   thread, at most `capacity` ahead of what it has handed back (src/media/track-pump.ts).
//
// It counts the VideoSamples it holds, and every message carries the count: a sample is closed as
// soon as its picture is drawn into a bitmap or copied into a VideoFrame, which is transferred, so
// the worker holds nothing between requests.

import { Input, MP4, QTFF, type VideoSample, VideoSampleSink, WEBM } from "mediabunny";
import { locationKey, type MediaLocation } from "../engine/picture.ts";
import type { VideoRun } from "../engine/schedule.ts";
import type { DecodeRequest, DecodeResponse, StillRequest } from "./decode-protocol.ts";
import { LatestSlot } from "./latest-wins.ts";
import { unreachable } from "./remote.ts";
import { sourceOf } from "./sources.ts";
import { type Reader, TrackPump } from "./track-pump.ts";

/** The video containers the bin takes: MP4, MOV and WebM. */
const FORMATS = [MP4, QTFF, WEBM];

/** The VideoSamples the worker holds right now. */
let open = 0;

function post(response: DecodeResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer });
}

self.addEventListener("message", (event: MessageEvent<DecodeRequest>) => {
  const request = event.data;
  switch (request.type) {
    case "still":
      still(request.request);
      return;
    case "play":
      wanted = request.session;
      void play(request);
      return;
    case "ack":
      if (session?.id === request.session) session.pumps.get(request.trackId)?.ack(request.count);
      return;
    case "stop":
      if (wanted === request.session) wanted = null;
      if (session?.id === request.session) void stop();
      return;
  }
});

// Sources ------------------------------------------------------------------------------------

/** A media file's video, opened once: its Input stays open for the next request. */
interface Opened {
  sink: VideoSampleSink;
  /** When its first frame starts, in seconds: before it, there's no frame to show. */
  first: number;
}

/** Each media file's video, by where it is: two assets of one file share it. */
const sinks = new Map<string, Promise<Opened>>();

function sinkFor(location: MediaLocation): Promise<Opened> {
  const key = locationKey(location);
  let sink = sinks.get(key);
  if (!sink) {
    sink = openSink(location);
    sinks.set(key, sink);
    // One that fails (the copy is gone, the address didn't answer) is tried again next time.
    sink.catch(() => sinks.delete(key));
  }
  return sink;
}

async function openSink(location: MediaLocation): Promise<Opened> {
  const input = new Input({ formats: FORMATS, source: await sourceOf(location) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("The media has no video.");
  return { sink: new VideoSampleSink(track), first: await track.getFirstTimestamp() };
}

function received(sample: VideoSample | null | undefined): VideoSample | null {
  if (!sample) return null;
  open += 1;
  return sample;
}

function release(sample: VideoSample | null): void {
  if (!sample) return;
  sample.close();
  open -= 1;
}

// Stills -------------------------------------------------------------------------------------

const slots = new Map<string, LatestSlot<StillRequest>>();

function still(request: StillRequest): void {
  let slot = slots.get(request.slot);
  if (!slot) {
    slot = new LatestSlot(decodeStill);
    slots.set(request.slot, slot);
  }
  slot.submit(request);
}

/** Read through a call: the signal can fire while the still decodes. */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Decodes one still, unless a newer request for its slot stops it first. */
async function decodeStill(request: StillRequest, signal: AbortSignal): Promise<void> {
  const { slot, seq } = request;
  let sample: VideoSample | null = null;
  try {
    const { sink, first } = await sinkFor(request.location);
    if (signal.aborted) return;
    const samples = sink.samplesAtTimestamps([request.seconds]);
    const abort = () => void samples.return();
    signal.addEventListener("abort", abort);
    try {
      const next = await samples.next();
      sample = received(next.done === true ? null : next.value);
    } finally {
      signal.removeEventListener("abort", abort);
      await samples.return();
    }
    // A newer request came in while this one decoded: nobody will look at it.
    if (aborted(signal)) return;
    // No frame where the file has frames: the decoder went quiet on a damaged or cut-short file.
    if (!sample && request.seconds >= first) throw new Error("No frame decoded");
    const bitmap = sample && bitmapOf(sample, request.width, request.height);
    release(sample);
    sample = null;
    post({ type: "still", slot, seq, bitmap, open }, bitmap ? [bitmap] : []);
  } catch (error) {
    // Let go of the sample first, so the count this answer carries is right.
    release(sample);
    sample = null;
    if (!signal.aborted) {
      post({ type: "still-failed", slot, seq, unreachable: unreachable(error), open });
    }
  } finally {
    release(sample);
  }
}

let canvas: OffscreenCanvas | null = null;

/** The sample drawn into a bitmap of the box's size, its shape and rotation kept, centered. */
function bitmapOf(sample: VideoSample, width: number, height: number): ImageBitmap {
  canvas ??= new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D context in this worker.");
  sample.drawWithFit(context, { fit: "contain" });
  return canvas.transferToImageBitmap();
}

// Playback -----------------------------------------------------------------------------------

interface Session {
  id: number;
  pumps: Map<string, TrackPump<VideoSample>>;
  /** Each track's pump, running until its frames are all sent, it fails, or it's stopped. */
  running: Promise<void>[];
}

let session: Session | null = null;
/** The session the main thread wants running: a stop that comes in while one starts cancels it. */
let wanted: number | null = null;

async function play(request: Extract<DecodeRequest, { type: "play" }>): Promise<void> {
  await stop();
  if (wanted !== request.session || session !== null) return;
  const pumps = new Map<string, TrackPump<VideoSample>>();
  for (const { trackId, runs } of request.tracks) {
    pumps.set(
      trackId,
      new TrackPump(runs, request.capacity, {
        open: reader,
        send: (sample, placed) => {
          // A frame of its own, transferred at once: the main thread closes it. One that can't be
          // sent is closed here.
          const frame = sample.toVideoFrame();
          const { rotation, flip } = sample;
          try {
            post(
              {
                type: "frame",
                session: request.session,
                trackId,
                ...placed,
                rotation,
                flip,
                frame,
                open,
              },
              [frame],
            );
          } catch (error) {
            frame.close();
            throw error;
          }
        },
        fail: (run, atUs, error) => {
          post({
            type: "failed",
            session: request.session,
            trackId,
            clipId: run.clipId,
            atUs,
            unreachable: unreachable(error),
            open,
          });
        },
        opened: () => {
          open += 1;
        },
        closed: () => {
          open -= 1;
        },
      }),
    );
  }
  session = {
    id: request.session,
    pumps,
    running: [...pumps.values()].map((pump) => pump.run()),
  };
}

/** Stops the playback under way; once its decoders let go of everything, says how many are open. */
async function stop(): Promise<void> {
  const stopping = session;
  if (!stopping) return;
  session = null;
  await Promise.all([...stopping.pumps.values()].map((pump) => pump.stop()));
  await Promise.all(stopping.running);
  post({ type: "open", open });
}

/** A run's frames from Mediabunny: decoding starts as soon as it's opened. */
function reader(run: VideoRun): Reader<VideoSample> {
  let closed = false;
  const samples = sinkFor(run.location).then(({ sink }) => sink.samples(run.fromSec, run.toSec));
  // A source that won't open fails the run at its first frame; closing it then needs nothing.
  samples.catch(() => undefined);
  return {
    async next() {
      const iterator = await samples;
      if (closed) return null;
      const next = await iterator.next();
      return next.done === true ? null : next.value;
    },
    async close() {
      if (closed) return;
      closed = true;
      const iterator = await samples.catch(() => null);
      await iterator?.return();
    },
  };
}
