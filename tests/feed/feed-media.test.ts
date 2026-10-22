// A Feed clip's facts before it's placed: from storage when an earlier session kept them, else
// read from its 720p file by the import worker, once per clip; and the errors a person sees. The
// worker and storage are faked.

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FeedClip } from "../../src/feed/feed-clip.ts";
import { feedAssetFor, feedAssetNow, feedFacts } from "../../src/feed/feed-media.ts";
import type { ImportWorker } from "../../src/media/import-client.ts";
import type { RemoteMeta } from "../../src/media/opfs.ts";
import { storyClips } from "../app/story.ts";

const fakes = vi.hoisted(() => ({
  probe: vi.fn<ImportWorker["probe"]>(),
  stored: vi.fn<(assetId: string) => Promise<RemoteMeta | null>>(),
}));

vi.mock("../../src/media/import-client.ts", () => ({ importWorker: { probe: fakes.probe } }));
vi.mock("../../src/media/remote-media.ts", () => ({ storedRemoteMeta: fakes.stored }));

const FACTS = {
  kind: "video" as const,
  container: "MP4",
  codec: "avc",
  durationSec: 5.041667,
  width: 1280,
  height: 720,
  fps: 24,
};

/** Each test takes its own clip: the facts are kept for the session, by clip. */
let next = 0;
function clip(): FeedClip {
  const item = storyClips()[next % 15];
  next += 1;
  if (!item) throw new Error("No clip");
  return { ...item, posterKey: `m/${item.id}/v${String(next)}` };
}

beforeEach(() => {
  fakes.probe.mockReset();
  fakes.stored.mockReset();
  fakes.stored.mockResolvedValue(null);
  fakes.probe.mockResolvedValue({ ok: true, facts: FACTS, poster: null });
});

describe("feedFacts", () => {
  test("reads the clip's 720p file, with the import worker", async () => {
    const item = clip();
    expect(await feedFacts(item)).toEqual({ durationSec: 5.041667, fps: 24 });
    expect(fakes.probe).toHaveBeenCalledWith(
      `https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev/m/${item.id}/v1/full.mp4`,
    );
  });

  test("once per clip a session", async () => {
    const item = clip();
    await Promise.all([feedFacts(item), feedFacts(item)]);
    await feedFacts(item);
    expect(fakes.probe).toHaveBeenCalledTimes(1);
  });

  test("from storage when an earlier session kept them with the thumbnails: no request", async () => {
    const item = clip();
    fakes.stored.mockResolvedValueOnce({
      version: 1,
      id: "feed-x",
      facts: { ...FACTS, durationSec: 5.04, fps: 23.976 },
      thumbnails: { count: 6, type: "image/webp" },
    });
    expect(await feedFacts(item)).toEqual({ durationSec: 5.04, fps: 23.976 });
    expect(fakes.probe).not.toHaveBeenCalled();
  });

  test("a file that doesn't answer says so, and is tried again next time", async () => {
    const item = clip();
    fakes.probe.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(feedFacts(item)).rejects.toThrow(
      `Couldn't add ${item.shot ?? ""}: the Feed's file didn't answer. Check your connection and try again.`,
    );
    expect(await feedFacts(item)).toEqual({ durationSec: 5.041667, fps: 24 });
    expect(fakes.probe).toHaveBeenCalledTimes(2);
  });

  test("a file this browser can't decode says so", async () => {
    const item = clip();
    fakes.probe.mockResolvedValueOnce({
      ok: false,
      problem: {
        kind: "video",
        codec: "hevc",
        codecString: "hvc1.1.6.L93.B0",
        containerCodec: null,
      },
    });
    await expect(feedFacts(item)).rejects.toThrow(
      `Can't play ${item.shot ?? ""} in this browser: its video doesn't decode here.`,
    );
  });
});

describe("the clip as an asset", () => {
  test("with its file's facts, ready to place", async () => {
    const asset = await feedAssetFor(clip());
    expect(asset).toMatchObject({ kind: "video", durationSec: 5.041667, fps: 24, width: 1920 });
  });

  test("right now, for a drag's ghost: the Feed's rounded length until the file's facts are in", async () => {
    const item = clip();
    const before = feedAssetNow(item);
    expect(before.durationSec).toBe(5);
    expect(before).not.toHaveProperty("fps");
    await feedFacts(item);
    expect(feedAssetNow(item)).toMatchObject({ durationSec: 5.041667, fps: 24 });
  });
});
