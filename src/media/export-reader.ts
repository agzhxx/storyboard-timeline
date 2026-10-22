// One video track's frames for an export (spec section 4.7), read forward. Each clip is decoded
// once, in one pass from its in point to its out point (a decoder fed in order, never a seek per
// frame, which would decode from a key frame again for every frame). For each output frame the
// export asks for a clip's frame at a source time and gets the last frame that starts at or before
// it: frames in between, from a source at a faster rate, are closed unseen, and one frame can be
// handed out again, for a slower rate. When a clip's pass becomes current, the next clip's opens at
// once, so its first bytes and frames are on their way while this clip encodes. Every frame read is
// closed, and closing the reader closes the passes with whatever they decoded ahead.
//
// A clip fails where its frames stop: the decoder threw, or, as a browser's decoder does with a
// damaged or cut-short file, it went quiet and the frames end early or skip ahead (as in M4).

import type { DecodePass } from "../engine/export-schedule.ts";
import { SOURCE_TOLERANCE_SEC } from "../engine/time.ts";

/** A decoded source frame: Mediabunny's VideoSample, or a fake in the tests. */
export interface Frame {
  /** In seconds, in the source. */
  readonly timestamp: number;
  readonly duration: number;
  close(): void;
}

/** A clip's frames in order, decoding from when it's opened: Mediabunny's sample iterator. */
export interface Pass<F extends Frame> {
  /** The next frame; null when the pass's frames are done. */
  next(): Promise<F | null>;
  /** Stops decoding and closes the frames decoded ahead. Closing twice does nothing. */
  close(): Promise<void>;
}

export interface ReaderDeps<F extends Frame> {
  /** Starts a clip's pass: decoding begins at once. */
  open: (pass: DecodePass) => Pass<F>;
  /** Count the frames the reader holds, for the open-frame counter. */
  opened: () => void;
  closed: () => void;
}

/** A clip's frames stopped before the frame the export needed. */
export class MissingFrameError extends Error {
  constructor(clipId: string, seconds: number) {
    super(`No frame of ${clipId} at ${seconds.toFixed(3)} s: its frames stopped coming`);
  }
}

/** The reader was closed while a frame was being read: the export stopped. */
export class ReaderClosedError extends Error {}

interface Reading<F extends Frame> {
  pass: DecodePass;
  frames: Pass<F>;
  /** The frame handed out last: the last one at or before the time asked for. */
  shown: F | null;
  /** The frame read after it, the first one later than the time asked for. */
  ahead: F | null;
  ended: boolean;
}

export class TrackReader<F extends Frame> {
  private readonly passes: readonly DecodePass[];
  private readonly deps: ReaderDeps<F>;
  /** The passes decoding, by index: the current clip's, and the next one's. */
  private readonly readings = new Map<number, Reading<F>>();
  private current = -1;
  private closed = false;

  constructor(passes: readonly DecodePass[], deps: ReaderDeps<F>) {
    this.passes = passes;
    this.deps = deps;
  }

  /**
   * The frame clip `clipId` shows at source time `seconds`: the last one that starts at or before
   * it; null before its file's first frame (a file can start after 0), which shows nothing there,
   * as on the monitor. The reader keeps the frame, and closes it once a later call moves past it.
   * Clips come in their track's order, and times within a clip only go forward.
   */
  async frameAt(clipId: string, seconds: number): Promise<F | null> {
    const reading = await this.readingFor(clipId);
    if (!reading.ahead && !reading.ended) reading.ahead = await this.read(reading);
    while (reading.ahead && reading.ahead.timestamp <= seconds) {
      this.release(reading.shown);
      reading.shown = reading.ahead;
      // Not ahead too while the next one is read: a close meanwhile releases it once.
      reading.ahead = null;
      reading.ahead = await this.read(reading);
    }
    const { shown, ahead } = reading;
    if (!shown && ahead) return null;
    // No frame at all, or the one at the time ends before it: the frames stopped.
    if (
      !shown ||
      (shown.duration > 0 && seconds >= shown.timestamp + shown.duration + SOURCE_TOLERANCE_SEC)
    ) {
      throw new MissingFrameError(clipId, seconds);
    }
    return shown;
  }

  /** Stops every pass and closes every frame the reader holds. */
  async close(): Promise<void> {
    this.closed = true;
    const readings = [...this.readings.values()];
    this.readings.clear();
    await Promise.all(readings.map((reading) => this.finish(reading)));
  }

  /** The pass for a clip, which becomes current: the passes before it close, the next one opens. */
  private async readingFor(clipId: string): Promise<Reading<F>> {
    const current = this.readings.get(this.current);
    if (current?.pass.clipId === clipId) return current;
    const index = this.passes.findIndex((pass, at) => at > this.current && pass.clipId === clipId);
    if (index < 0) throw new Error(`${clipId} isn't a clip after the current one on this track`);
    for (const [at, done] of this.readings) {
      if (at >= index) continue;
      this.readings.delete(at);
      await this.finish(done);
    }
    this.current = index;
    const reading = this.start(index);
    this.start(index + 1);
    if (!reading) throw new Error(`No pass ${index}`);
    return reading;
  }

  private start(index: number): Reading<F> | null {
    const known = this.readings.get(index);
    if (known) return known;
    const pass = this.passes[index];
    if (!pass || this.closed) return null;
    const reading = { pass, frames: this.deps.open(pass), shown: null, ahead: null, ended: false };
    this.readings.set(index, reading);
    return reading;
  }

  private async read(reading: Reading<F>): Promise<F | null> {
    const frame = await reading.frames.next();
    if (frame === null) {
      reading.ended = true;
      return null;
    }
    this.deps.opened();
    if (this.isClosed()) {
      this.release(frame);
      throw new ReaderClosedError("The export stopped");
    }
    return frame;
  }

  /** Read through a call: `close()` can set it while a frame is read. */
  private isClosed(): boolean {
    return this.closed;
  }

  private async finish(reading: Reading<F>): Promise<void> {
    this.release(reading.shown);
    this.release(reading.ahead);
    reading.shown = null;
    reading.ahead = null;
    await reading.frames.close();
  }

  private release(frame: F | null): void {
    if (!frame) return;
    frame.close();
    this.deps.closed();
  }
}
