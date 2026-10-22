// The document (spec section 4.3): what an edit changes, what undo restores, and what autosave
// will write. Positions and lengths on the timeline are whole frames; floats never go in.

/** A whole number of frames at `project.fps`. */
export type Frames = number;

export interface Project {
  id: string;
  /** What the app bar calls it, such as "The robot story". */
  name: string;
  fps: 24 | 25 | 30;
  width: number; // 1920
  height: number; // 1080
  assets: Record<string, Asset>;
  tracks: Track[]; // [V2, V1, A1], top to bottom
}

export type Fps = Project["fps"];

export interface Asset {
  id: string;
  kind: "video" | "audio";
  name: string;
  source:
    // A file the person added: its copy in this browser's storage (src/media/opfs.ts).
    | { type: "file"; opfsPath: string }
    // A clip from the Feed, read from its address with range requests and never copied:
    // `url` is the 1080p original, `videoUrl` the Feed's lighter 720p
    // file, `previewUrl` the Feed's 480p preview of its first 2.5 s, which its first thumbnails
    // come from (M8; saves from before have none), and `model` the AI model that made it, for its
    // label.
    | {
        type: "feed";
        itemId: string;
        url: string;
        videoUrl: string;
        previewUrl?: string;
        model: string;
      }
    // Media that comes with the app, such as the robot story's music in public/demo/.
    | { type: "url"; url: string };
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface Track {
  id: string;
  kind: "video" | "audio";
  clips: Clip[]; // sorted by start, no overlaps
}

export interface Clip {
  id: string;
  assetId: string;
  start: Frames; // position on the timeline
  in: Frames; // offset into the source
  duration: Frames; // ≥ 1
}
