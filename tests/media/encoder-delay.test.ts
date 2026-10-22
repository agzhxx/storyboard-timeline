import { describe, expect, test } from "vitest";
import { firstLoud } from "../../src/media/encoder-delay.ts";

describe("firstLoud", () => {
  test("counts across the decoded chunks to the first sample over the threshold", () => {
    const chunks = [new Float32Array(1024), new Float32Array(1024), new Float32Array(1024)];
    chunks[2]?.set([0.05, -0.9], 64);
    expect(firstLoud(chunks)).toBe(2 * 1024 + 65);
  });

  test("a quiet sound, or none at all, has no click", () => {
    expect(firstLoud([new Float32Array(960).fill(0.1)])).toBeNull();
    expect(firstLoud([])).toBeNull();
  });
});
