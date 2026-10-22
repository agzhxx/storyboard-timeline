import { describe, expect, test } from "vitest";
import { createProject } from "../../src/engine/project.ts";
import type { Fps, Project } from "../../src/engine/types.ts";
import {
  type MixDeps,
  mixMusic,
  mixPlan,
  MusicError,
  type OfflineContext,
} from "../../src/media/export-mix.ts";
import { audioAsset, clip, videoAsset, withClips } from "../engine/fixtures.ts";

/**
 * At `fps`:
 *   V1  v: 0–239
 *   A1  m: 24–263 (from 2 s into its file) · n: 300–323 (the same file, from its start)
 */
function cut(fps: Fps = 24): Project {
  const project = createProject({
    id: "mix",
    fps,
    assets: [videoAsset("v", 20), audioAsset("music", 60), audioAsset("tone", 5)],
  });
  return withClips(project, {
    V1: [clip("v", "v", { start: 0, duration: 240 })],
    A1: [
      clip("m", "music", { start: 24, in: 48, duration: 240 }),
      clip("n", "music", { start: 300, duration: 24 }),
    ],
  });
}

describe("mixPlan", () => {
  test("each music clip starts where it is in the cut, from its in point, for its length", () => {
    expect(mixPlan(cut())?.runs).toEqual([
      { clipId: "m", assetId: "music", delaySec: 1, offsetSec: 2, durationSec: 10 },
      { clipId: "n", assetId: "music", delaySec: 12.5, offsetSec: 0, durationSec: 1 },
    ]);
  });

  test("the mix is exactly as long as the cut: a whole number of samples per frame", () => {
    // The cut ends with n, at frame 324.
    expect(mixPlan(cut(24))?.length).toBe(324 * 2_000);
    expect(mixPlan(cut(25))?.length).toBe(324 * 1_920);
    expect(mixPlan(cut(30))?.length).toBe(324 * 1_600);
  });

  test("video that runs on after the music still sets the length", () => {
    const project = withClips(cut(), { V1: [clip("v", "v", { start: 0, duration: 480 })] });
    expect(mixPlan(project)?.length).toBe(480 * 2_000);
  });

  test("a cut without music gets no audio track", () => {
    expect(mixPlan(withClips(cut(), { A1: [] }))).toBeNull();
  });
});

/** An OfflineAudioContext that writes down what's scheduled, and renders channels of 1s and 2s. */
function fakeContext(log: string[], renderedChannels = 2) {
  return (length: number): OfflineContext => ({
    destination: {} as AudioNode,
    createBufferSource() {
      const node = {
        buffer: null as { name: string } | null,
        connect: () => log.push(`connect ${node.buffer?.name ?? "?"}`),
        start: (when: number, offset: number, duration: number) =>
          log.push(`start ${node.buffer?.name ?? "?"} at ${when} from ${offset} for ${duration}`),
      };
      return node as unknown as AudioBufferSourceNode;
    },
    startRendering: () => {
      log.push(`render ${length}`);
      return Promise.resolve({
        numberOfChannels: renderedChannels,
        copyFromChannel: (destination: Float32Array, channel: number) => {
          destination.fill(channel + 1);
        },
      } as unknown as AudioBuffer);
    },
  });
}

const decoded = (name: string) => ({ name }) as unknown as AudioBuffer;

describe("mixMusic", () => {
  test("schedules every clip on the offline context and hands back each channel's samples", async () => {
    const log: string[] = [];
    const decodes: string[] = [];
    const deps: MixDeps = {
      music: (asset) => {
        decodes.push(asset.id);
        return Promise.resolve(decoded(asset.id));
      },
      failure: () => null,
      context: fakeContext(log),
    };
    const mixed = await mixMusic(cut(), deps);
    // Both clips use one file: it's decoded once.
    expect(decodes).toEqual(["music"]);
    expect(log).toEqual([
      "connect music",
      "start music at 1 from 2 for 10",
      "connect music",
      "start music at 12.5 from 0 for 1",
      `render ${324 * 2_000}`,
    ]);
    expect(mixed?.sampleRate).toBe(48_000);
    expect(mixed?.channels.map((channel) => [channel.length, channel[0]])).toEqual([
      [648_000, 1],
      [648_000, 2],
    ]);
  });

  test("a mono render fills both channels", async () => {
    const mixed = await mixMusic(cut(), {
      music: (asset) => Promise.resolve(decoded(asset.id)),
      failure: () => null,
      context: fakeContext([], 1),
    });
    expect(mixed?.channels.map((channel) => channel[0])).toEqual([1, 1]);
  });

  test("a music file that won't read or decode stops the mix with its asset, saying which", async () => {
    for (const reason of ["unreadable", "undecodable"] as const) {
      const mixing = mixMusic(cut(), {
        music: () => Promise.resolve(null),
        failure: () => reason,
        context: fakeContext([]),
      });
      await expect(mixing).rejects.toBeInstanceOf(MusicError);
      await expect(mixing).rejects.toMatchObject({ asset: { id: "music" }, reason });
    }
  });

  test("a cut without music mixes nothing", async () => {
    const log: string[] = [];
    const deps: MixDeps = {
      music: () => Promise.resolve(null),
      failure: () => null,
      context: fakeContext(log),
    };
    expect(await mixMusic(withClips(cut(), { A1: [] }), deps)).toBeNull();
    expect(log).toEqual([]);
  });
});
