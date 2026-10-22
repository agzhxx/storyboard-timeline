// The robot story the component tests edit, built by the app's own builder from the Feed's real
// answer (e2e/fixtures/feed/story.json, saved on 18 October 2026): 15 shots of 5 s at 24 fps, each
// on V1 with its first 3 s, and the demo music on A1, for the 00:00:45:00 cut the boards draw. A
// shot's asset id is its name ("07-medium"), and so is its clip's, so a test can select "15-wide";
// in the app they're the Feed item's id and version.

import storyResponse from "../../e2e/fixtures/feed/story.json";
import { buildRobotStory } from "../../src/app/robot-story.ts";
import type { Asset, Project } from "../../src/engine/types.ts";
import { parseFeedPage } from "../../src/feed/feed-api.ts";
import { type FeedClip, feedAsset, feedClipName, inShotOrder } from "../../src/feed/feed-clip.ts";

/** The story's clips as the Feed's API sends them, newest first. */
export function storyClips(): FeedClip[] {
  const parsed = parseFeedPage(storyResponse);
  if (!parsed.ok) throw new Error("The story fixture doesn't parse.");
  return parsed.value.items;
}

/** What the import worker reads from each story clip's file, rounded as the Feed rounds them. */
export const SHOT_FACTS = { durationSec: 5, fps: 24 };

export const DEMO_MUSIC: Asset = {
  id: "demo-music",
  kind: "audio",
  name: "Demo music",
  source: { type: "url", url: "/demo/music.mp3" },
  durationSec: 46,
};

/** A story shot's asset, under its name. */
export function shotAsset(item: FeedClip): Asset {
  return { ...feedAsset(item, SHOT_FACTS), id: feedClipName(item) };
}

export function testStory(projectId = "story"): Project {
  const shots = inShotOrder(storyClips()).map(shotAsset);
  return buildRobotStory({ projectId, shots, music: DEMO_MUSIC });
}
