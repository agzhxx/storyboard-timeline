// The app bar's two dialogs, one chunk loaded the first time either opens (src/app/App.tsx): the
// keyboard shortcuts (Keyboard shortcuts board) and the New project confirmation (Messages
// board). One chunk, so a load that failed offline is retried on its own (src/app/chunks.ts).

import { useCallback } from "react";
import { useDocumentStore } from "../engine/store.ts";
import { useLibrary } from "../media/library.ts";
import { closeNewProject, closeShortcuts } from "./dialogs.ts";
import { CloseIcon } from "./icons.tsx";
import { useModal } from "./modal.ts";
import { newProjectText, startNewProject } from "./new-project.ts";
import { PrimaryButton } from "./ui.tsx";

// Keyboard shortcuts ----------------------------------------------------------------------------

// 720 px, two columns of groups, each row a label and its keys: the board's rows, as drawn, then
// the keyboard editing M7 adds, in the same style. "?" or Esc closes it.

interface Group {
  title: string;
  /** Each row: its label, and its keys as the board writes them. */
  rows: [label: string, keys: string][];
}

/**
 * The board's two columns. In the keys, spaces separate chips, "_" is a space inside one ("hold
 * ⌥"), and "or", "/" and "+" are words between them.
 */
const COLUMNS: Group[][] = [
  [
    {
      title: "Playback",
      rows: [
        ["Play or pause", "Space"],
        ["Play; again for 2×", "L"],
        ["Pause", "K"],
        ["Back one second", "J"],
        ["One frame back / forward", "← / →"],
        ["One second back / forward", "⇧← / ⇧→"],
        ["Go to start / end", "Home / End"],
      ],
    },
    {
      title: "Editing",
      rows: [
        ["Split at the playhead", "S"],
        ["Trim start / end to the playhead", "[ / ]"],
        ["Delete selected clips", "Delete or ⌫"],
        ["Undo", "⌘Z"],
        ["Redo", "⇧⌘Z"],
      ],
    },
    { title: "Help", rows: [["Show this list", "?"]] },
  ],
  [
    {
      title: "Selection",
      rows: [
        ["Select a clip", "Click"],
        ["Add a clip to the selection", "⇧_Click"],
        ["Clear the selection", "Esc"],
      ],
    },
    {
      title: "Timeline",
      rows: [
        ["Snapping on or off", "N"],
        ["Drag without snapping", "hold_⌥"],
        ["Zoom around the pointer", "⌘_wheel or + / −"],
        ["Fit the whole cut", "⇧Z"],
        ["Scroll the timeline", "wheel"],
      ],
    },
    { title: "Media bin", rows: [["Add the focused item at the playhead", "↵"]] },
    {
      title: "Editing with the keyboard",
      rows: [
        ["Go to each clip, then its handles", "Tab"],
        ["Select the focused clip", "↵"],
        ["Trim with a handle: a frame", "← / →"],
        ["Trim with a handle: a second", "⇧← / ⇧→"],
        ["Trim with a handle as far as it goes", "Home / End"],
        ["Nudge the selected clip a frame", "⌥← / ⌥→"],
        ["Nudge it a second", "⌥⇧← / ⌥⇧→"],
      ],
    },
  ],
];

/** The symbols' names, for screen readers, which may not say "⇧" or "⌥". */
const SPOKEN: Record<string, string> = {
  "⌘": "Command ",
  "⇧": "Shift ",
  "⌥": "Option ",
  "←": "Left Arrow",
  "→": "Right Arrow",
  "↵": "Enter",
  "⌫": "Backspace",
  "−": "Minus",
};

function spoken(key: string): string {
  return key.replace(/[⌘⇧⌥←→↵⌫−]/gu, (symbol) => SPOKEN[symbol] ?? symbol);
}

const WORDS = new Set(["or", "/", "+"]);

