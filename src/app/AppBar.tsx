// The slim app bar (Editor boards): the app's name and the project's on the left; on the right,
// whether the project is saved (Messages board's four states), New project and Keyboard
// shortcuts. The status isn't a live region: it changes with every edit, and the app's live region
// says the problems instead (src/app/announcer.ts).

import { useDocumentStore } from "../engine/store.ts";
import { useSaveStatus } from "../save/autosave.ts";
import { openNewProject, openShortcuts } from "./dialogs.ts";
import { CheckIcon, HelpIcon, Logo, RetryIcon, SpinnerIcon, WarningIcon } from "./icons.tsx";
import { statusText } from "./save-text.ts";
import { IconButton } from "./ui.tsx";

export function AppBar() {
  const name = useDocumentStore((state) => state.project.name);
  return (
    <header className="flex h-appbar flex-none items-center justify-between gap-4 border-b border-line pr-2 pl-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo />
        <h1 className="text-sm font-semibold whitespace-nowrap">Storyboard Timeline</h1>
        <span aria-hidden="true" className="text-line-strong">
          /
        </span>
        <span className="truncate text-sm text-fg-muted">{name}</span>
      </div>
      <div className="flex flex-none items-center gap-1">
        <SaveStatus />
        <button
          type="button"
          className="inline-flex h-control items-center rounded-control px-3 text-sm text-fg-muted transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-fg"
          onClick={openNewProject}
        >
          New project
        </button>
        <IconButton aria-label="Keyboard shortcuts" aria-keyshortcuts="?" onClick={openShortcuts}>
          <HelpIcon size={18} />
        </IconButton>
      </div>
    </header>
  );
}

/** "Saving…", "Saved", "Not saved: storage is full" or "Restored from this browser". */
function SaveStatus() {
  const status = useSaveStatus((state) => state.status);
  const text = statusText(status);
  if (text === null) return null;
  const failed = status.kind === "failed";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 text-xs whitespace-nowrap ${failed ? "text-fg" : "text-fg-subtle"}`}
    >
      {status.kind === "saving" && <SpinnerIcon size={14} />}
      {status.kind === "saved" && <CheckIcon size={14} />}
      {status.kind === "restored" && <RetryIcon size={14} strokeWidth={1.75} />}
      {failed && <WarningIcon size={14} stroke="var(--color-danger)" />}
      {text}
    </span>
  );
}
