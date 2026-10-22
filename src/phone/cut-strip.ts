// The phone view's filmstrip of the whole cut (Phone board): one picture per stretch of the cut a
// viewer sees, as wide as it lasts, which for the robot story is one per clip. A stretch is the
// clip on top there (V2 over V1) or a gap. Pure, so it's tested without a page.

import { clipAt, findAsset, projectDuration } from "../engine/project.ts";
import type { Asset, Clip, Frames, Project } from "../engine/types.ts";

export interface Piece {
  start: Frames;
  duration: Frames;
  /** The clip on top, or null in a gap. */
  clip: Clip | null;
  asset: Asset | null;
}

/** The cut, start to end, as the stretches a viewer sees: the clip on top in each, or a gap. */
export function cutPieces(project: Project): Piece[] {
  const end = projectDuration(project);
  const video = project.tracks.filter((track) => track.kind === "video");
  // The picture can only change where a video clip starts or ends.
  const cuts = new Set<Frames>([0, end]);
  for (const track of video) {
    for (const clip of track.clips) {
      cuts.add(clip.start);
      cuts.add(clip.start + clip.duration);
    }
  }
  const points = [...cuts].filter((frame) => frame <= end).sort((a, b) => a - b);
  const pieces: Piece[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index] ?? 0;
    const next = points[index + 1] ?? start;
    let clip: Clip | null = null;
    for (const track of video) {
      clip = clipAt(track, start) ?? null;
      if (clip) break;
    }
    const last = pieces.at(-1);
    if (last && last.clip?.id === clip?.id) {
      last.duration = next - last.start;
      continue;
    }
    const asset = clip ? (findAsset(project, clip.assetId) ?? null) : null;
    pieces.push({ start, duration: next - start, clip, asset });
  }
  return pieces;
}

/** The piece the playhead is in; the last one at the cut's end; -1 for an empty cut. */
export function pieceAt(pieces: readonly Piece[], frame: Frames): number {
  const index = pieces.findIndex((piece) => frame < piece.start + piece.duration);
  return index === -1 ? pieces.length - 1 : index;
}

/**
 * The phone's credits line: where the clips come from and the music, as "15 AI clips from the
 * Generation Feed · Demo music". Null for an empty cut.
 */
export function cutCredits(project: Project): string | null {
  let feed = 0;
  let own = 0;
  const music = new Set<string>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const asset = findAsset(project, clip.assetId);
      if (!asset) continue;
      if (asset.kind === "audio") music.add(asset.name);
      else if (asset.source.type === "feed") feed += 1;
      else own += 1;
    }
  }
  const count = (n: number) => (n === 1 ? "1 clip" : `${n} clips`);
  const parts = [
    ...(feed > 0
      ? [`${feed === 1 ? "1 AI clip" : `${feed} AI clips`} from the Generation Feed`]
      : []),
    ...(own > 0 ? [`${count(own)} of your own`] : []),
    ...music,
  ];
  return parts.length === 0 ? null : parts.join(" · ");
}
