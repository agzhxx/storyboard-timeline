// Offline (spec section 3.6; Media bin states board): the Feed tab says what still works and dims
// the clips that need a connection; editing goes on; and when the connection comes back, a page
// that didn't come is asked for again.

import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { useOnline, watchConnection } from "../../src/app/online.ts";
import type * as FeedApi from "../../src/feed/feed-api.ts";
import type { FeedClip } from "../../src/feed/feed-clip.ts";
import { feedClipName } from "../../src/feed/feed-clip.ts";
import { renderEditor, undoSteps } from "./editor.tsx";
import { storyClips } from "./story.ts";

const api = vi.hoisted(() => ({
  fetchFeedPage: vi.fn<typeof FeedApi.fetchFeedPage>(),
  fetchWholeCollection: vi.fn<typeof FeedApi.fetchWholeCollection>(),
}));

vi.mock("../../src/feed/load-feed-api.ts", () => ({ loadFeedApi: () => Promise.resolve(api) }));

// This browser has the facts of the first three shots only: they're the ones it cached.
vi.mock("../../src/feed/feed-media.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/feed/feed-media.ts")>();
  const { shotAsset, SHOT_FACTS } = await import("./story.ts");
  const { feedClipName: nameOf } = await import("../../src/feed/feed-clip.ts");
  return {
    ...actual,
    feedFacts: () => Promise.resolve(SHOT_FACTS),
    feedAssetFor: (item: FeedClip) => Promise.resolve(shotAsset(item)),
    feedAssetNow: shotAsset,
    factsAtHand: (item: FeedClip) =>
      Promise.resolve(["01-wide", "02-medium", "03-closeup"].includes(nameOf(item))),
  };
});

const clips = storyClips();
const bin = () => screen.getByRole("region", { name: "Media bin" });
const card = (name: string) => within(bin()).getByRole("button", { name: `${name} Kling 2.5 Pro` });

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function goOffline(offline: boolean) {
  act(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => !offline });
    window.dispatchEvent(new Event(offline ? "offline" : "online"));
  });
}

let stopWatching: () => void = () => undefined;

// The Feed tab's clips are a chunk of their own (src/app/MediaBin.tsx): imported once up front, as a
// browser has it by the press, so the tab draws them in the turn after it opens.
beforeAll(async () => {
  await import("../../src/app/FeedClips.tsx");
});

beforeEach(() => {
  api.fetchFeedPage.mockReset();
  api.fetchFeedPage.mockResolvedValue({
    ok: true,
    value: { items: clips, nextCursor: null, total: 15 },
  });
  useOnline.setState({ online: true });
  stopWatching = watchConnection();
});

afterEach(() => {
  stopWatching();
  goOffline(false);
});

test("offline, the Feed tab says what still works, and dims the clips that need a connection", async () => {
  renderEditor();
  fireEvent.click(within(bin()).getByRole("tab", { name: "From the Feed" }));
  await settle();
  goOffline(true);
  await settle();

  expect(
    within(bin()).getByText(/You’re offline\. Clips this browser already cached keep working/),
  ).toBeTruthy();
  const cached = card("02-medium");
  const needsConnection = card("13-closeup");
  expect(within(cached).queryByText("Offline")).toBeNull();
  expect(within(needsConnection).getByText("Offline")).toBeTruthy();
  const description = document.getElementById(
    needsConnection.getAttribute("aria-describedby") ?? "",
  );
  expect(description?.textContent).toContain("It needs a connection: you're offline.");

  goOffline(false);
  await settle();
  expect(within(bin()).queryByText(/You’re offline/)).toBeNull();
  expect(within(card("13-closeup")).queryByText("Offline")).toBeNull();
});

test("a page that didn't come offline loads when the connection comes back", async () => {
  api.fetchFeedPage.mockResolvedValueOnce({ ok: false, failure: { reason: "network" } });
  renderEditor();
  goOffline(true);
  fireEvent.click(within(bin()).getByRole("tab", { name: "From the Feed" }));
  await settle();
  // Offline is the reason: the note says so, rather than "Can't reach the Feed".
  expect(within(bin()).queryByText("Can’t reach the Feed")).toBeNull();
  expect(within(bin()).getByText(/You’re offline/)).toBeTruthy();

  goOffline(false);
  await settle();
  expect(api.fetchFeedPage).toHaveBeenCalledTimes(2);
  expect(card(feedClipName(clips[0] as FeedClip))).toBeTruthy();
});

test("editing goes on offline", async () => {
  const { user } = renderEditor();
  goOffline(true);
  const steps = undoSteps();
  await user.click(screen.getByRole("button", { name: /^07-medium on / }));
  await user.keyboard("{Delete}");
  expect(undoSteps()).toBe(steps + 1);
});
