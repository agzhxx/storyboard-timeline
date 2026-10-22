// A Feed card dragged onto a track before its file's facts are in. The ghost first shows the time
// at the project's rate and the Feed's rounded length, then takes up the clip's own once the facts
// arrive mid-drag; facts that arrive after the drop don't get the clip refused where its ghost fit.
// jsdom has no layout, so the tracks' box is stubbed.

import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { placeAsset } from "../../src/engine/commands.ts";
import { createProject } from "../../src/engine/project.ts";
import type { Asset } from "../../src/engine/types.ts";
import type { FeedClip } from "../../src/feed/feed-clip.ts";
import { showWholeCollection } from "../../src/feed/feed-store.ts";
import { clipButton, messages, renderEditor, renderEmptyEditor, ROW_Y } from "./editor.tsx";
import { storyClips } from "./story.ts";

const facts = vi.hoisted(() => {
  const state: { known: boolean; arrive: () => void; seconds: number } = {
    known: false,
    arrive: () => undefined,
    /** How long the clip's file turns out to be. */
    seconds: 5,
  };
  return state;
});

vi.mock("../../src/feed/feed-media.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/feed/feed-media.ts")>();
  const { shotAsset, SHOT_FACTS } = await import("./story.ts");
  return {
    ...actual,
    // The facts arrive when the test says so.
    feedFacts: () =>
      new Promise((resolve) => {
        facts.arrive = () => {
          facts.known = true;
          resolve(SHOT_FACTS);
        };
      }),
    feedAssetFor: (item: FeedClip) =>
      Promise.resolve({ ...shotAsset(item), durationSec: facts.seconds }),
    // Before the facts: the Feed's own length and no frame rate.
    feedAssetNow: (item: FeedClip) => {
      const asset = shotAsset(item);
      if (!facts.known) Reflect.deleteProperty(asset, "fps");
      return asset;
    },
  };
});

// The Feed tab's clips are a chunk of their own (src/app/MediaBin.tsx): imported once up front, as a
// browser has it by the press, so the tab draws them in the turn after it opens.
beforeAll(async () => {
  await import("../../src/app/FeedClips.tsx");
});

beforeEach(() => {
  facts.known = false;
  facts.seconds = 5;
  // The tracks' visible area: 1,352 × 292 px from the page's top-left corner.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1_352, 292),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("a drag's ghost takes up the clip's own frame rate when its facts arrive", async () => {
  const { user } = renderEmptyEditor();
  act(() => {
    showWholeCollection("story", storyClips());
  });
  const bin = screen.getByRole("region", { name: "Media bin" });
  const card = await within(bin).findByRole("button", { name: "02-medium Kling 2.5 Pro" });

  await user.pointer({ keys: "[MouseLeft>]", target: card, coords: { clientX: 60, clientY: 600 } });
  // 400 px in at 2 px per frame: frame 200, which is 00:00:06:20 at the empty project's 30 fps.
  await user.pointer({ coords: { clientX: 300, clientY: ROW_Y.V1 } });
  await user.pointer({ coords: { clientX: 400, clientY: ROW_Y.V1 } });
  expect(screen.getByText("at 00:00:06:20")).toBeDefined();

  await act(async () => {
    facts.arrive();
    await Promise.resolve();
  });
  // Back to the same frame 200, now at the clip's 24 fps.
  await user.pointer({ coords: { clientX: 402, clientY: ROW_Y.V1 } });
  await user.pointer({ coords: { clientX: 400, clientY: ROW_Y.V1 } });
  expect(screen.getByText("at 00:00:08:08")).toBeDefined();

  await user.pointer({ keys: "[/MouseLeft]" });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(clipButton("02-medium").getAttribute("aria-label")).toBe(
    "02-medium on V1, starts 00:00:08:08, 00:00:05:00 long",
  );
});

test("facts that come after the drop: the clip goes in as long as its ghost, where it fit", async () => {
  // A 24 fps project with a clip on V2 at 00:00:13:08 (frame 320).
  const blocker: Asset = {
    id: "blocker",
    kind: "video",
    name: "blocker.mp4",
    source: { type: "file", opfsPath: "assets/blocker/source.mp4" },
    durationSec: 2,
    fps: 24,
  };
  const placed = placeAsset(createProject({ id: "p", fps: 24 }), {
    asset: blocker,
    clipId: "blocker",
    trackId: "V2",
    start: 320,
  });
  if (!placed.ok) throw new Error(placed.error.message);
  const { user } = renderEditor(placed.project);
  act(() => {
    showWholeCollection("story", storyClips());
  });
  // The file turns out a frame longer than the Feed's rounded 5 s: 121 frames.
  facts.seconds = 5.041667;
  const bin = screen.getByRole("region", { name: "Media bin" });
  const card = await within(bin).findByRole("button", { name: "02-medium Kling 2.5 Pro" });

  // The ghost, 120 frames from frame 200, ends where the blocker starts.
  await user.pointer({ keys: "[MouseLeft>]", target: card, coords: { clientX: 60, clientY: 600 } });
  await user.pointer({ coords: { clientX: 300, clientY: ROW_Y.V2 } });
  await user.pointer({ coords: { clientX: 400, clientY: ROW_Y.V2 } });
  expect(screen.getByText("at 00:00:08:08")).toBeDefined();
  await user.pointer({ keys: "[/MouseLeft]" });
  await act(async () => {
    facts.arrive();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(clipButton("02-medium").getAttribute("aria-label")).toBe(
    "02-medium on V2, starts 00:00:08:08, 00:00:05:00 long",
  );
  expect(messages().textContent).toBe("");
});
