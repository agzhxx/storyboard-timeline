import { describe, expect, test } from "vitest";
import { compareOutput } from "../../src/media/export-check.ts";

const decoded = { firstFrame: true, lastFrame: true };

describe("compareOutput", () => {
  test("both frames decode and the length is the cut's: it passes", () => {
    expect(compareOutput({ ...decoded, durationSec: 45 }, 1_080, 24)).toEqual({
      ...decoded,
      durationSec: 45,
      lengthMatches: true,
      ok: true,
    });
  });

  test("within one frame either way still matches", () => {
    expect(compareOutput({ ...decoded, durationSec: 45 + 1 / 24 }, 1_080, 24).ok).toBe(true);
    expect(compareOutput({ ...decoded, durationSec: 45 - 1 / 24 }, 1_080, 24).ok).toBe(true);
    expect(compareOutput({ ...decoded, durationSec: 3.0213 }, 72, 24).ok).toBe(true);
  });

  test("more than a frame off fails", () => {
    const check = compareOutput({ ...decoded, durationSec: 45 + 1.1 / 24 }, 1_080, 24);
    expect(check).toMatchObject({ lengthMatches: false, ok: false });
    expect(compareOutput({ ...decoded, durationSec: 44.9 }, 1_080, 30).ok).toBe(false);
  });

  test("a length that couldn't be read fails", () => {
    expect(compareOutput({ ...decoded, durationSec: null }, 72, 24)).toMatchObject({
      lengthMatches: false,
      ok: false,
    });
  });

  test("a first or last frame that doesn't decode fails, whatever the length", () => {
    expect(compareOutput({ ...decoded, firstFrame: false, durationSec: 3 }, 72, 24).ok).toBe(false);
    expect(compareOutput({ ...decoded, lastFrame: false, durationSec: 3 }, 72, 24).ok).toBe(false);
  });
});
