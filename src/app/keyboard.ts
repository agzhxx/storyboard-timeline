// The keyboard map (spec sections 3.2 and 3.3; the design's Keyboard shortcuts board): one keydown
// listener for the whole editor. Keys go to a text field when one has focus, arrow keys to the
// zoom slider or a trim handle when it has focus (the handles handle theirs, src/timeline/
// ClipView.tsx), Space to a button reached with Tab, and every key to an open dialog. During a
// drag, only Esc (cancel) and N (snapping) work.

import { useEffect } from "react";
import { cancelGesture, gestureActive } from "../timeline/gestures.ts";
import {
  backOneFrame,
  backOneSecond,
  clearSelection,
  deleteSelection,
  fitCut,
  forwardOneFrame,
  forwardOneSecond,
  goToEnd,
  goToStart,
  jumpBackOneSecond,
  nudge,
  pausePlayback,
  playFaster,
  redo,
  splitAtPlayhead,
  toggleSnapping,
  togglePlayback,
  trimEndToPlayhead,
  trimStartToPlayhead,
  undo,
  zoomIn,
  zoomOut,
} from "./actions.ts";
import { openShortcuts } from "./dialogs.ts";

interface Shortcut {
  run: () => void;
  /** Whether holding the key down repeats it, as for stepping through frames. */
  repeats: boolean;
}

const once = (run: () => void): Shortcut => ({ run, repeats: false });
const repeating = (run: () => void): Shortcut => ({ run, repeats: true });

/**
 * Whether the focused control got focus from a press of the pointer rather than from Tab. Space
 * presses a button reached with Tab, as a keyboard user expects; after a click on one (a file in
 * the bin, the Snapping button), Space plays, as an editor's user expects.
 */
let focusFromPointer = true;

function onPointerDown(): void {
  focusFromPointer = true;
}

/** Whether focus got where it is with Tab rather than a press of the pointer. */
export function focusedWithKeyboard(): boolean {
  return !focusFromPointer;
}

function onTab(event: KeyboardEvent): void {
  if (event.key === "Tab") focusFromPointer = false;
}

/** Listens for the editor's keys while mounted. */
export function useShortcuts(): void {
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onTab, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onTab, true);
    };
  }, []);
}

function onKeyDown(event: KeyboardEvent): void {
  // A dialog (Export) has the keys while it's open: nothing changes behind it.
  if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
  if (ownsKey(event)) return;
  const shortcut = gestureActive() ? duringDrag(event) : shortcutFor(event);
  if (!shortcut) return;
  event.preventDefault();
  if (event.repeat && !shortcut.repeats) return;
  shortcut.run();
}

/** Mid-drag, Esc drops the gesture and N turns snapping off or on; other keys wait. */
function duringDrag({ key }: KeyboardEvent): Shortcut | null {
  if (key === "Escape") return once(cancelGesture);
  return key.toLowerCase() === "n" ? once(toggleSnapping) : null;
}

function shortcutFor({ key, shiftKey, altKey, metaKey, ctrlKey }: KeyboardEvent): Shortcut | null {
  if (metaKey || ctrlKey) {
    // Cmd+Z on a Mac, Ctrl+Z elsewhere; both work everywhere.
    return key.toLowerCase() === "z" && !altKey ? once(shiftKey ? redo : undo) : null;
  }
  if (altKey) {
    // ⌥← and ⌥→ nudge the selected clip a frame; with ⇧, a second.
    if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
    const direction = key === "ArrowLeft" ? -1 : 1;
    return repeating(() => {
      nudge(direction, shiftKey);
    });
  }
  switch (key) {
    case "?":
      return once(openShortcuts);
    case " ":
      return shiftKey ? null : once(togglePlayback);
    case "ArrowLeft":
      return repeating(shiftKey ? backOneSecond : backOneFrame);
    case "ArrowRight":
      return repeating(shiftKey ? forwardOneSecond : forwardOneFrame);
    case "Home":
      return once(goToStart);
    case "End":
      return once(goToEnd);
    case "[":
      return once(trimStartToPlayhead);
    case "]":
      return once(trimEndToPlayhead);
    case "Delete":
    case "Backspace":
      return once(deleteSelection);
    case "Escape":
      return once(clearSelection);
    case "+":
    case "=":
      return repeating(zoomIn);
    case "-":
    case "_":
      return repeating(zoomOut);
  }
  const letter = key.toLowerCase();
  if (letter === "z" && shiftKey) return once(fitCut);
  if (shiftKey) return null;
  if (letter === "s") return once(splitAtPlayhead);
  if (letter === "n") return once(toggleSnapping);
  if (letter === "l") return once(playFaster);
  if (letter === "k") return once(pausePlayback);
  if (letter === "j") return once(jumpBackOneSecond);
  return null;
}

/** Keys the slider's own arrows and ends handle. */
const SLIDER_KEYS = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
];

/**
 * Keys that belong to the focused control: all of them in a text field, arrows on a slider (the
 * zoom, or a trim handle, though ⌥ and the arrows still nudge from a handle), and Space on a
 * button reached with Tab, which it presses. Space on a clicked button plays instead, and the
 * shortcut's preventDefault keeps the button from being pressed too. A clip isn't a button for
 * Space: with a clip focused, Space plays and Enter selects it.
 */
function ownsKey({ target, key, altKey }: KeyboardEvent): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.getAttribute("role") === "slider") return !altKey && SLIDER_KEYS.includes(key);
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (key === " " && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)) {
    return !focusFromPointer;
  }
  if (!(target instanceof HTMLInputElement)) return false;
  if (target.type === "range") return SLIDER_KEYS.includes(key);
  if (key === " ") return true;
  return !["checkbox", "radio", "button", "submit", "reset"].includes(target.type);
}
