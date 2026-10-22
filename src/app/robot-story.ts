// "Load the robot story" (spec section 4.10): the Feed's story clips on V1 in shot order, each
// with its first 3 seconds, and the demo music on A1 under the whole cut. Fifteen 5-second shots
// make a 45-second cut. The project takes the clips' own frame rate, read from the first one's
// file. Pure: src/app/story-loader.ts fetches the clips and the music, then builds the project here.

import { addClip, type CommandResult } from "../engine/commands.ts";
import { createProject } from "../engine/project.ts";
import { assetDurationFrames, projectRateFor } from "../engine/time.ts";
import type { Asset, Project } from "../engine/types.ts";

/** How much of each shot the cut uses: its first 3 seconds (Agzhan tunes them in the timeline). */
const SHOT_SECONDS = 3;

export interface StoryParts {
  projectId: string;
  /** The shots' assets, in shot order. */
  shots: readonly Asset[];
  music: Asset;
}

/**
 * The robot story: each shot on V1 after the one before, with its first 3 seconds (all of it if
 * it's shorter), then the music on A1 from the start, as long as the cut (or all of it if it's
 * shorter). A clip's id is its asset's. The rate is the first shot's, as a project rate; 30 when
 * its file has no steady one.
 */
export function buildRobotStory({ projectId, shots, music }: StoryParts): Project {
  const [first] = shots;
  const fps = (first?.fps === undefined ? null : projectRateFor(first.fps)) ?? 30;
  let project = createProject({
    id: projectId,
    name: "The robot story",
    fps,
    assets: [...shots, music],
  });
  let start = 0;
  for (const shot of shots) {
    const duration = Math.min(SHOT_SECONDS * fps, assetDurationFrames(shot, fps));
    if (duration < 1) continue;
    const clip = { clipId: shot.id, assetId: shot.id, trackId: "V1", start, duration };
    project = placed(addClip(project, clip));
    start += duration;
  }
  if (start === 0) throw new Error("None of the story's shots has a frame to show.");
  const duration = Math.min(start, assetDurationFrames(music, fps));
  if (duration < 1) return project;
  const clip = { clipId: music.id, assetId: music.id, trackId: "A1", start: 0, duration };
  return placed(addClip(project, clip));
}

function placed(result: CommandResult): Project {
  if (!result.ok) throw new Error(`The robot story doesn't fit together: ${result.error.message}`);
  return result.project;
}
