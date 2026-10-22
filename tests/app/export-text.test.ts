import { describe, expect, test } from "vitest";
import {
  aboutSize,
  checkLine,
  checkText,
  fileName,
  fileSize,
  frameOf,
  speedText,
  timeLeftText,
} from "../../src/app/export-text.ts";
import { compareOutput } from "../../src/media/export-check.ts";

describe("sizes", () => {
  test("the estimate: whole megabytes, a decimal under 10", () => {
    expect(aboutSize(37_462_500)).toBe("About 37 MB");
    expect(aboutSize(38_200_000)).toBe("About 38 MB");
    expect(aboutSize(1_185_000)).toBe("About 1.2 MB");
    expect(aboutSize(9_960_000)).toBe("About 10 MB");
  });

  test("the file made: megabytes with one decimal, a million bytes each; kilobytes under one", () => {
    expect(fileSize(38_204_311)).toBe("38.2 MB");
    expect(fileSize(1_234_567)).toBe("1.2 MB");
    expect(fileSize(999_499)).toBe("999 KB");
    expect(fileSize(999_500)).toBe("1.0 MB");
    expect(fileSize(25_273)).toBe("25 KB");
    expect(fileSize(12)).toBe("1 KB");
  });
});

describe("fileName", () => {
  test.each([
    ["The robot story", "mp4", "the-robot-story.mp4"],
    ["Untitled project", "webm", "untitled-project.webm"],
    ["  Ads: draft #2 (final!)  ", "mp4", "ads-draft-2-final.mp4"],
    ["Алматы — ночь", "mp4", "алматы-ночь.mp4"],
    ["Café", "mp4", "café.mp4"],
    ["???", "mp4", "untitled-project.mp4"],
    ["", "mp4", "untitled-project.mp4"],
  ])("%j → %s", (name, extension, expected) => {
    expect(fileName(name, extension)).toBe(expected);
  });

  test("a very long name is cut to 80 characters, without a hyphen at the end", () => {
    const name = fileName(`${"a".repeat(79)} b`, "mp4");
    expect(name).toBe(`${"a".repeat(79)}.mp4`);
  });
});

describe("progress", () => {
  test("a frame's position counts from 0, like its timecode, with thousands separated", () => {
    expect(frameOf(691, 1_080)).toBe("Frame 691 of 1,080");
    expect(frameOf(0, 72)).toBe("Frame 0 of 72");
  });

  test("the time left, in seconds under a minute, then minutes", () => {
    expect(timeLeftText(null)).toBe("Starting…");
    expect(timeLeftText(0.2)).toBe("About 1 s left");
    expect(timeLeftText(8.4)).toBe("About 8 s left");
    expect(timeLeftText(59.4)).toBe("About 59 s left");
    expect(timeLeftText(59.6)).toBe("About 1 min left");
    expect(timeLeftText(150)).toBe("About 3 min left");
  });
});

describe("speedText", () => {
  test("faster than real time", () => {
    expect(speedText(21_400, 45)).toBe("Exported in 21.4 s, 2.1× faster than real time");
  });

  test("as fast as real time, and slower", () => {
    expect(speedText(45_000, 45)).toBe("Exported in 45.0 s, as fast as real time");
    expect(speedText(52_300, 45)).toBe("Exported in 52.3 s, 0.9× real time");
  });

  test("a minute or more", () => {
    expect(speedText(92_400, 45)).toBe("Exported in 1 min 32 s, 0.5× real time");
  });
});

describe("the output check", () => {
  const decoded = { firstFrame: true, lastFrame: true };

  test("passed: the board's line", () => {
    const check = compareOutput({ ...decoded, durationSec: 45.0213 }, 1_080, 24);
    expect(checkText(check, 1_080, 24)).toBe(
      "Checked: first and last frames decode; length matches the cut",
    );
    expect(checkLine(check, 1_080, 24)).toBe("ok · 45.021 s of 45.000 s");
  });

  test("failed: what didn't hold", () => {
    const short = compareOutput({ ...decoded, durationSec: 44.5 }, 1_080, 24);
    expect(checkText(short, 1_080, 24)).toBe(
      "Check failed: it's 00:00:44:12 long, and the cut is 00:00:45:00",
    );
    expect(checkLine(short, 1_080, 24)).toBe("failed: length · 44.500 s of 45.000 s");
    const last = compareOutput({ ...decoded, lastFrame: false, durationSec: 45 }, 1_080, 24);
    expect(checkText(last, 1_080, 24)).toBe("Check failed: its last frame doesn't decode");
    const first = compareOutput({ firstFrame: false, lastFrame: false, durationSec: null }, 72, 24);
    expect(checkText(first, 72, 24)).toBe("Check failed: its first frame doesn't decode");
    expect(checkLine(first, 72, 24)).toBe(
      "failed: first frame, last frame, length · ? s of 3.000 s",
    );
  });
});
