import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  computePeaks,
  decodePeaks,
  encodePeaks,
  peakBetween,
  peakLevels,
  type Peaks,
  quantize,
} from "../../src/media/peaks.ts";

/** Peaks at 1,000 buckets a second (one sample per bucket at 1 kHz) with the given lows and highs. */
function peaksOf(pairs: [low: number, high: number][]): Peaks {
  return { sampleRate: 1000, samplesPerBucket: 1, data: Int8Array.from(pairs.flat()) };
}

describe("computePeaks", () => {
  test("keeps each bucket's lowest and highest sample, about 1,000 buckets a second", () => {
    // 48 kHz: 48 samples a bucket. Bucket 0 rises to 0.5, bucket 1 dips to −1.
    const samples = new Float32Array(96);
    samples[10] = 0.5;
    samples[11] = -0.25;
    samples[60] = -1;
    const peaks = computePeaks([samples], 48_000);

    expect(peaks.samplesPerBucket).toBe(48);
    expect([...peaks.data]).toEqual([quantize(-0.25), quantize(0.5), -127, 0]);
  });

  test("covers every channel, and a last bucket that's only partly full", () => {
    const left = Float32Array.from([0.1, 0.2, 0.3]);
    const right = Float32Array.from([-0.5, 0, 0.9]);
    const peaks = computePeaks([left, right], 2_000);

    // 2 kHz: 2 samples a bucket, so the third sample is a bucket of its own.
    expect(peaks.samplesPerBucket).toBe(2);
    expect([...peaks.data]).toEqual([quantize(-0.5), quantize(0.2), quantize(0.3), quantize(0.9)]);
  });

  test("rounds the bucket to whole samples: 44.1 kHz makes 44", () => {
    expect(computePeaks([new Float32Array(441)], 44_100).samplesPerBucket).toBe(44);
    expect(computePeaks([new Float32Array(441)], 44_100).data).toHaveLength(2 * 11);
  });

  test("has nothing for silence that lasts no time", () => {
    expect(computePeaks([new Float32Array(0)], 48_000).data).toHaveLength(0);
    expect(computePeaks([], 48_000).data).toHaveLength(0);
  });
});

test("quantize keeps one signed byte: louder clips, NaN is silence", () => {
  expect(quantize(1)).toBe(127);
  expect(quantize(-1)).toBe(-127);
  expect(quantize(3)).toBe(127);
  expect(quantize(-3)).toBe(-127);
  expect(quantize(0.5)).toBe(64);
  expect(quantize(Number.NaN)).toBe(0);
});

describe("peaks.bin", () => {
  test("reads back what it wrote", () => {
    const peaks = computePeaks([Float32Array.from({ length: 500 }, (_, i) => Math.sin(i))], 44_100);
    const bytes = encodePeaks(peaks);

    expect(bytes.byteLength).toBe(8 + peaks.data.length);
    expect(decodePeaks(bytes.buffer)).toEqual(peaks);
  });

  test("refuses what isn't one", () => {
    expect(decodePeaks(new ArrayBuffer(4))).toBeNull();
    expect(decodePeaks(new ArrayBuffer(9))).toBeNull();
    // A header with a zero sample rate.
    expect(decodePeaks(new ArrayBuffer(10))).toBeNull();
  });
});

describe("peakBetween", () => {
  const levels = () =>
    peakLevels(
      peaksOf([
        [-10, 20],
        [-50, 5],
        [0, 90],
        [-3, 3],
        [-120, 1],
      ]),
    );

  test("is the lowest low and the highest high over the buckets a range touches", () => {
    expect(peakBetween(levels(), 0, 0.002)).toEqual({ low: -50 / 127, high: 20 / 127 });
    expect(peakBetween(levels(), 0.001, 0.004)).toEqual({ low: -50 / 127, high: 90 / 127 });
    expect(peakBetween(levels(), 0, 1)).toEqual({ low: -120 / 127, high: 90 / 127 });
  });

  test("counts a bucket a range only partly covers", () => {
    expect(peakBetween(levels(), 0.0025, 0.0026)).toEqual({ low: 0, high: 90 / 127 });
  });

  test("has nothing where there are no buckets", () => {
    expect(peakBetween(levels(), 0.005, 0.01)).toBeNull();
    expect(peakBetween(levels(), 0.002, 0.002)).toBeNull();
  });

  test("makes coarser levels only when a range needs them", () => {
    const wide = peakLevels(peaksOf(Array.from({ length: 64 }, (): [number, number] => [0, 0])));

    peakBetween(wide, 0.002, 0.004);
    expect(wide.levels).toHaveLength(2);
    peakBetween(wide, 0, 0.064);
    expect(wide.levels.map((level) => level.length / 2)).toEqual([64, 32, 16, 8, 4, 2, 1]);
  });

  test("agrees with a scan of every bucket, for any range of any peaks", () => {
    const pair = fc
      .tuple(fc.integer({ min: -127, max: 127 }), fc.integer({ min: -127, max: 127 }))
      .map(([a, b]): [number, number] => [Math.min(a, b), Math.max(a, b)]);
    fc.assert(
      fc.property(
        fc.array(pair, { minLength: 1, maxLength: 300 }),
        fc.nat(),
        fc.nat(),
        (pairs, a, b) => {
          const from = a % (pairs.length + 1);
          const to = from + (b % (pairs.length + 1 - from));
          const result = peakBetween(peakLevels(peaksOf(pairs)), from / 1000, to / 1000);
          const touched = pairs.slice(from, to);
          if (touched.length === 0) return result === null;
          const low = Math.min(...touched.map(([lo]) => lo)) / 127;
          const high = Math.max(...touched.map(([, hi]) => hi)) / 127;
          return result?.low === low && result.high === high;
        },
      ),
      { numRuns: 500 },
    );
  });
});
