// What the app's own dialogs share (Keyboard shortcuts, the New project confirmation): a native
// modal <dialog>, so the editor behind it is inert and its keys wait (src/app/keyboard.ts); focus
// on its `[data-autofocus]` control when it opens, kept inside it while it's open (Tab and
// Shift+Tab go round), and given back to what had it when it closes; Esc closes it.

import { type RefObject, useLayoutEffect, useRef } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Tab from the last control goes to the first, and Shift+Tab from the first to the last. */
function keepFocusInside(dialog: HTMLDialogElement, event: KeyboardEvent): void {
  const controls = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const [first] = controls;
  const last = controls.at(-1);
  if (!first || !last) return;
  const at = document.activeElement;
  if (event.shiftKey ? at === first || at === dialog : at === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/**
 * Opens the dialog on mount and closes it on unmount; `close` is what Esc does (closing the dialog
 * through its store). `keys` handles any other key pressed inside it. Pass stable functions.
 */
export function useModal(
  close: () => void,
  keys?: (event: KeyboardEvent) => void,
): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Opened before focus moves into it, and closed while it's still in the page, so the browser
    // gives focus back to what had it.
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onCancel = (event: Event) => {
      event.preventDefault();
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") keepFocusInside(dialog, event);
      else keys?.(event);
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("keydown", onKeyDown);
      dialog.close();
    };
  }, [close, keys]);
  return ref;
}
