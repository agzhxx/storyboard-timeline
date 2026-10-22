// Playback with the keys and the transport (spec section 3.3, Shortcuts board), on the robot
// story, with a fake decode worker and a fake clock: jsdom has no AudioContext, so playback follows
// performance.now(), which the test moves along with the animation frames. The fake worker hands
// over each track's first frame when a playback starts (`play`), so its clock starts at once.

import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useUiStore } from "../../src/engine/store.ts";
import { playback } from "../../src/media/playback.ts";
import { usePlaybackStore } from "../../src/media/playback-state.ts";
import { clipButton, renderEditor } from "./editor.tsx";
import { answerPlay, fakeDecode } from "./fake-decode.ts";

vi.mock("../../src/media/decode-client.ts", async () => ({
  decodeWorker: (await import("./fake-decode.ts")).fakeDecode.worker,
}));

const playhead = () => useUiStore.getState().playhead;
const status = () => usePlaybackStore.getState().status;
/** The transport's rate chip, as a screen reader reads it. */
const rate = () => screen.getByText(/×$/).parentElement?.textContent;

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  act(() => {
    fireEvent.keyDown(document.body, { key, ...init });
  });
}

/** Presses a key that starts a playback, and hands over its first frames. */
function play(key: string) {
  const before = fakeDecode.plays.length;
  press(key);
  if (fakeDecode.plays.length > before) {
    act(() => {
      answerPlay();
    });
  }
}

/** Lets `ms` of time pass: timers, animation frames and promises run as they would. */
async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  fakeDecode.reset();
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
});

afterEach(() => {
  playback.pause();
  vi.useRealTimers();
});

describe("playing and pausing", () => {
  test("Space plays from the playhead, the timecode follows the clock, and K pauses there", async () => {
    renderEditor();
    act(() => {
      useUiStore.getState().setPlayhead(48);
    });
    play(" ");
    await wait(1_000);
    expect(status()).toBe("playing");
    expect(playhead()).toBeGreaterThanOrEqual(71);
    expect(playhead()).toBeLessThanOrEqual(72);

    press("k");
    expect(status()).toBe("paused");
    const stopped = playhead();
    await wait(1_000);
    expect(playhead()).toBe(stopped);
    expect(screen.getByRole("timer", { name: "Playhead" }).textContent).toBe(
      `00:00:0${String(Math.floor(stopped / 24))}:${String(stopped % 24).padStart(2, "0")}`,
    );
  });

  test("the Play button plays and pauses, and says which it will do", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => {
      answerPlay();
    });
    await wait(100);
    expect(status()).toBe("playing");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(status()).toBe("paused");
    screen.getByRole("button", { name: "Play" });
  });

  test("Space with a clip focused plays; Enter selects the clip", async () => {
    renderEditor();
    const clip = clipButton("07-medium");
    clip.focus();
    fireEvent.keyDown(clip, { key: " " });
    act(() => {
      answerPlay();
    });
    await wait(100);
    expect(status()).toBe("playing");
    fireEvent.keyDown(clip, { key: "Enter" });
    expect(useUiStore.getState().selection).toHaveLength(1);
  });

  test("Space on a button reached with Tab presses it instead", async () => {
    renderEditor();
    const snapping = screen.getByRole("button", { name: "Snapping" });
    fireEvent.keyDown(document.body, { key: "Tab" });
    snapping.focus();
    fireEvent.keyDown(snapping, { key: " " });
    await wait(100);
    expect(status()).toBe("paused");
  });
});

describe("L, K and J", () => {
  test("L plays; L again plays at 2×, the clock and the rate chip with it", async () => {
    renderEditor();
    play("l");
    await wait(500);
    expect(rate()).toBe("Playback rate 1×");
    const before = playhead();
    press("l");
    expect(rate()).toBe("Playback rate 2×");
    await wait(1_000);
    // 2 s of timeline in 1 s, give or take an animation frame.
    expect(playhead() - before).toBeGreaterThanOrEqual(46);
    expect(playhead() - before).toBeLessThanOrEqual(50);
    press("k");
    expect(rate()).toBe("Playback rate 1×");
  });

  test("J while playing goes back a second and plays on", async () => {
    renderEditor();
    act(() => {
      useUiStore.getState().setPlayhead(240);
    });
    play("l");
    await wait(500);
    const at = playhead();
    play("j");
    expect(playhead()).toBe(at - 24);
    await wait(500);
    expect(status()).toBe("playing");
    expect(playhead()).toBeGreaterThan(at - 24);
  });

  test("J while paused goes back a second and stays paused", () => {
    renderEditor();
    act(() => {
      useUiStore.getState().setPlayhead(100);
    });
    press("j");
    expect(playhead()).toBe(76);
    expect(status()).toBe("paused");
    press("j");
    press("j");
    press("j");
    press("j");
    expect(playhead()).toBe(0);
  });
});

describe("what stops playback", () => {
  test("the end of the cut; Space then plays from the start", async () => {
    renderEditor();
    act(() => {
      useUiStore.getState().setPlayhead(1_070);
    });
    play(" ");
    await wait(1_000);
    expect(status()).toBe("paused");
    expect(playhead()).toBe(1_080);
    expect(screen.getByRole("timer", { name: "Playhead" }).textContent).toBe("00:00:45:00");
    play(" ");
    await wait(20);
    expect(status()).toBe("playing");
    expect(playhead()).toBeLessThan(5);
  });

  test("an edit pauses first: S splits where the picture stopped", async () => {
    renderEditor();
    play(" ");
    await wait(500);
    press("s");
    expect(status()).toBe("paused");
    const at = playhead();
    expect(screen.getAllByRole("button", { name: /^01-wide on V1/ })).toHaveLength(2);
    expect(
      screen
        .getByRole("button", { name: /^01-wide on V1, starts 00:00:00:00/ })
        .getAttribute("aria-label"),
    ).toMatch(new RegExp(`00:00:00:${String(at).padStart(2, "0")} long$`));
  });

  test("a jump pauses first: → steps one frame from where it stopped", async () => {
    renderEditor();
    play(" ");
    await wait(500);
    press("ArrowRight");
    expect(status()).toBe("paused");
    const at = playhead();
    await wait(500);
    expect(playhead()).toBe(at);
  });
});

test("playing past the view's edge turns the page, so the playhead stays in view", async () => {
  renderEditor();
  act(() => {
    useUiStore.getState().setViewportWidth(400);
  });
  play(" ");
  // At 2 px per frame, the playhead reaches the view's edge (400 px less 24) at frame 188.
  await wait(8_000);
  const { scrollX, pxPerFrame } = useUiStore.getState();
  const x = playhead() * pxPerFrame - scrollX;
  expect(scrollX).toBeGreaterThan(0);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThanOrEqual(400);
});
