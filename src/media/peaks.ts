// Waveform peaks. An audio file's samples are boiled down to buckets of
// about a millisecond each (1,000 a second), keeping each bucket's lowest and highest sample in one
// byte apiece: a minute of audio is 120 KB, whatever its sample rate or channels. That's the base
// level, computed once in the import worker and cached in OPFS as peaks.bin.
//
// Zoomed out, one 3 px bar of the waveform covers many buckets. Coarser levels are made from the
// base only when a zoom needs them: each one halves the bucket count, a bucket being the lowest of
// two lows and the highest of two highs. A bar's peak then takes at most two buckets per level, so
// any range is exact and costs about log2 of its length in buckets.

/** About this many buckets a second: a bucket is the nearest whole number of samples. */
const BUCKETS_PER_SECOND = 1000;

/** peaks.bin's header: the sample rate and the samples per bucket, as little-endian uint32s. */
const HEADER_BYTES = 8;

export interface Peaks {
  /** The audio's sample rate, in hertz. */
  sampleRate: number;
  /** How many samples each bucket covers: a bucket lasts samplesPerBucket / sampleRate seconds. */
  samplesPerBucket: number;
  /**
   * Each bucket's lowest and highest sample over every channel, interleaved (low, high, low,
   * high…), from −127 to 127 for −1 to 1.
   */
  data: Int8Array<ArrayBuffer>;
}

/** A sample as one signed byte: −1 to 1 becomes −127 to 127, louder clips, and NaN is silence. */
export function quantize(sample: number): number {
  if (Number.isNaN(sample)) return 0;
  return Math.max(-127, Math.min(127, Math.round(sample * 127)));
}

/**
 * The base level of an audio file's peaks, from its decoded channels (all of one length): the
 * lowest and highest sample of every channel per bucket of about a millisecond.
 */
export function computePeaks(channels: readonly Float32Array[], sampleRate: number): Peaks {
  const samplesPerBucket = Math.max(1, Math.round(sampleRate / BUCKETS_PER_SECOND));
  const length = channels[0]?.length ?? 0;
  const buckets = Math.ceil(length / samplesPerBucket);
  const low = new Float32Array(buckets).fill(Infinity);
  const high = new Float32Array(buckets).fill(-Infinity);
  for (const samples of channels) {
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const end = Math.min(length, (bucket + 1) * samplesPerBucket);
      let lo = low[bucket] ?? Infinity;
      let hi = high[bucket] ?? -Infinity;
      for (let index = bucket * samplesPerBucket; index < end; index += 1) {
        const sample = samples[index] ?? 0;
        if (sample < lo) lo = sample;
        if (sample > hi) hi = sample;
      }
      low[bucket] = lo;
      high[bucket] = hi;
    }
  }
  const data = new Int8Array(buckets * 2);
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    data[bucket * 2] = quantize(low[bucket] ?? 0);
    data[bucket * 2 + 1] = quantize(high[bucket] ?? 0);
  }
  return { sampleRate, samplesPerBucket, data };
}

/** peaks.bin: the 8-byte header, then the data. */
export function encodePeaks({
  sampleRate,
  samplesPerBucket,
  data,
}: Peaks): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(HEADER_BYTES + data.length);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, sampleRate, true);
  header.setUint32(4, samplesPerBucket, true);
  bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.length), HEADER_BYTES);
  return bytes;
}

/** Reads peaks.bin back; null when it isn't one (too short, a zero rate, an odd length). */
export function decodePeaks(buffer: ArrayBuffer): Peaks | null {
  if (buffer.byteLength < HEADER_BYTES || (buffer.byteLength - HEADER_BYTES) % 2 !== 0) return null;
  const header = new DataView(buffer);
  const sampleRate = header.getUint32(0, true);
  const samplesPerBucket = header.getUint32(4, true);
  if (sampleRate === 0 || samplesPerBucket === 0) return null;
  return { sampleRate, samplesPerBucket, data: new Int8Array(buffer, HEADER_BYTES) };
}

/** An audio file's peaks with the coarser levels made from them so far, for drawing. */
export interface PeakLevels {
  peaks: Peaks;
  /** Level k's buckets each cover 2^k base buckets; level 0 is the base. Grows on demand. */
  levels: Int8Array[];
}

export function peakLevels(peaks: Peaks): PeakLevels {
  return { peaks, levels: [peaks.data] };
}

/** Level k, making it and any level under it that's missing. */
function level({ levels }: PeakLevels, k: number): Int8Array {
  for (let next = levels.length; next <= k; next += 1) {
    const finer = levels[next - 1] ?? new Int8Array(0);
    const finerCount = finer.length / 2;
    const count = Math.ceil(finerCount / 2);
    const coarser = new Int8Array(count * 2);
    for (let bucket = 0; bucket < count; bucket += 1) {
      const a = bucket * 2;
      const b = Math.min(a + 1, finerCount - 1);
      coarser[bucket * 2] = Math.min(finer[a * 2] ?? 0, finer[b * 2] ?? 0);
      coarser[bucket * 2 + 1] = Math.max(finer[a * 2 + 1] ?? 0, finer[b * 2 + 1] ?? 0);
    }
    levels.push(coarser);
  }
  return levels[k] ?? new Int8Array(0);
}

/**
 * The lowest and highest sample from `start` to `end` seconds, from −1 to 1; null when the range
 * holds no bucket (it's empty or past the end). Every bucket the range touches counts, so a bar
 * narrower than a bucket still shows the bucket under it.
 */
export function peakBetween(
  levels: PeakLevels,
  start: number,
  end: number,
): { low: number; high: number } | null {
  const { sampleRate, samplesPerBucket, data } = levels.peaks;
  const bucketsPerSecond = sampleRate / samplesPerBucket;
  const count = data.length / 2;
  // Bottom-up over the levels: [from, to) shrinks by half per level, taking its odd ends. A
  // millionth of a bucket of float error doesn't reach into the next one.
  let from = Math.max(0, Math.floor(start * bucketsPerSecond + 1e-6));
  let to = Math.min(count, Math.ceil(end * bucketsPerSecond - 1e-6));
  if (from >= to) return null;
  let low = 127;
  let high = -127;
  for (let k = 0; from < to; k += 1) {
    const buckets = level(levels, k);
    if (from % 2 === 1) {
      low = Math.min(low, buckets[from * 2] ?? 0);
      high = Math.max(high, buckets[from * 2 + 1] ?? 0);
      from += 1;
    }
    if (to % 2 === 1) {
      to -= 1;
      low = Math.min(low, buckets[to * 2] ?? 0);
      high = Math.max(high, buckets[to * 2 + 1] ?? 0);
    }
    from /= 2;
    to /= 2;
  }
  return { low: low / 127, high: high / 127 };
}
