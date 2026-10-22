import { describe, expect, test } from "vitest";
import { peakLevels } from "../../src/media/peaks.ts";
import {
  type Context2D,
  drawContained,
  drawFilmstrip,
  drawFitted,
  drawWaveform,
  type TurningContext2D,
  WAVEFORM_COLORS,
} from "../../src/timeline/draw.ts";
import { waveformBars } from "../../src/timeline/tiles.ts";

/** A 2D context that writes down what's drawn. */
function recorder() {
  const calls: string[] = [];
  const context: Context2D = {
    fillStyle: "",
    clearRect: (x, y, width, height) => calls.push(`clear ${x} ${y} ${width} ${height}`),
    fillRect: (x, y, width, height) => calls.push(`fill ${x} ${y} ${width} ${height}`),
    drawImage: (image, x, y, width, height) => {
      calls.push(`image ${(image as { id: string }).id} ${x} ${y} ${width} ${height}`);
    },
  };
  return { context, calls };
}

/** Stands in for an ImageBitmap: drawImage only needs to tell them apart. */
function picture(id: string, width = 160, height = 90) {
  return { id, width, height } as unknown as ImageBitmap & { id: string };
}

describe("drawFilmstrip", () => {
  test("draws each slot's thumbnail where the slot is in the tile, as wide as the slot", () => {
    const { context, calls } = recorder();
    drawFilmstrip(context, {
      from: 100,
      width: 200,
      height: 78,
      slots: [
        { x: 0, index: 0 },
        { x: 139, index: 2 },
      ],
      slotWidth: 139,
      thumbnails: [picture("t0"), picture("t1"), picture("t2")],
    });
    expect(calls).toEqual(["clear 0 0 200 78", "image t0 -100 0 139 78", "image t2 39 0 139 78"]);
  });

  test("leaves a slot empty until its thumbnail is made", () => {
    const { context, calls } = recorder();
    drawFilmstrip(context, {
      from: 0,
      width: 300,
      height: 78,
      slots: [
        { x: 0, index: 0 },
        { x: 139, index: 2 },
      ],
      slotWidth: 139,
      thumbnails: [picture("t0")],
    });
    expect(calls).toEqual(["clear 0 0 300 78", "image t0 0 0 139 78"]);
  });
});

describe("drawWaveform", () => {
  // 1,000 buckets a second: a loud bucket, a quiet one, then silence.
  const peaks = peakLevels({
    sampleRate: 1_000,
    samplesPerBucket: 1,
    data: Int8Array.from([-127, 127, -10, 20, 0, 0]),
  });

  test("draws each bar from its lowest to its highest sample, 4.5 px from the edges at most", () => {
    const { context, calls } = recorder();
    // One bar per bucket: 3 px is a millisecond.
    const bars = waveformBars(0, 9, 0.001 / 3);
    drawWaveform(context, {
      from: 0,
      width: 9,
      height: 63,
      bars,
      peaks,
      color: WAVEFORM_COLORS.normal,
    });

    const scale = 63 / 2 - 4.5;
    expect(context.fillStyle).toBe("#8b8b94");
    expect(calls[0]).toBe("clear 0 0 9 63");
    expect(calls[1]).toBe(`fill 0 4.5 2 ${2 * scale}`);
    const [, , top, width, height] = (calls[2] ?? "").split(" ").map(Number);
    expect(top).toBeCloseTo(31.5 - (20 / 127) * scale, 9);
    expect(width).toBe(2);
    expect(height).toBeCloseTo((30 / 127) * scale, 9);
    // Silence is still a 3 px line.
    expect(calls[3]).toBe("fill 6 30 2 3");
  });

  test("skips bars past the end of the audio", () => {
    const { context, calls } = recorder();
    const bars = waveformBars(0, 30, 0.001 / 3);
    drawWaveform(context, { from: 0, width: 30, height: 63, bars, peaks, color: "red" });
    expect(calls.filter((call) => call.startsWith("fill"))).toHaveLength(3);
  });
});

test("drawContained fits a picture inside the box, centered, its shape kept", () => {
  const { context, calls } = recorder();
  drawContained(context, picture("frame", 160, 90), 400, 400);
  expect(calls).toEqual(["clear 0 0 400 400", "image frame 0 87.5 400 225"]);
});

/** A context that also writes down how it's turned. */
function turningRecorder() {
  const { context, calls } = recorder();
  const turning: TurningContext2D = {
    ...context,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    translate: (x, y) => calls.push(`translate ${x} ${y}`),
    rotate: (angle) => calls.push(`rotate ${Math.round((angle * 180) / Math.PI)}`),
    scale: (x, y) => calls.push(`scale ${x} ${y}`),
  };
  return { context: turning, calls };
}

describe("drawFitted", () => {
  test("fits a frame inside the box over what's there, without clearing it", () => {
    const { context, calls } = turningRecorder();
    drawFitted(
      context,
      picture("v2", 1440, 1080),
      { width: 1440, height: 1080 },
      { width: 640, height: 360 },
    );
    expect(calls).toEqual(["image v2 80 0 480 360"]);
  });

  test("a phone's portrait video, stored sideways and turned 90°, stands upright and fits by its height", () => {
    const { context, calls } = turningRecorder();
    const frame = picture("phone", 1920, 1080);
    drawFitted(context, frame, frame, { width: 640, height: 360 }, { rotation: 90, flip: false });
    // Shown 1080 wide and 1920 tall, scaled to 360 tall: drawn 360 × 202.5 before turning.
    expect(calls).toEqual([
      "save",
      "translate 320 180",
      "rotate 90",
      "image phone -180 -101.25 360 202.5",
      "restore",
    ]);
  });

  test("a flipped frame is turned first, then flipped, as Mediabunny does", () => {
    const { context, calls } = turningRecorder();
    const frame = picture("selfie", 640, 360);
    drawFitted(context, frame, frame, { width: 640, height: 360 }, { rotation: 180, flip: true });
    expect(calls).toEqual([
      "save",
      "translate 320 180",
      "scale -1 1",
      "rotate 180",
      "image selfie -320 -180 640 360",
      "restore",
    ]);
  });
});
