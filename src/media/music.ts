// A1's music during playback (spec section 4.6): one AudioBufferSourceNode per clip on the shared
// AudioContext, scheduled from the plan (src/engine/schedule.ts). A clip under the playhead starts
// with the playback, from where the playhead is in it; a later one starts when the playhead will
// reach it. At 2× the nodes play twice as fast, and the clock counts twice as fast, so the picture
// still follows the sound. Stopping stops and disconnects every node.

import type { MusicRun } from "../engine/schedule.ts";
import type { Rate } from "./playback-state.ts";

/** What the player uses of an AudioContext; the tests pass a fake one. */
export interface MusicContext {
  readonly destination: AudioNode;
  createBufferSource(): AudioBufferSourceNode;
}

export class Music {
  private readonly context: MusicContext;
  private nodes: AudioBufferSourceNode[] = [];

  constructor(context: MusicContext) {
    this.context = context;
  }

  /**
   * Schedules each run whose music is decoded: the sound for the playback's start position at
   * context time `at`, and each later clip `delaySec / rate` after it.
   */
  start(
    runs: readonly MusicRun[],
    buffers: ReadonlyMap<string, AudioBuffer>,
    at: number,
    rate: Rate,
  ): void {
    for (const run of runs) {
      const buffer = buffers.get(run.assetId);
      if (!buffer) continue;
      const node = this.context.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = rate;
      node.connect(this.context.destination);
      node.start(at + run.delaySec / rate, run.offsetSec, run.durationSec);
      this.nodes.push(node);
    }
  }

  /** Silence: every node stops, scheduled or playing. */
  stop(): void {
    for (const node of this.nodes) {
      node.stop();
      node.disconnect();
    }
    this.nodes = [];
  }
}
