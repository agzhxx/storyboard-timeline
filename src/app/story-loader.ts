// "Load the robot story" (spec section 4.10), from the Feed: its story clips through the lazily
// loaded API client, each clip's facts from its file (src/feed/feed-media.ts), and the demo music
// from public/demo/, then the project in one go (src/app/robot-story.ts). Until it's in, the empty
// state's button says it's loading. If anything doesn't come, the Messages board's toast says what,
// with Retry, and the project stays as it was. The story only ever fills an empty timeline.

import { create } from "zustand";
import { projectDuration } from "../engine/project.ts";
import { newId, useDocumentStore, useUiStore } from "../engine/store.ts";
import type { Asset, Project } from "../engine/types.ts";
import type { FeedClip } from "../feed/feed-clip.ts";
import { inShotOrder } from "../feed/feed-clip.ts";
import { FeedClipError, feedAssetFor } from "../feed/feed-media.ts";
import { showWholeCollection } from "../feed/feed-store.ts";
import { loadFeedApi } from "../feed/load-feed-api.ts";
import { musicOf } from "../media/audio.ts";
import { playback } from "../media/playback.ts";
import { buildRobotStory } from "./robot-story.ts";
import { dismissToast, showProblem } from "./toast-store.ts";

/** The story's music, which comes with the app: a placeholder made by scripts/make-demo-music.sh. */
const DEMO_MUSIC_URL = `${import.meta.env.BASE_URL}demo/music.mp3`;

/** How many clips a page of the story asks for: all of them, in one (spec section 4.9). */
const STORY_PAGE_SIZE = 50;

export const useStoryLoad = create<{ loading: boolean }>(() => ({ loading: false }));

/** What the failure toast says under "Couldn't load the robot story". */
export const STORY_PROBLEMS = {
  noAnswer: "The Feed didn't answer. Check your connection and try again.",
  unreadable: "The Feed's answer isn't one this editor can read. Try again later.",
  cantPlay: "This browser can't play the story's clips. Try another browser.",
  noMusic: "Its music didn't load. Try again.",
} as const;

/** Whether the timeline is empty: the story never replaces a cut someone started. */
function timelineEmpty(): boolean {
  return projectDuration(useDocumentStore.getState().project) === 0;
}

/** The empty state's "Load the robot story", and the failure toast's Retry. */
export async function loadRobotStory(): Promise<void> {
  if (useStoryLoad.getState().loading || !timelineEmpty()) return;
  useStoryLoad.setState({ loading: true });
  dismissToast();
  try {
    const fetched = await fetchStory();
    if (!fetched.ok) {
      showProblem("Couldn't load the robot story", fetched.problem, () => void loadRobotStory());
      return;
    }
    // Edited in the meantime (a file added, say): the story doesn't replace that work.
    if (timelineEmpty()) open(fetched.story);
  } finally {
    useStoryLoad.setState({ loading: false });
  }
}

interface Story {
  project: Project;
  items: FeedClip[];
}

type Fetched = { ok: true; story: Story } | { ok: false; problem: string };

function failed(problem: string): Fetched {
  return { ok: false, problem };
}

async function fetchStory(): Promise<Fetched> {
  // The music doesn't wait for the Feed: it decodes while the clips are asked for.
  const decoding = demoMusic().catch(() => null);
  // The client's own chunk can fail to load too (offline).
  const api = await loadFeedApi().catch(() => null);
  if (!api) return failed(STORY_PROBLEMS.noAnswer);
  const result = await api.fetchWholeCollection("story", STORY_PAGE_SIZE);
  if (!result.ok) {
    const invalid = result.failure.reason === "invalid";
    return failed(invalid ? STORY_PROBLEMS.unreadable : STORY_PROBLEMS.noAnswer);
  }
  const items = inShotOrder(result.value);
  if (items.length === 0) return failed(STORY_PROBLEMS.unreadable);
  const shots = await Promise.all(items.map(feedAssetFor)).catch((error: unknown) => error);
  if (!Array.isArray(shots)) {
    const undecodable = shots instanceof FeedClipError && !shots.unreachable;
    return failed(undecodable ? STORY_PROBLEMS.cantPlay : STORY_PROBLEMS.noAnswer);
  }
  const music = await decoding;
  if (!music) return failed(STORY_PROBLEMS.noMusic);
  try {
    const project = buildRobotStory({ projectId: newId(), shots, music });
    return { ok: true, story: { project, items } };
  } catch {
    // No shot with a frame to show.
    return failed(STORY_PROBLEMS.unreadable);
  }
}

/** The demo music as an asset, decoded now: its length is the decoded one, and playback keeps it. */
async function demoMusic(): Promise<Asset> {
  const asset: Asset = {
    id: "demo-music",
    kind: "audio",
    name: "Demo music",
    source: { type: "url", url: DEMO_MUSIC_URL },
    durationSec: 0,
  };
  const buffer = await musicOf(asset);
  if (!buffer) throw new Error("The demo music didn't load.");
  return { ...asset, durationSec: buffer.duration };
}

/** Replaces the project with the story, at the design's 2 px per frame, with its clips in the bin. */
function open({ project, items }: Story): void {
  playback.pause();
  useDocumentStore.getState().loadProject(project);
  const ui = useUiStore.getState();
  useUiStore.setState({ playhead: 0, selection: [], activeTrackId: "V1" });
  ui.setZoom(2);
  ui.setScrollX(0);
  showWholeCollection("story", items);
}
