// What a screen reader hears without moving focus (spec section 2): one
// polite live region for the whole app (src/app/Announcer.tsx). It says each edit and each undo or
// redo in the words of the toolbar's "Undo: …" chip, the toasts' messages, and import, Feed and
// save news. Errors that stop work (the story or an export that stopped, storage full) are alerts
// of their own instead, which interrupt.
//
// The region is emptied, then given the message a moment later: a screen reader announces a
// change, so the same words twice in a row are still said twice, and a burst (an arrow key held
// on a trim handle) is said once, with its last words.

import { create } from "zustand";
import { useDocumentStore } from "../engine/store.ts";

/** How long the region stays empty before the message goes in. */
export const ANNOUNCE_DELAY_MS = 100;

export const useAnnouncer = create<{ text: string }>(() => ({ text: "" }));

let timer: ReturnType<typeof setTimeout> | null = null;

/** Says something politely: after what's being read now, without moving focus. */
export function announce(text: string): void {
  if (timer !== null) clearTimeout(timer);
  useAnnouncer.setState({ text: "" });
  timer = setTimeout(() => {
    timer = null;
    useAnnouncer.setState({ text });
  }, ANNOUNCE_DELAY_MS);
}

/** Each edit's verb, as said once it's done. */
const DONE: Record<string, string> = {
  add: "Added",
  move: "Moved",
  trim: "Trimmed the",
  split: "Split",
  delete: "Deleted",
};

/** An edit's label ("trim end of 07-medium") as said once it's done: "Trimmed the end of 07-medium." */
export function editAnnouncement(label: string): string {
  const space = label.indexOf(" ");
  const verb = space === -1 ? label : label.slice(0, space);
  const done = DONE[verb];
  if (done === undefined) return `${label.charAt(0).toUpperCase()}${label.slice(1)}.`;
  return `${done}${space === -1 ? "" : label.slice(space)}.`;
}

export function undoAnnouncement(label: string): string {
  return `Undid ${label}.`;
}

export function redoAnnouncement(label: string): string {
  return `Redid ${label}.`;
}

/** Whether undo or redo is moving through the history right now: that's not a new edit. */
let movingHistory = false;

/** Undo or redo, said as "Undid trim end of 07-medium." when there was one to take. */
export function moveHistory(direction: "undo" | "redo"): void {
  const store = useDocumentStore;
  const history = store.temporal.getState();
  const label =
    direction === "undo"
      ? history.pastStates.length > 0
        ? store.getState().lastEdit
        : null
      : (history.futureStates.at(-1)?.lastEdit ?? null);
  const before = store.getState().project;
  movingHistory = true;
  try {
    if (direction === "undo") store.getState().undo();
    else store.getState().redo();
  } finally {
    movingHistory = false;
  }
  if (label === null || store.getState().project === before) return;
  announce(direction === "undo" ? undoAnnouncement(label) : redoAnnouncement(label));
}

/**
 * Says each edit as it's made, from its label. Loading a project isn't an edit, and undo and redo
 * say themselves. Returns a function that stops listening.
 */
export function announceEdits(): () => void {
  return useDocumentStore.subscribe(({ project, lastEdit }, previous) => {
    if (movingHistory || project === previous.project || lastEdit === null) return;
    announce(editAnnouncement(lastEdit));
  });
}
