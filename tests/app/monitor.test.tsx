// The program monitor's picture (Main and Messages boards) with a fake decode worker: the exact
// frame at a paused playhead, the two-stage scrub (the nearest thumbnail, marked Preview, then the
// exact frame), a jump's spinner, V2 over V1, playback's frames, and a decode error's message. The
// canvas is recorded: "image a24" is a picture with the id a24.

import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { placeAsset } from "../../src/engine/commands.ts";
import { createProject } from "../../src/engine/project.ts";
import { useDocumentStore, useUiStore } from "../../src/engine/store.ts";
import type { Asset, Project } from "../../src/engine/types.ts";
import { useMediaCache } from "../../src/media/media-cache.ts";
import { playback } from "../../src/media/playback.ts";
import { LOADING_DELAY_MS } from "../../src/media/program.ts";
import { counters, openFrames } from "../../src/perf/counters.ts";
import { useGestureStore } from "../../src/timeline/gestures.ts";
import { drawnIn, picture, recordCanvases } from "./canvas.ts";
import { answerStill, fakeDecode, fakeImage } from "./fake-decode.ts";
import { clipButton, renderEditor } from "./editor.tsx";

vi.mock("../../src/media/decode-client.ts", async () => ({
  decodeWorker: (await import("./fake-decode.ts")).fakeDecode.worker,
}));

/** A 5 s video at 24 fps from My files; each test names its own, so cached frames don't carry over. */
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

/** Each video on its track, all 120 frames of it, from frame 0 (or `start`). */
function cut(...clips: { id: string; trackId?: string; start?: number }[]): Project {
  let project = createProject({ id: "p", fps: 24 });
  for (const { id, trackId = "V1", start = 0 } of clips) {
    const result = placeAsset(project, { asset: video(id), clipId: id, trackId, start });
    if (!result.ok) throw new Error(result.error.message);
    project = result.project;
  }
  return project;
}

/** Every second's thumbnail of a video, as the import makes them: "a0", "a1"… */
function thumbnails(id: string): void {
  const list = Array.from({ length: 5 }, (_, second) => picture(`${id}${String(second)}`));
  act(() => {
    useMediaCache.setState(({ thumbnails: all }) => ({ thumbnails: { ...all, [id]: list } }));
  });
}

const monitor = () => screen.getByRole("region", { name: "Program monitor" });
const drawn = () => drawnIn(monitor());
const chip = () => screen.queryByText("Preview");
const spinner = () => screen.queryByText("Loading the frame");

/** Lets `ms` of time pass: timers, animation frames and promises run. */
async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

