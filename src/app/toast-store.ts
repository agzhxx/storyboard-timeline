// One message at a time at the bottom left (the design's toasts): "Deleted 3 clips." with Undo
// after a delete, why an edit didn't happen, "Export canceled." with Export again, or a problem
// with what to do about it, such as "Couldn't load the robot story" with Retry, or "Storage is
// full" with Dismiss. A new message replaces the old one. A message is said by the app's live
// region (src/app/announcer.ts); a problem is an alert, said at once.

import { create } from "zustand";
import type { Project } from "../engine/types.ts";
import { announce } from "./announcer.ts";

export interface Toast {
  /** New for every message, so a message shown twice still starts its timer again. */
  id: number;
  message: string;
  /**
   * For a delete: the project it left. The toast offers Undo while that's still the document, and
   * goes away when another edit or an undo changes it, so Undo never takes back something else.
   */
  undoes: Project | null;
  /** A button after the message, such as "Export again". */
  action: { label: string; run: () => void } | null;
  /**
   * For a problem: what happened and what to do under the message (null when the message says it
   * all, as for an export that stopped), and Retry, or Dismiss when there's nothing to retry.
   */
  problem: { detail: string | null; retry: (() => void) | null } | null;
}

export const useToastStore = create<{ toast: Toast | null }>(() => ({ toast: null }));

let lastId = 0;

export function showToast(
  message: string,
  undoes: Project | null = null,
  action: Toast["action"] = null,
): void {
  lastId += 1;
  useToastStore.setState({ toast: { id: lastId, message, undoes, action, problem: null } });
  announce(message);
}

/**
 * A problem, as the Messages board draws one: a warning, the message (in bold, with the detail
 * under it), and Retry, or Dismiss when `retry` is null.
 */
export function showProblem(
  message: string,
  detail: string | null,
  retry: (() => void) | null,
): void {
  lastId += 1;
  useToastStore.setState({
    toast: { id: lastId, message, undoes: null, action: null, problem: { detail, retry } },
  });
}

export function dismissToast(): void {
  useToastStore.setState({ toast: null });
}
