// What saving says (Messages board): the app bar's status, the storage-full toast, and the one for
// a saved project that couldn't be opened.

import type { SaveStatus } from "../save/autosave.ts";

/** The app bar's status; null when there's nothing to say (a new project with nothing in it). */
export function statusText(status: SaveStatus): string | null {
  switch (status.kind) {
    case "idle":
      return null;
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "restored":
      return "Restored from this browser";
    case "failed":
      return FAILED[status.failure];
  }
}

const FAILED: Record<Extract<SaveStatus, { kind: "failed" }>["failure"], string> = {
  quota: "Not saved: storage is full",
  unavailable: "Not saved: this browser won't store files",
  other: "Not saved: storage didn't answer",
};

/** A time of day as the toast says it, on the 24-hour clock: "14:32". */
export function clockTime(at: number): string {
  const time = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

/** Under the toast's "Storage is full": what's safe, and what to do. */
export function storageFullDetail(lastSaved: number | null): string {
  const safe =
    lastSaved === null
      ? "Nothing could be saved yet."
      : `Your last save, from ${clockTime(lastSaved)}, is safe.`;
  return `${safe} Free up space in this browser, then keep editing.`;
}

/** The problem shown when storage didn't answer at startup: nothing saves until a reload. */
export const NOT_OPENED = {
  message: "Couldn't open the saved project",
  detail: "This browser's storage didn't answer, so nothing is saved for now. Reload to try again.",
};
