// The export's frame schedule (spec sections 4.2 and 4.7): what each output frame shows, worked
// out from the document before the export starts. Output frame n is at the project's rate; each
// video track shows its clip's source time `in + (n − start)` there, looked up 1 ms after the
// frame starts (M4's rule for rounded container times), and the decoder shows the last source
// frame at or before it, so a source at another rate shows its nearest earlier frame. V2 draws
// over V1, and where both tracks have a gap the frame is black. It's the monitor's picture
// (`layersAt`), frame by frame, so an export shows what the editor shows.
//
// The export decodes each clip once, forward, from its in point to its out point: `decodePasses`
// says what each pass reads, in the order the tracks need them.

import { layersAt } from "./picture.ts";
import { findAsset } from "./project.ts";
import { SOURCE_TOLERANCE_SEC, sourceSeconds } from "./time.ts";
import type { Frames, Project } from "./types.ts";

/** One video track's picture in an output frame. */
export interface ExportLayer {
  trackId: string;
  clipId: string;
  assetId: string;
  /** Where its frame is looked up in the source, in seconds: the last one at or before it shows. */
  seconds: number;
}

/**
 * Output frame `frame`'s pictures, bottom first: V1's, then V2's over it. Empty where every video
 * track has a gap (a black frame), and past the cut's end.
 */
export function frameSchedule(project: Project, frame: Frames): ExportLayer[] {
  return layersAt(project, frame).map(({ trackId, clip, asset, sourceFrame }) => ({
    trackId,
    clipId: clip.id,
    assetId: asset.id,
    seconds: sourceSeconds(sourceFrame, project.fps),
  }));
}

/** One clip's forward decode pass: the source times it reads, in seconds. */
export interface DecodePass {
  clipId: string;
  assetId: string;
  /** Its first frame's lookup: the decoder starts on the frame showing there. */
  fromSec: number;
  /** Its out point, less the tolerance, so the next frame, stored a little early, stays out. */
  toSec: number;
}

/** Each video track's decode passes in timeline order, bottom first; tracks with none left out. */
export function decodePasses(project: Project): { trackId: string; passes: DecodePass[] }[] {
  const { fps } = project;
  return project.tracks
    .toReversed()
    .filter((track) => track.kind === "video")
    .map((track) => ({
      trackId: track.id,
      passes: track.clips.flatMap((clip) =>
        findAsset(project, clip.assetId)
          ? [
              {
                clipId: clip.id,
                assetId: clip.assetId,
                fromSec: sourceSeconds(clip.in, fps),
                toSec: (clip.in + clip.duration) / fps - SOURCE_TOLERANCE_SEC,
              },
            ]
          : [],
      ),
    }))
    .filter((track) => track.passes.length > 0);
}
