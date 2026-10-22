import { describe, expect, test } from "vitest";
import type { MusicRun } from "../../src/engine/schedule.ts";
import { Music, type MusicContext } from "../../src/media/music.ts";

/** An AudioContext that writes down each node it makes and what's done to it. */
function fakeContext() {
  const log: string[] = [];
  const context = {
    destination: {} as AudioNode,
    createBufferSource() {
      const node = {
        buffer: null as { name: string } | null,
        playbackRate: { value: 1 },
        connect: () => undefined,
        disconnect: () => log.push(`disconnect ${node.buffer?.name ?? "?"}`),
        start: (when: number, offset: number, duration: number) =>
          log.push(
            `start ${node.buffer?.name ?? "?"} at ${when} from ${offset} for ${duration} at ${node.playbackRate.value}×`,
          ),
        stop: () => log.push(`stop ${node.buffer?.name ?? "?"}`),
      };
      return node as unknown as AudioBufferSourceNode;
    },
  } satisfies MusicContext;
  return { context, log };
}

const buffer = (name: string) => ({ name }) as unknown as AudioBuffer;

const runs: MusicRun[] = [
  { clipId: "m", assetId: "music", delaySec: 0, offsetSec: 6, durationSec: 6 },
  { clipId: "n", assetId: "tone", delaySec: 7.5, offsetSec: 0, durationSec: 1 },
];

describe("Music", () => {
  test("a clip under the playhead starts with the playback; a later one when the playhead gets there", () => {
    const { context, log } = fakeContext();
    const buffers = new Map([
      ["music", buffer("music")],
      ["tone", buffer("tone")],
    ]);
    new Music(context).start(runs, buffers, 100, 1);
    expect(log).toEqual([
      "start music at 100 from 6 for 6 at 1×",
      "start tone at 107.5 from 0 for 1 at 1×",
    ]);
  });

  test("at 2× the nodes play twice as fast and later clips come twice as soon", () => {
    const { context, log } = fakeContext();
    const buffers = new Map([
      ["music", buffer("music")],
      ["tone", buffer("tone")],
    ]);
    new Music(context).start(runs, buffers, 100, 2);
    expect(log).toEqual([
      "start music at 100 from 6 for 6 at 2×",
      "start tone at 103.75 from 0 for 1 at 2×",
    ]);
  });

  test("music that didn't decode is left out; stop silences every node", () => {
    const { context, log } = fakeContext();
    const music = new Music(context);
    music.start(runs, new Map([["tone", buffer("tone")]]), 100, 1);
    music.stop();
    music.stop();
    expect(log).toEqual(["start tone at 107.5 from 0 for 1 at 1×", "stop tone", "disconnect tone"]);
  });
});
