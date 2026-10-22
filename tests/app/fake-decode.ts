// A decode worker for component tests, which mock src/media/decode-client.ts with it: it writes
// down every request, and the test answers for it, as the real worker would.
//
//   vi.mock("../../src/media/decode-client.ts", async () => ({
//     decodeWorker: (await import("./fake-decode.ts")).fakeDecode.worker,
//   }));

import type { TrackPlan } from "../../src/engine/schedule.ts";
import type { DecodeEvent, DecodeWorker } from "../../src/media/decode-client.ts";
import type { StillRequest } from "../../src/media/decode-protocol.ts";

const listeners = new Set<(event: DecodeEvent) => void>();

export const fakeDecode = {
  stills: [] as StillRequest[],
  plays: [] as { session: number; tracks: TrackPlan[]; capacity: number }[],
  acks: [] as { session: number; trackId: string; count: number }[],
  stops: [] as number[],
  worker: {
    still: (request) => fakeDecode.stills.push(request),
    play: (session, tracks, capacity) => fakeDecode.plays.push({ session, tracks, capacity }),
    ack: (session, trackId, count) => fakeDecode.acks.push({ session, trackId, count }),
    stop: (session) => fakeDecode.stops.push(session),
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } satisfies DecodeWorker,
  /** Sends an answer, as the worker would. */
  emit(event: DecodeEvent): void {
    for (const listener of listeners) listener(event);
  },
  reset(): void {
    fakeDecode.stills.length = 0;
    fakeDecode.plays.length = 0;
    fakeDecode.acks.length = 0;
    fakeDecode.stops.length = 0;
  },
};

/** Stands in for an ImageBitmap or a VideoFrame: an id for the canvas recorder, and its size. */
export function fakeImage(id: string, width = 640, height = 360) {
  const image = {
    id,
    width,
    height,
    displayWidth: width,
    displayHeight: height,
    closed: 0,
    close() {
      image.closed += 1;
    },
  };
  return image;
}

export type FakeImage = ReturnType<typeof fakeImage>;

/** Answers the newest still request for a slot with an image. */
export function answerStill(slot: string, image: FakeImage | null): void {
  const request = fakeDecode.stills.findLast((candidate) => candidate.slot === slot);
  if (!request) throw new Error(`No still was asked for ${slot}`);
  fakeDecode.emit({
    type: "still",
    slot,
    seq: request.seq,
    bitmap: image as unknown as ImageBitmap | null,
    open: 0,
  });
}

/**
 * Sends each track's first frame for the newest playback, as the worker would: playback starts
 * its clock once they're in. Each lasts until its clip ends.
 */
export function answerPlay(): void {
  const play = fakeDecode.plays.at(-1);
  if (!play) throw new Error("Nothing was played");
  for (const { trackId, runs } of play.tracks) {
    const [run] = runs;
    if (!run) continue;
    fakeDecode.emit({
      type: "frame",
      session: play.session,
      trackId,
      clipId: run.clipId,
      presentUs: run.startUs,
      endUs: run.endUs,
      rotation: 0,
      flip: false,
      frame: fakeImage(`${trackId}:${run.clipId}`) as unknown as VideoFrame,
      open: 0,
    });
  }
}