function moveTo(frame: number) {
  act(() => {
    useUiStore.getState().setPlayhead(frame);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  recordCanvases();
  fakeDecode.reset();
  counters.openOnMain = 0;
});

afterEach(() => {
  playback.pause();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("paused", () => {
  test("the monitor asks for the exact frame at the playhead and draws it once it's in", async () => {
    renderEditor(cut({ id: "a" }));
    await wait(20);
    expect(fakeDecode.stills).toMatchObject([
      {
        slot: "V1",
        assetId: "a",
        location: { type: "file", opfsPath: "assets/a/source.mp4" },
        seconds: 0.001,
      },
    ]);
    act(() => {
      answerStill("V1", fakeImage("a@0"));
    });
    expect(drawn()).toEqual(["image a@0"]);
    expect(chip()).toBeNull();
  });

  test("scrubbing shows the nearest thumbnail at once, marked Preview, then the exact frame", async () => {
    renderEditor(cut({ id: "b" }));
    thumbnails("b");
    await wait(20);
    act(() => {
      answerStill("V1", fakeImage("b@0"));
      useGestureStore.setState({ gesture: { kind: "scrub" } });
    });
    // Frame 30 is 1.25 s into the source: the thumbnail of second 1.
    counters.coarse.length = 0;
    counters.exact.length = 0;
    moveTo(30);
    await wait(20);
    expect(drawn()).toEqual(["image b1"]);
    expect(chip()).not.toBeNull();
    expect(counters.coarse).toHaveLength(1);
    expect(fakeDecode.stills.at(-1)).toMatchObject({ slot: "V1", seconds: 30 / 24 + 0.001 });
    // The pointer rests: the exact frame replaces it.
    act(() => {
      answerStill("V1", fakeImage("b@30"));
    });
    expect(drawn()).toEqual(["image b@30"]);
    expect(chip()).toBeNull();
    // One latency each: the thumbnail's (coarse) and the exact frame's.
    expect(counters.coarse).toHaveLength(1);
    expect(counters.exact).toHaveLength(1);
  });

  test("the scrub's latency counts from the input event, not from when the playhead was set", async () => {
    renderEditor(cut({ id: "n" }));
    thumbnails("n");
    await wait(20);
    act(() => {
      useGestureStore.setState({ gesture: { kind: "scrub" } });
    });
    counters.coarse.length = 0;
    // The pointer move came in 40 ms before the page handled it (a busy frame, say).
    const input = new Event("pointermove");
    Object.defineProperty(input, "timeStamp", { value: performance.now() - 40 });
    act(() => {
      window.dispatchEvent(input);
      useUiStore.getState().setPlayhead(30);
    });
    await wait(20);
    expect(counters.coarse).toHaveLength(1);
    expect(counters.coarse[0]).toBeGreaterThanOrEqual(40);
    expect(counters.coarse[0]).toBeLessThan(40 + 20);
  });

  test("latest wins: an answer to a request the playhead moved on from is closed, never drawn", async () => {
    renderEditor(cut({ id: "c" }));
    thumbnails("c");
    await wait(20);
    act(() => {
      useGestureStore.setState({ gesture: { kind: "scrub" } });
    });
    moveTo(30);
    await wait(20);
    const stale = fakeDecode.stills.at(-1);
    moveTo(60);
    await wait(20);
    const old = fakeImage("c@30");
    act(() => {
      fakeDecode.emit({
        type: "still",
        slot: "V1",
        seq: stale?.seq ?? -1,
        bitmap: old as unknown as ImageBitmap,
        open: 0,
      });
    });
    expect(old.closed).toBe(1);
    expect(drawn()).toEqual(["image c2"]);
    act(() => {
      answerStill("V1", fakeImage("c@60"));
    });
    expect(drawn()).toEqual(["image c@60"]);
  });

  test("a jump keeps the last picture; after a moment it dims, with a spinner, until the exact frame", async () => {
    renderEditor(cut({ id: "d" }));
    thumbnails("d");
    await wait(20);
    act(() => {
      answerStill("V1", fakeImage("d@0"));
    });
    await wait(500);
    moveTo(48);
    await wait(20);
    // No thumbnail, no chip: the last exact frame stays.
    expect(drawn()).toEqual(["image d@0"]);
    expect(chip()).toBeNull();
    expect(spinner()).toBeNull();
    await wait(LOADING_DELAY_MS);
    expect(spinner()).not.toBeNull();
    act(() => {
      answerStill("V1", fakeImage("d@48"));
    });
    expect(drawn()).toEqual(["image d@48"]);
    expect(spinner()).toBeNull();
  });

  test("frames already decoded draw at once, without asking again", async () => {
    renderEditor(cut({ id: "e" }));
    await wait(20);
    act(() => {
      answerStill("V1", fakeImage("e@0"));
    });
    await wait(500);
    moveTo(10);
    await wait(20);
    act(() => {
      answerStill("V1", fakeImage("e@10"));
    });
    await wait(500);
    const asked = fakeDecode.stills.length;
    moveTo(0);
    await wait(20);
    expect(drawn()).toEqual(["image e@0"]);
    expect(fakeDecode.stills).toHaveLength(asked);
  });

  test("V2 draws over V1, once both exact frames are in", async () => {
    renderEditor(cut({ id: "f" }, { id: "g", trackId: "V2" }));
    await wait(20);
    expect(fakeDecode.stills.map((still) => still.slot).sort()).toEqual(["V1", "V2"]);
    act(() => {
      answerStill("V2", fakeImage("g@0"));
    });
    expect(drawn()).toEqual([]);
    act(() => {
      answerStill("V1", fakeImage("f@0"));
    });
    expect(drawn()).toEqual(["image f@0", "image g@0"]);
  });

  test("one file's frame on V1 and V2 at once is drawn from one bitmap; the second is closed", async () => {
    let project = createProject({ id: "p", fps: 24 });
    for (const [clipId, trackId] of [
      ["s1", "V1"],
      ["s2", "V2"],
    ] as const) {
      const result = placeAsset(project, { asset: video("s"), clipId, trackId, start: 0 });
      if (!result.ok) throw new Error(result.error.message);
      project = result.project;
    }
    renderEditor(project);
    await wait(20);
    const [first, second] = [fakeImage("s@0 first"), fakeImage("s@0 second")];
    act(() => {
      answerStill("V1", first);
      answerStill("V2", second);
    });
    expect(drawn()).toEqual(["image s@0 first", "image s@0 first"]);
    expect([first.closed, second.closed]).toEqual([0, 1]);
  });

  test("an answer that comes in after the monitor is gone is closed", async () => {
    renderEditor(cut({ id: "t" }));
    await wait(20);
    act(() => {
      useDocumentStore.getState().loadProject(createProject({ id: "empty" }));
    });
    const late = fakeImage("t@0");
    act(() => {
      answerStill("V1", late);
    });
    expect(late.closed).toBe(1);
  });

  test("a frame that won't decode shows its thumbnail, and its clip gets the error badge", async () => {
    renderEditor(cut({ id: "h" }));
    thumbnails("h");
    await wait(20);
    const request = fakeDecode.stills.at(-1);
    act(() => {
      fakeDecode.emit({
        type: "still-failed",
        slot: "V1",
        seq: request?.seq ?? -1,
        unreachable: false,
        open: 0,
      });
    });
    expect(drawn()).toEqual(["image h0"]);
    expect(chip()).not.toBeNull();
    expect(clipButton("h.mp4").getAttribute("aria-label")).toMatch(/can't decode$/);
    expect(screen.getByRole("img", { name: "Decode error" })).not.toBeNull();
  });

  test("a frame whose media didn't load shows its thumbnail without a badge, and loads next time", async () => {
    renderEditor(cut({ id: "x" }));
    thumbnails("x");
    await wait(20);
    const request = fakeDecode.stills.at(-1);
    act(() => {
      fakeDecode.emit({
        type: "still-failed",
        slot: "V1",
        seq: request?.seq ?? -1,
        unreachable: true,
        open: 0,
      });
    });
    expect(drawn()).toEqual(["image x0"]);
    expect(clipButton("x.mp4").getAttribute("aria-label")).not.toMatch(/can't decode$/);
    expect(screen.queryByRole("img", { name: "Decode error" })).toBeNull();
    // The next move asks for its frame again.
    moveTo(30);
    await wait(20);
    expect(fakeDecode.stills.at(-1)).toMatchObject({ assetId: "x", seconds: 30 / 24 + 0.001 });
  });
});

describe("playing", () => {
  /** Starts playback of the cut and returns its session. */
  function play() {
    act(() => {
      fireEvent.keyDown(document.body, { key: " " });
    });
    const session = fakeDecode.plays.at(-1);
    if (!session) throw new Error("Playback asked for nothing");
    return session.session;
  }

  /** Sends the frame of a clip that shows at timeline frame `n`, as the worker would. */
  function sendFrame(session: number, clipId: string, n: number) {
    const frame = fakeImage(`${clipId}#${String(n)}`);
    act(() => {
      fakeDecode.emit({
        type: "frame",
        session,
        trackId: "V1",
        clipId,
        presentUs: Math.round((n * 1_000_000) / 24),
        endUs: Math.round(((n + 1) * 1_000_000) / 24),
        rotation: 0,
        flip: false,
        frame: frame as unknown as VideoFrame,
        open: 0,
      });
    });
    return frame;
  }

  test("each animation frame draws the frame due and closes the ones before; pausing closes the rest", async () => {
    renderEditor(cut({ id: "i" }));
    await wait(20);
    const session = play();
    expect(fakeDecode.plays.at(-1)?.tracks).toMatchObject([
      { trackId: "V1", runs: [{ clipId: "i" }] },
    ]);
    const frames = Array.from({ length: 8 }, (_, n) => sendFrame(session, "i", n));
    expect(openFrames()).toBe(8);
    // The first frame is in: playback starts.
    await wait(100);
    expect(drawn()).toEqual([`image i#${String(useUiStore.getState().playhead)}`]);
    expect(fakeDecode.acks.reduce((sum, ack) => sum + ack.count, 0)).toBeGreaterThan(0);

    act(() => {
      fireEvent.keyDown(document.body, { key: "k" });
    });
    expect(frames.every((frame) => frame.closed === 1)).toBe(true);
    expect(openFrames()).toBe(0);
    expect(fakeDecode.stops).toEqual([session]);
  });

  test("a frame from a playback that has stopped is closed at once", async () => {
    renderEditor(cut({ id: "j" }));
    await wait(20);
    const session = play();
    act(() => {
      fireEvent.keyDown(document.body, { key: "k" });
    });
    const late = sendFrame(session, "j", 0);
    expect(late.closed).toBe(1);
    expect(openFrames()).toBe(0);
  });

  test("a decode error pauses at the clip with the board's message; Play from the next clip plays on", async () => {
    renderEditor(cut({ id: "k" }, { id: "l", start: 120 }));
    await wait(20);
    const session = play();
    for (let n = 0; n < 8; n += 1) sendFrame(session, "k", n);
    act(() => {
      fakeDecode.emit({
        type: "failed",
        session,
        trackId: "V1",
        clipId: "k",
        atUs: Math.round((48 * 1_000_000) / 24),
        unreachable: false,
        open: 0,
      });
    });
    await wait(3_000);
    expect(useUiStore.getState().playhead).toBe(48);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Can't decode k.mp4 here");
    expect(alert.textContent).toContain("Paused at 00:00:02:00. The rest of the cut still plays.");
    expect(clipButton("k.mp4").getAttribute("aria-label")).toMatch(/can't decode$/);

    fireEvent.click(screen.getByRole("button", { name: "Play from the next clip" }));
    await wait(20);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fakeDecode.plays.at(-1)?.tracks).toMatchObject([{ runs: [{ clipId: "l" }] }]);
    expect(useUiStore.getState().playhead).toBe(120);
  });

  test("a clip whose media didn't load pauses with its own message, no badge, and Play again", async () => {
    renderEditor(cut({ id: "y" }, { id: "z", start: 120 }));
    await wait(20);
    const session = play();
    for (let n = 0; n < 8; n += 1) sendFrame(session, "y", n);
    act(() => {
      fakeDecode.emit({
        type: "failed",
        session,
        trackId: "V1",
        clipId: "y",
        atUs: Math.round((48 * 1_000_000) / 24),
        unreachable: true,
        open: 0,
      });
    });
    await wait(3_000);
    expect(useUiStore.getState().playhead).toBe(48);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load y.mp4");
    expect(alert.textContent).toContain(
      "Its file didn’t answer. Paused at 00:00:02:00; check your connection.",
    );
    expect(clipButton("y.mp4").getAttribute("aria-label")).not.toMatch(/can't decode$/);

    // Play again plays from where it stopped, asking for the same clip again.
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await wait(20);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fakeDecode.plays.at(-1)?.tracks).toMatchObject([
      { runs: [{ clipId: "y" }, { clipId: "z" }] },
    ]);
    expect(useUiStore.getState().playhead).toBe(48);
  });

  test("the decode error's message goes when its clip is deleted", async () => {
    renderEditor(cut({ id: "u" }, { id: "w", start: 120 }));
    await wait(20);
    const session = play();
    sendFrame(session, "u", 0);
    act(() => {
      fakeDecode.emit({
        type: "failed",
        session,
        trackId: "V1",
        clipId: "u",
        atUs: 0,
        unreachable: false,
        open: 0,
      });
    });
    await wait(100);
    expect(screen.getByRole("alert").textContent).toContain("Can't decode u.mp4 here");
    act(() => {
      useDocumentStore.getState().deleteClips({ clipIds: ["u"] });
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

test("the inspector shows the selected clip's exact in point once it's decoded, its thumbnail till then", async () => {
  renderEditor(cut({ id: "m" }));
  thumbnails("m");
  await wait(20);
  fireEvent.pointerDown(clipButton("m.mp4"), { button: 0, clientX: 10, clientY: 144 });
  fireEvent.pointerUp(window, { button: 0 });
  await wait(20);
  const inspector = screen.getByRole("region", { name: "Inspector" });
  expect(drawnIn(inspector)).toEqual(["image m0"]);
  const request = fakeDecode.stills.find((still) => still.slot === "inspector");
  expect(request).toMatchObject({ assetId: "m", seconds: 0.001 });
  // The monitor's answers don't touch it, and its answer doesn't touch the monitor.
  act(() => {
    answerStill("V1", fakeImage("m@0 monitor"));
    answerStill("inspector", fakeImage("m@0"));
  });
  expect(drawnIn(inspector)).toEqual(["image m@0"]);
  expect(drawn()).toEqual(["image m@0 monitor"]);
});

describe("the inspector's exact frame", () => {
  function select(name: string) {
    fireEvent.pointerDown(clipButton(name), { button: 0, clientX: 10, clientY: 144 });
    fireEvent.pointerUp(window, { button: 0 });
  }
  const inspectorStills = () => fakeDecode.stills.filter((still) => still.slot === "inspector");

  test("back on the clip whose frame it shows, it drops the request for the other", async () => {
    renderEditor(cut({ id: "x" }, { id: "y", start: 120 }));
    thumbnails("x");
    await wait(20);
    select("x.mp4");
    await wait(20);
    act(() => {
      answerStill("inspector", fakeImage("x@0"));
    });
    select("y.mp4");
    await wait(20);
    expect(inspectorStills().at(-1)).toMatchObject({ assetId: "y" });
    const asked = inspectorStills().length;
    select("x.mp4");
    await wait(20);
    expect(inspectorStills()).toHaveLength(asked);
    // y's answer comes in late: it's closed, and x's frame stays.
    const late = fakeImage("y@0");
    act(() => {
      answerStill("inspector", late);
    });
    expect(late.closed).toBe(1);
    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(drawnIn(inspector)).toEqual(["image x@0"]);
  });

  test("thumbnails coming in while it decodes don't ask again", async () => {
    renderEditor(cut({ id: "z" }));
    await wait(20);
    select("z.mp4");
    await wait(20);
    const asked = inspectorStills().length;
    thumbnails("z");
    thumbnails("z");
    await wait(20);
    expect(inspectorStills()).toHaveLength(asked);
  });
});

test("a Feed clip's exact frame is decoded from the Feed's 720p file, by its address", async () => {
  renderEditor();
  await wait(20);
  expect(screen.getByRole("img", { name: "01-wide at the playhead" })).not.toBeNull();
  expect(fakeDecode.stills).toMatchObject([
    {
      slot: "V1",
      assetId: "01-wide",
      location: {
        type: "url",
        url: "https://pub-b6efd72fde71478fa4b96c65e2f0928d.r2.dev/m/csn26qjo95/v1/full.mp4",
      },
      seconds: 0.001,
    },
  ]);
});
