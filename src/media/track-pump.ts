// One video track's playback in the decode worker (spec sections 4.5 and 4.6). It decodes the
// track's clips in timeline order and sends each frame to the main thread, never more than
// `capacity` frames ahead of what the main thread has handed back: while the queue is full it
// waits for an ack (backpressure), so a fast decoder can't fill the memory with frames. About a
// second before a cut it starts decoding the next clip, which seeks to a key frame and decodes up
// to the clip's in point, so its first frame is ready when the cut comes (look-ahead). Every
// sample it's handed is closed, sent or not, and stopping closes what the decoders hold.
//
// A clip fails where its frames stop coming: the decoder threw, or, as a browser's decoder does
// with a file cut short or damaged, it went quiet and the frames end early or skip ahead.

import { placeOnTimeline, type VideoRun } from "../engine/schedule.ts";
import { SOURCE_TOLERANCE_US } from "../engine/time.ts";

/** A decoded source frame: Mediabunny's VideoSample, or a fake in the tests. */
export interface Sample {
  /** In seconds, in the source. */
  readonly timestamp: number;
  readonly duration: number;
  close(): void;
}

/** A clip's frames in order, decoding from when it's opened: Mediabunny's sample iterator. */
export interface Reader<S extends Sample> {
  /** The next frame; null when the clip's frames are done. */
  next(): Promise<S | null>;
  /** Stops decoding and closes the frames decoded ahead. Closing twice does nothing. */
  close(): Promise<void>;
}

/** Where a frame shows on the timeline. */
export interface Placed {
  clipId: string;
  presentUs: number;
  endUs: number;
}

export interface PumpDeps<S extends Sample> {
  /** Starts decoding a run's frames. */
  open: (run: VideoRun) => Reader<S>;
  /** Sends a sample's picture to the main thread, as a frame of its own: the pump closes the sample. */
  send: (sample: S, placed: Placed) => void;
  /**
   * A run's frames stopped coming: `atUs` is where the first missing one shows, and `error` what
   * was thrown, if anything (frames that end early or skip ahead throw nothing).
   */
  fail: (run: VideoRun, atUs: number, error?: unknown) => void;
  /** Counts the samples the worker holds, for the open-frame counter. */
  opened: () => void;
  closed: () => void;
}

/** How long before a cut the next clip starts decoding. */
export const LOOKAHEAD_US = 1_000_000;

export class TrackPump<S extends Sample> {
  private readonly runs: readonly VideoRun[];
  private readonly capacity: number;
  private readonly deps: PumpDeps<S>;
  /** Frames sent that the main thread hasn't handed back yet. */
  private outstanding = 0;
  private wake: (() => void) | null = null;
  private stopped = false;
  /** The readers decoding, by run index: the current clip's, and the next one's ahead of a cut. */
  private readonly readers = new Map<number, Reader<S>>();

  constructor(runs: readonly VideoRun[], capacity: number, deps: PumpDeps<S>) {
    this.runs = runs;
    this.capacity = capacity;
    this.deps = deps;
  }

  /** The main thread closed `count` of the frames sent. */
  ack(count: number): void {
    this.outstanding = Math.max(0, this.outstanding - count);
    this.resume();
  }

  /** Stops decoding: the readers close, with the frames they decoded ahead. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.resume();
    const readers = [...this.readers.values()];
    this.readers.clear();
    await Promise.all(readers.map((reader) => reader.close()));
  }

  /** Decodes and sends the track's frames until its last clip ends, it's stopped, or one fails. */
  async run(): Promise<void> {
    for (let index = 0; index < this.runs.length && !this.stopped; index += 1) {
      const run = this.runs[index];
      if (!run) break;
      const reader = this.readerFor(index);
      /** Where the frames sent so far end; null before the first. */
      let reached: number | null = null;
      try {
        for (;;) {
          const sample = await reader.next();
          if (sample === null) {
            // Frames that end before the clip does didn't decode.
            if (!this.isStopped() && (reached ?? run.startUs) < run.endUs - SOURCE_TOLERANCE_US) {
              this.failAt(run, reached);
            }
            break;
          }
          this.deps.opened();
          const placed = placeOnTimeline(run, sample);
          if (reached !== null && placed.presentUs > reached + SOURCE_TOLERANCE_US) {
            // Frames skipped: the ones between didn't decode.
            this.close(sample);
            this.failAt(run, reached);
            break;
          }
          if (!this.isStopped()) this.lookAhead(index, placed.presentUs);
          await this.credit();
          if (this.isStopped()) {
            this.close(sample);
            break;
          }
          try {
            this.deps.send(sample, { clipId: run.clipId, ...placed });
          } finally {
            this.close(sample);
          }
          this.outstanding += 1;
          reached = placed.endUs;
        }
      } catch (error) {
        if (!this.isStopped()) this.failAt(run, reached, error);
      } finally {
        this.readers.delete(index);
        await reader.close();
      }
    }
    await this.stop();
  }

  /**
   * A run's frames stopped coming after `reached` (at its start when none was sent): the track
   * stops. `error` is what was thrown, when something was: the decoder, or reading the media.
   */
  private failAt(run: VideoRun, reached: number | null, error?: unknown): void {
    this.deps.fail(run, reached ?? run.startUs, error);
    this.stopped = true;
  }

  /** Read through a call: `stop()` can set it while the pump awaits a frame. */
  private isStopped(): boolean {
    return this.stopped;
  }

  private readerFor(index: number): Reader<S> {
    let reader = this.readers.get(index);
    const run = this.runs[index];
    if (!reader && run) {
      reader = this.deps.open(run);
      this.readers.set(index, reader);
    }
    if (!reader) throw new Error(`No run ${index}`);
    return reader;
  }

  /** Opens the next clip's reader once this clip's frames reach a second before it starts. */
  private lookAhead(index: number, presentUs: number): void {
    const next = this.runs[index + 1];
    if (next && !this.readers.has(index + 1) && presentUs >= next.startUs - LOOKAHEAD_US) {
      this.readerFor(index + 1);
    }
  }

  /** Waits while the main thread holds `capacity` frames. */
  private async credit(): Promise<void> {
    while (this.outstanding >= this.capacity && !this.stopped) {
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  private resume(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private close(sample: S): void {
    sample.close();
    this.deps.closed();
  }
}
