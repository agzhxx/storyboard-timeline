import { describe, expect, test } from "vitest";
import { addClip, placeAsset } from "../../src/engine/commands.ts";
import { createProject } from "../../src/engine/project.ts";
import type { Project } from "../../src/engine/types.ts";
import { cutCredits, cutPieces, pieceAt } from "../../src/phone/cut-strip.ts";
import { testStory } from "../app/story.ts";
import { OWN_FILE } from "../save/saves.ts";

function placed(result: ReturnType<typeof addClip>): Project {
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
}

describe("the phone's filmstrip of the whole cut", () => {
  test("the robot story is one stretch per clip, three seconds each", () => {
    const pieces = cutPieces(testStory());
    expect(pieces).toHaveLength(15);
    expect(pieces.map((piece) => piece.asset?.name)[6]).toBe("07-medium");
    expect(pieces.every((piece) => piece.duration === 72)).toBe(true);
    expect(pieces.at(-1)).toMatchObject({ start: 1_008, duration: 72 });
  });

  test("V2 shows over V1, and V1 comes back around it", () => {
    const story = placed(
      placeAsset(testStory(), {
        asset: OWN_FILE,
        clipId: "own",
        trackId: "V2",
        start: 100,
        duration: 20,
      }),
    );
    const pieces = cutPieces(story).slice(0, 4);
    expect(pieces.map(({ start, duration, clip }) => [start, duration, clip?.id])).toEqual([
      [0, 72, "01-wide"],
      [72, 28, "02-medium"],
      [100, 20, "own"],
      [120, 24, "02-medium"],
    ]);
  });

  test("a gap is a stretch without a clip", () => {
    const project = placed(
      addClip(createProject({ id: "gap", fps: 24, assets: [OWN_FILE] }), {
        clipId: "late",
        assetId: OWN_FILE.id,
        trackId: "V1",
        start: 48,
        duration: 24,
      }),
    );
    expect(
      cutPieces(project).map(({ start, duration, clip }) => [start, duration, clip?.id]),
    ).toEqual([
      [0, 48, undefined],
      [48, 24, "late"],
    ]);
  });

  test("the piece the playhead is in: the last one at the cut's end, none for an empty cut", () => {
    const pieces = cutPieces(testStory());
    expect(pieceAt(pieces, 0)).toBe(0);
    expect(pieceAt(pieces, 462)).toBe(6);
    expect(pieceAt(pieces, 1_079)).toBe(14);
    expect(pieceAt(pieces, 1_080)).toBe(14);
    expect(pieceAt(cutPieces(createProject({ id: "empty" })), 0)).toBe(-1);
  });

  test("the credits name where the clips come from and the music", () => {
    expect(cutCredits(testStory())).toBe("15 AI clips from the Generation Feed · Demo music");
    const own = placed(
      placeAsset(createProject({ id: "own" }), {
        asset: OWN_FILE,
        clipId: "own",
        trackId: "V1",
        start: 0,
      }),
    );
    expect(cutCredits(own)).toBe("1 clip of your own");
    expect(cutCredits(createProject({ id: "empty" }))).toBeNull();
  });
});
