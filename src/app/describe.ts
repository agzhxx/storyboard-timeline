// Counts in words, for the toolbar's "15 clips and music".

import type { Asset, Project } from "../engine/types.ts";

/** What's on the timeline: its video clips, and "and music" when A1 has some; null when empty. */
export function describeContents(project: Project): string | null {
  const kinds = project.tracks.flatMap((track) => track.clips.map(() => track.kind));
  return describe(kinds);
}

function describe(kinds: readonly Asset["kind"][]): string | null {
  const clips = kinds.filter((kind) => kind === "video").length;
  const music = kinds.includes("audio");
  if (clips === 0) return music ? "Music" : null;
  const counted = clips === 1 ? "1 clip" : `${clips} clips`;
  return music ? `${counted} and music` : counted;
}
