// The document's rules (spec section 4.3), checked from scratch rather than trusted from the
// commands: the tests check every edit's result with it, and a restored save (src/save/) must pass
// it before it's loaded, since a file in storage can be damaged or from another version.

import { clipEnd } from "./project.ts";
import { assetDurationFrames } from "./time.ts";
import type { Project } from "./types.ts";

/** Every way a project breaks the document's rules. An empty list means the project is valid. */
export function invariantViolations(project: Project): string[] {
  const problems: string[] = [];
  const trackLayout = project.tracks.map((track) => `${track.id}:${track.kind}`).join(" ");
  if (trackLayout !== "V2:video V1:video A1:audio") problems.push(`tracks are ${trackLayout}`);
  for (const [key, asset] of Object.entries(project.assets)) {
    if (asset.id !== key) problems.push(`asset ${asset.id} is kept as ${key}`);
  }

  const seen = new Set<string>();
  for (const track of project.tracks) {
    track.clips.forEach((clip, index) => {
      const where = `${clip.id} on ${track.id}`;
      if (seen.has(clip.id)) problems.push(`${where}: its id is used twice`);
      seen.add(clip.id);

      const frames = { start: clip.start, in: clip.in, duration: clip.duration };
      for (const [field, value] of Object.entries(frames)) {
        if (!Number.isSafeInteger(value)) problems.push(`${where}: ${field} isn't whole: ${value}`);
      }
      if (clip.start < 0) problems.push(`${where}: starts before 0`);
      if (clip.duration < 1) problems.push(`${where}: shorter than one frame`);
      if (clip.in < 0) problems.push(`${where}: starts before its source`);

      const asset = Object.hasOwn(project.assets, clip.assetId)
        ? project.assets[clip.assetId]
        : undefined;
      if (!asset) {
        problems.push(`${where}: asset ${clip.assetId} is missing`);
      } else {
        if (asset.kind !== track.kind) {
          problems.push(`${where}: ${asset.kind} on a ${track.kind} track`);
        }
        if (clip.in + clip.duration > assetDurationFrames(asset, project.fps)) {
          problems.push(`${where}: runs past the end of its source`);
        }
      }

      // Consecutive clips that don't overlap and start in order mean the whole track is fine.
      const next = track.clips[index + 1];
      if (next && clipEnd(clip) > next.start) {
        problems.push(`${where}: overlaps or follows ${next.id}`);
      }
    });
  }
  return problems;
}