function Keys({ keys }: { keys: string }) {
  return (
    <span className="inline-flex flex-none items-center gap-1">
      {keys.split(" ").map((part, index) => {
        if (WORDS.has(part)) {
          return (
            <span key={index} className="text-2xs text-fg-subtle">
              {part}
            </span>
          );
        }
        const key = part.replaceAll("_", " ");
        const named = spoken(key);
        return (
          <kbd
            key={index}
            className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-badge bg-surface-raised px-1.5 font-mono text-2xs whitespace-nowrap text-fg shadow-[inset_0_-1px_0_var(--color-line),inset_0_0_0_1px_var(--color-line)]"
          >
            {named === key ? (
              key
            ) : (
              <>
                <span aria-hidden="true">{key}</span>
                <span className="sr-only">{named}</span>
              </>
            )}
          </kbd>
        );
      })}
    </span>
  );
}

export function ShortcutsDialog() {
  // "?" again closes it, as Esc does.
  const keys = useCallback((event: KeyboardEvent) => {
    if (event.key === "?") closeShortcuts();
  }, []);
  const dialog = useModal(closeShortcuts, keys);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="shortcuts-title"
      className="m-auto flex max-h-[calc(100dvh-2rem)] w-[720px] max-w-[calc(100vw-2rem)] flex-col gap-5 overflow-y-auto rounded-panel border-0 bg-surface p-6 text-fg shadow-popover backdrop:bg-backdrop"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="shortcuts-title" className="text-md font-semibold">
            Keyboard shortcuts
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            The whole edit works from the keyboard. ⌘ is Ctrl on Windows and Linux.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          data-autofocus
          className="inline-flex size-8 flex-none items-center justify-center rounded-control text-fg-muted transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-fg"
          onClick={closeShortcuts}
        >
          <CloseIcon size={16} strokeWidth={1.75} />
        </button>
      </div>
      <div className="grid grid-cols-2 items-start gap-x-8 gap-y-6">
        {COLUMNS.map((groups, column) => (
          <div key={column} className="flex flex-col gap-5">
            {groups.map((group, index) => (
              <section
                key={group.title}
                aria-labelledby={`keys-${column}-${index}`}
                className="flex flex-col gap-0.5"
              >
                <h3
                  id={`keys-${column}-${index}`}
                  className="mb-1.5 text-2xs font-semibold tracking-label text-fg-subtle uppercase"
                >
                  {group.title}
                </h3>
                <dl className="flex flex-col gap-0.5">
                  {group.rows.map(([label, keys]) => (
                    <div
                      key={label}
                      className="flex min-h-[30px] items-center justify-between gap-3 border-b border-surface-raised"
                    >
                      <dt className="text-sm">{label}</dt>
                      <dd>
                        <Keys keys={keys} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        ))}
      </div>
    </dialog>
  );
}

// New project ----------------------------------------------------------------------------------

// 440 px, "Start a new project?", what goes, and Cancel or Start new project. Cancel has the
// focus, since the other can't be undone.

export function NewProjectDialog() {
  const dialog = useModal(closeNewProject);
  const project = useDocumentStore((state) => state.project);
  const files = useLibrary((state) => state.entries.length);
  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby="new-project-title"
      aria-describedby="new-project-text"
      className="m-auto flex w-[440px] max-w-[calc(100vw-2rem)] flex-col gap-5 rounded-panel border-0 bg-surface p-6 text-fg shadow-popover backdrop:bg-backdrop"
    >
      <div>
        <h2 id="new-project-title" className="text-md font-semibold">
          Start a new project?
        </h2>
        <p id="new-project-text" className="mt-1.5 text-sm text-fg-muted">
          {newProjectText(project, files)}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-autofocus
          className="inline-flex h-control items-center rounded-control px-3.5 text-sm text-fg-muted transition-colors duration-(--dur-fast) hover:text-fg"
          onClick={closeNewProject}
        >
          Cancel
        </button>
        <PrimaryButton
          className="px-4"
          onClick={() => {
            closeNewProject();
            void startNewProject();
          }}
        >
          Start new project
        </PrimaryButton>
      </div>
    </dialog>
  );
}
