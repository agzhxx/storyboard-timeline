// The export's sound (spec section 4.7): A1's music clips mixed into one 48 kHz stereo track,
// exactly as long as the cut, each from its in point for its length, as playback schedules them
// (`musicPlan`). Web Audio isn't in workers, so the main thread renders the mix with an
// OfflineAudioContext, faster than real time and without playing it, then hands the raw samples
// to the export worker, which encodes them as AAC or Opus. A cut without music has no audio track.

import { findAsset, projectDuration } from "../engine/project.ts";
import { type MusicRun, musicPlan } from "../engine/schedule.ts";
import type { Asset, Project } from "../engine/types.ts";
import { musicFailure, musicOf } from "./audio.ts";
import { MIX_CHANNELS, MIX_SAMPLE_RATE } from "./export-format.ts";

export interface MixPlan {
  /** The mix's length in samples, the cut's exactly: 2,000 a frame at 24 fps. */
  length: number;
  /** When each music clip starts in the cut, from where in its file, and for how long. */
  runs: MusicRun[];
}

/** What the mix plays; null when A1 has no clips, so the file gets no audio track. */
export function mixPlan(project: Project): MixPlan | null {
  const runs = musicPlan(project, 0);
  if (runs.length === 0) return null;
  return { length: projectDuration(project) * (MIX_SAMPLE_RATE / project.fps), runs };
}

/** The mixed sound: one array of samples per channel, which can be transferred to the worker. */
export interface MixedAudio {
  sampleRate: number;
  channels: Float32Array<ArrayBuffer>[];
}

/** What the mix uses of an OfflineAudioContext; the tests pass a fake one. */
export interface OfflineContext {
  readonly destination: AudioNode;
  createBufferSource(): AudioBufferSourceNode;
  startRendering(): Promise<AudioBuffer>;
}

export interface MixDeps {
  /** An asset's decoded music (src/media/audio.ts); null when it can't be read or decoded. */
  music: (asset: Asset) => Promise<AudioBuffer | null>;
  /** Why it came back null: its file didn't come, or didn't decode. */
  failure: (asset: Asset) => "unreadable" | "undecodable" | null;
  /** A context that renders `length` samples of 48 kHz stereo. */
  context: (length: number) => OfflineContext;
}

/** A music file that couldn't be read or decoded: the export can't have its sound. */
export class MusicError extends Error {
  readonly asset: Asset;
  /** Its file didn't come (gone, offline), or didn't decode. */
  readonly reason: "unreadable" | "undecodable";

  constructor(asset: Asset, reason: "unreadable" | "undecodable") {
    super(`${asset.name} couldn't be ${reason === "unreadable" ? "read" : "decoded"}`);
    this.asset = asset;
    this.reason = reason;
  }
}

/**
 * Mixes A1 for the export: null for a cut without music. Each file is decoded once, however many
 * clips use it; one that can't be read or decoded throws `MusicError`.
 */
export async function mixMusic(project: Project, deps: MixDeps): Promise<MixedAudio | null> {
  const plan = mixPlan(project);
  if (!plan) return null;
  const buffers = new Map<string, AudioBuffer>();
  for (const assetId of new Set(plan.runs.map((run) => run.assetId))) {
    const asset = findAsset(project, assetId);
    if (!asset) continue;
    const buffer = await deps.music(asset);
    if (!buffer) throw new MusicError(asset, deps.failure(asset) ?? "unreadable");
    buffers.set(assetId, buffer);
  }
  const context = deps.context(plan.length);
  for (const run of plan.runs) {
    const buffer = buffers.get(run.assetId);
    if (!buffer) continue;
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    node.start(run.delaySec, run.offsetSec, run.durationSec);
  }
  const rendered = await context.startRendering();
  const channels = Array.from({ length: MIX_CHANNELS }, (_, channel) => {
    const samples = new Float32Array(plan.length);
    rendered.copyFromChannel(samples, Math.min(channel, rendered.numberOfChannels - 1));
    return samples;
  });
  return { sampleRate: MIX_SAMPLE_RATE, channels };
}

/** Mixes A1 for an export from the editor's decoded music (src/media/audio.ts). */
export function mixForExport(project: Project): Promise<MixedAudio | null> {
  return mixMusic(project, {
    music: musicOf,
    failure: (asset) => musicFailure(asset.id),
    context: offlineContext,
  });
}

/** The browser's OfflineAudioContext, 48 kHz stereo. */
function offlineContext(length: number): OfflineContext {
  return new OfflineAudioContext({
    numberOfChannels: MIX_CHANNELS,
    length,
    sampleRate: MIX_SAMPLE_RATE,
  });
}
