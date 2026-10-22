import { describe, expect, test } from "vitest";
import {
  type FeedClip,
  feedAsset,
  feedAssetId,
  feedClipName,
  inShotOrder,
  isFeedClip,
} from "../../src/feed/feed-clip.ts";
import { storyClips } from "../app/story.ts";

function storyClip(shot = "07-medium"): FeedClip {
  const found = storyClips().find((item) => item.shot === shot);
  if (!found) throw new Error(`No ${shot}`);
  return found;
}

/** A clip from another collection, which has no shot. */
function worldsClip(prompt: string): FeedClip {
  return { ...storyClip(), shot: undefined, sourceId: undefined, collection: "worlds", prompt };
}

describe("a clip's name", () => {
  test("a story clip is its shot", () => {
    expect(feedClipName(storyClip("07-medium"))).toBe("07-medium");
  });

  test("a camera move is its move", () => {
    const move = { ...storyClip(), shot: undefined, collection: "camera-moves" as const };
    expect(feedClipName({ ...move, cameraMove: "whip-pan" })).toBe("whip-pan");
  });

  test("anything else, the first words of its prompt, up to its first comma", () => {
    expect(
      feedClipName(
        worldsClip(
          "The glowing whale swims slowly across the night sky above the rooftops, one shot",
        ),
      ),
    ).toBe("The glowing whale swims slowly…");
    expect(feedClipName(worldsClip("Embers rise, static camera, one continuous shot"))).toBe(
      "Embers rise",
    );
  });
});

describe("a clip's asset", () => {
  test("its id names the item and the version of its media", () => {
    expect(feedAssetId(storyClip())).toBe("feed-g6lq3m8u9k-v1");
    expect(feedAssetId({ ...storyClip(), posterKey: "m/g6lq3m8u9k/v2" })).toBe(
      "feed-g6lq3m8u9k-v2",
    );
  });

  test("is read from its address: the original, the 720p file, the preview and its model, at the original's size", () => {
    expect(feedAsset(storyClip(), { durationSec: 5.041667, fps: 24 })).toEqual({
      id: "feed-g6lq3m8u9k-v1",
      kind: "video",
      name: "07-medium",
      source: {
        type: "feed",
        itemId: "g6lq3m8u9k",
        url: "https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev/originals/g6lq3m8u9k.mp4",
        videoUrl: "https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev/m/g6lq3m8u9k/v1/full.mp4",
        previewUrl:
          "https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev/m/g6lq3m8u9k/v1/preview.mp4",
        model: "Kling 2.5 Pro",
      },
      durationSec: 5.041667,
      width: 1920,
      height: 1080,
      fps: 24,
    });
  });

  test("a file with no steady frame rate has none", () => {
    expect(feedAsset(storyClip(), { durationSec: 5, fps: null })).not.toHaveProperty("fps");
  });
});

test("only a video with its file and length is a Feed clip", () => {
  const item = storyClip();
  expect(isFeedClip(item)).toBe(true);
  expect(isFeedClip({ ...item, videoKey: undefined })).toBe(false);
  expect(isFeedClip({ ...item, kind: "image" })).toBe(false);
});

test("the story's clips in shot order, without items that have no shot", () => {
  const ordered = inShotOrder([...storyClips(), worldsClip("A lighthouse at dusk")]);
  expect(ordered).toHaveLength(15);
  expect(ordered.map((item) => item.shot)).toEqual(
    storyClips()
      .map((item) => item.shot)
      .toSorted(),
  );
  expect(ordered[0]?.shot).toBe("01-wide");
  expect(ordered.at(-1)?.shot).toBe("15-wide");
});
