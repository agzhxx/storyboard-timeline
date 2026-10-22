// Key names as the person's keyboard prints them: ⌘ on a Mac, Ctrl everywhere else.

/** Whether this is a Mac, where Ctrl+click is a right-click. */
export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The undo shortcut's hint, such as the toast's "⌘Z". */
export const UNDO_HINT = isMac ? "⌘Z" : "Ctrl+Z";
