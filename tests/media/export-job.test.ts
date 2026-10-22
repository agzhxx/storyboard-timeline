import { describe, expect, test } from "vitest";
import { createProject } from "../../src/engine/project.ts";
import { SOURCE_TOLERANCE_SEC } from "../../src/engine/time.ts";
import type { Project } from "../../src/engine/types.ts";
import {
  AUDIO_LEAD_SEC,
  type EncodeDeps,
  encodeFrames,
  type FrameSource,
  StageError,
} from "../../src/media/export-job.ts";
import { audioAsset, clip, videoAsset, withClips } from "../engine/fixtures.ts";

interface Named {
  name: string;
  timestamp: number;
  duration: number;
  close(): void;
}

/**
 * At 24 fps, 8 frames long:
 *   V2  b: 2–3 (from its source frame 10)
 *   V1  a: 0–5 · gap 6–7
 *   A1  m: 0–7
 */
function cut(): Project {
  const project = createProject({
    id: "job",
    fps: 24,
    assets: [videoAsset("a"), videoAsset("b"), audioAsset("m")],
  });
  return withClips(project, {
    V2: [clip("b", "b", { start: 2, in: 10, duration: 2 })],
    V1: [clip("a", "a", { start: 0, duration: 6 })],
    A1: [clip("m", "m", { start: 0, duration: 8 })],
  });
}

/** A track whose frame at a time is named after its clip and source frame at 24 fps. */
function source(log: string[], fail?: { clipId: string; error: Error }): FrameSource<Named> {
  return {
    frameAt: (clipId, seconds) => {
      const name = `${clipId}${Math.round((seconds - SOURCE_TOLERANCE_SEC) * 24)}`;
      log.push(`read ${name}`);
      if (fail?.clipId === clipId) return Promise.reject(fail.error);
      return Promise.resolve({
        name,
        timestamp: seconds,
        duration: 1 / 24,
        close: () => undefined,
      });
    },
  };
}

function deps(log: string[], overrides: Partial<EncodeDeps<Named>> = {}): EncodeDeps<Named> {
  return {
    readers: new Map([
      ["V1", source(log)],
      ["V2", source(log)],
    ]),
    draw: (frames) => log.push(`draw [${frames.map((frame) => frame.name).join(", ")}]`),
    addAudio: (until) => {
      log.push(`audio to ${until.toFixed(3)}`);
      return Promise.resolve();
    },
    addVideo: (frame) => {
      log.push(`video ${frame}`);
      return Promise.resolve();
    },
    progress: (frame) => log.push(`progress ${frame}`),
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("encodeFrames", () => {
  test("each output frame: its layers read, the music ahead, V1 then V2 drawn, then encoded", async () => {
    const log: string[] = [];
    await encodeFrames(cut(), deps(log));
    const lead = (frame: number) => ((frame + 1) / 24 + AUDIO_LEAD_SEC).toFixed(3);
    expect(log.slice(0, 5)).toEqual([
      "read a0",
      `audio to ${lead(0)}`,
      "draw [a0]",
      "video 0",
      "progress 0",
    ]);
    expect(log.filter((line) => line.startsWith("draw"))).toEqual([
      "draw [a0]",
      "draw [a1]",
      "draw [a2, b10]",
      "draw [a3, b11]",
      "draw [a4]",
      "draw [a5]",
      // The gap after the last video clip, while the music plays on: black frames.
      "draw []",
      "draw []",
    ]);
    expect(log.filter((line) => line.startsWith("video"))).toEqual(
      Array.from({ length: 8 }, (_, frame) => `video ${frame}`),
    );
    expect(log.at(-1)).toBe("progress 7");
  });

  test("a clip with nothing to show yet (its file starts after 0) draws nothing there", async () => {
    const log: string[] = [];
    const late: FrameSource<Named> = {
      frameAt: (clipId, seconds) => {
        const frame = Math.round((seconds - SOURCE_TOLERANCE_SEC) * 24);
        return Promise.resolve(
          frame < 2
            ? null
            : {
                name: `${clipId}${frame}`,
                timestamp: seconds,
                duration: 1 / 24,
                close: () => undefined,
              },
        );
      },
    };
    await encodeFrames(
      cut(),
      deps(log, {
        readers: new Map([
          ["V1", late],
          ["V2", late],
        ]),
      }),
    );
    expect(log.filter((line) => line.startsWith("draw")).slice(0, 3)).toEqual([
      "draw []",
      "draw []",
      "draw [a2, b10]",
    ]);
  });

  test("backpressure: the next frame isn't read until the encoder takes this one", async () => {
    const log: string[] = [];
    let release: () => void = () => undefined;
    const encoding = encodeFrames(
      cut(),
      deps(log, {
        addVideo: (frame) => {
          log.push(`video ${frame}`);
          return frame === 0
            ? new Promise((resolve) => {
                release = resolve;
              })
            : Promise.resolve();
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(log.at(-1)).toBe("video 0");
    expect(log).not.toContain("read a1");
    release();
    await encoding;
    expect(log).toContain("read a1");
  });

  test("a clip whose frame can't be read stops the export at that frame, with its asset", async () => {
    const log: string[] = [];
    const broken = new Error("The decoder broke");
    const encoding = encodeFrames(
      cut(),
      deps(log, {
        readers: new Map([
          ["V1", source(log)],
          ["V2", source(log, { clipId: "b", error: broken })],
        ]),
      }),
    );
    await expect(encoding).rejects.toMatchObject({
      stage: "read",
      frame: 2,
      assetId: "b",
      cause: broken,
    });
    await expect(encoding).rejects.toBeInstanceOf(StageError);
    expect(log).not.toContain("video 2");
  });

  test("an encoder that fails stops the export at its frame", async () => {
    const encoding = encodeFrames(
      cut(),
      deps([], {
        addVideo: (frame) =>
          frame === 4 ? Promise.reject(new Error("Encoding error")) : Promise.resolve(),
      }),
    );
    await expect(encoding).rejects.toMatchObject({
      stage: "video",
      frame: 4,
      message: "Encoding error",
    });
  });

  test("the audio encoder failing stops it too", async () => {
    const encoding = encodeFrames(
      cut(),
      deps([], { addAudio: () => Promise.reject(new Error("AAC broke")) }),
    );
    await expect(encoding).rejects.toMatchObject({ stage: "audio", frame: 0 });
  });

  test("a cancel stops before the next frame is read", async () => {
    const log: string[] = [];
    const controller = new AbortController();
    const encoding = encodeFrames(
      cut(),
      deps(log, {
        signal: controller.signal,
        progress: (frame) => {
          log.push(`progress ${frame}`);
          if (frame === 2) controller.abort();
        },
      }),
    );
    await expect(encoding).rejects.toMatchObject({ name: "AbortError" });
    expect(log.at(-1)).toBe("progress 2");
  });
});
