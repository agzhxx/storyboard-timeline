// The editor's one AudioContext (spec section 4.6), made the first time it's needed: a music file's
// import, the robot story's music or the first playback. Imports decode music with it, which is how
// playback decodes it, so a file that decodes here will play, and playback plays through it, with
// its time as the clock. Decoded music is kept per asset for playback: from the import, or decoded
// the first time it's needed (after a reload, say) from the copy in storage or from its address.

import { previewLocation } from "../engine/picture.ts";
import type { Asset } from "../engine/types.ts";
import { openStorage, readPath } from "./opfs.ts";

let context: AudioContext | null = null;

/** The shared AudioContext, made on first use. Until playback resumes it, it stays suspended. */
export function audioContext(): AudioContext {
  context ??= new AudioContext();
  return context;
}

/** An audio file's decoded samples: one array per channel, at the context's sample rate. */
export interface DecodedAudio {
  /** What playback plays. */
  buffer: AudioBuffer;
  /** Copies of its channels, which can be handed to the worker that boils them down to peaks. */
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

/**
 * Decodes an audio file with decodeAudioData; null when this browser can't decode it (a file that
 * can't be read throws instead).
 */
export async function decodeAudio(file: Blob): Promise<DecodedAudio | null> {
  const buffer = await decodeBuffer(file);
  if (!buffer) return null;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => {
    const samples = new Float32Array(buffer.length);
    buffer.copyFromChannel(samples, channel);
    return samples;
  });
  return { buffer, channels, sampleRate: buffer.sampleRate };
}

async function decodeBuffer(file: Blob): Promise<AudioBuffer | null> {
  const bytes = await file.arrayBuffer();
  try {
    return await audioContext().decodeAudioData(bytes);
  } catch {
    return null;
  }
}

/** Each asset's decoded music, or the decoding under way. */
const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Keeps an imported file's decoded music for playback. */
export function keepAudio(assetId: string, buffer: AudioBuffer): void {
  buffers.set(assetId, Promise.resolve(buffer));
}

/** Why each asset's music last failed: its file didn't come (gone, offline), or didn't decode. */
const failures = new Map<string, "unreadable" | "undecodable">();

/**
 * An asset's decoded music: kept from its import, or read with `read` and decoded now, once. Null
 * when the file is gone or doesn't decode (`musicFailure` says which); it's tried again next time.
 */
export function musicFor(
  assetId: string,
  read: () => Promise<Blob | null>,
): Promise<AudioBuffer | null> {
  let decoding = buffers.get(assetId);
  if (!decoding) {
    decoding = read()
      .then(async (file) => {
        if (!file) return failed(assetId, "unreadable");
        return (await decodeBuffer(file)) ?? failed(assetId, "undecodable");
      })
      .catch(() => failed(assetId, "unreadable"));
    buffers.set(assetId, decoding);
    void decoding.then((buffer) => {
      if (!buffer) buffers.delete(assetId);
      else failures.delete(assetId);
    });
  }
  return decoding;
}

function failed(assetId: string, why: "unreadable" | "undecodable"): null {
  failures.set(assetId, why);
  return null;
}

/** Why an asset's music came back null the last time: its file didn't come, or didn't decode. */
export function musicFailure(assetId: string): "unreadable" | "undecodable" | null {
  return failures.get(assetId) ?? null;
}

/** An asset's decoded music: kept, or read from its copy in storage or its address and decoded. */
export function musicOf(asset: Asset): Promise<AudioBuffer | null> {
  return musicFor(asset.id, () => readMedia(asset));
}

/** How long music from an address may take to arrive: the demo's 720 KB, on a slow connection. */
const MUSIC_TIMEOUT_MS = 30_000;

/** An asset's media as one blob; null when it's gone or its address won't give it. */
async function readMedia(asset: Asset): Promise<Blob | null> {
  const location = previewLocation(asset);
  if (location.type === "url") {
    const response = await fetch(location.url, { signal: AbortSignal.timeout(MUSIC_TIMEOUT_MS) });
    return response.ok ? response.blob() : null;
  }
  const root = await openStorage();
  return root ? readPath(root, location.opfsPath) : null;
}

/** Lets go of an asset's decoded music. */
export function forgetAudio(assetId: string): void {
  buffers.delete(assetId);
}
