// What clips of imported files draw, on a recorded canvas: a filmstrip fills in as its thumbnails
// arrive, each slot showing only its own second's. The monitor's picture is in monitor.test.tsx.

import { act } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { placeAsset } from "../../src/engine/commands.ts";
import { createProject } from "../../src/engine/project.ts";
import type { Asset, Project } from "../../src/engine/types.ts";
import { useMediaCache } from "../../src/media/media-cache.ts";
import { drawnIn, picture, recordCanvases } from "./canvas.ts";
import { clipButton, renderEditor } from "./editor.tsx";

/** A 5 s 1080p video at 24 fps from My files. */
function video(id: string): Asset {
  return {
    id,
    kind: "video",
    name: `${id}.mp4`,
    source: { type: "file", opfsPath: `assets/${id}/source.mp4` },
    durationSec: 5,
    width: 1920,
    height: 1080,
    fps: 24,
  };
}

/** A 24 fps project with these videos one after another on V1, each all 120 frames of it. */
function cut(...ids: string[]): Project {
  let project = createProject({ id: "p", fps: 24 });
  ids.forEach((id, index) => {
    const result = placeAsset(project, {
      asset: video(id),
      clipId: id,
      trackId: "V1",
      start: index * 120,
    });
    if (!result.ok) throw new Error(result.error.message);
    project = result.project;
  });
  return project;
}

function thumbnails(id: string, made: number[]): void {
  const list: (ImageBitmap | undefined)[] = [];
  for (const second of made) list[second] = picture(`${id}${second}`);
  act(() => {
    useMediaCache.setState(({ thumbnails: all }) => ({ thumbnails: { ...all, [id]: list } }));
  });
}

beforeEach(() => {
  recordCanvases();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("a filmstrip shows each slot's own second as it arrives, and leaves the rest empty", () => {
  renderEditor(cut("wide"));

  // At 2 px per frame the 5 s clip is 240 px: slots at 0 and 138.67 px, seconds 0 and 2.
  thumbnails("wide", [0]);
  expect(drawnIn(clipButton("wide.mp4"))).toEqual(["image wide0"]);
  thumbnails("wide", [0, 1]);
  expect(drawnIn(clipButton("wide.mp4"))).toEqual(["image wide0"]);
  thumbnails("wide", [0, 1, 2, 3, 4]);
  expect(drawnIn(clipButton("wide.mp4"))).toEqual(["image wide0", "image wide2"]);
});
