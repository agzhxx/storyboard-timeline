// The toast at the bottom left (Messages board): 400 px wide, for 6 seconds, held while the
// pointer is over it or focus is in it. After a delete it offers Undo, until another edit or an
// undo makes that the wrong thing to take back; after a canceled export, Export again. A problem,
// such as the robot story not loading, gets the board's warning, its message in bold with what to
// do under it (or the message alone, as when an export stopped), and Retry, or Dismiss when
// there's nothing to retry (storage full); it's an alert, so it's announced at once. Other
// messages are said by the app's live region (src/app/announcer.ts) as they're shown.

import { type ButtonHTMLAttributes, useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../engine/store.ts";
import { undo } from "./actions.ts";
import { CloseIcon, WarningIcon } from "./icons.tsx";
import { UNDO_HINT } from "./platform.ts";
import { dismissToast, type Toast, useToastStore } from "./toast-store.ts";
import { Kbd } from "./ui.tsx";

const SHOWN_FOR_MS = 6_000;

export function Toasts() {
  const toast = useToastStore((state) => state.toast);
  const project = useDocumentStore((state) => state.project);
  const stale = toast !== null && toast.undoes !== null && toast.undoes !== project;
  useEffect(() => {
    if (stale) dismissToast();
  }, [stale]);
  const shown = toast && !stale ? toast : null;
  // An alert is announced as it appears; other messages were announced as they were shown.
  return (
    <section aria-label="Messages" className="fixed bottom-4 left-4 z-50 max-w-[calc(100vw-2rem)]">
      {shown && !shown.problem && <ToastView key={shown.id} toast={shown} />}
      {shown?.problem && (
        <div role="alert">
          <ToastView key={shown.id} toast={shown} />
        </div>
      )}
    </section>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(SHOWN_FOR_MS);
  const held = hovered || focused;

  useEffect(() => {
    if (held) return;
    const shown = performance.now();
    const timer = setTimeout(dismissToast, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - shown;
    };
  }, [held]);

  const { problem } = toast;
  return (
    <div
      className={`flex w-[400px] max-w-full gap-3 rounded-control bg-surface-raised py-3 pr-3 pl-4 shadow-popover ${problem ? "items-start" : "items-center"}`}
      onPointerEnter={() => {
        setHovered(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
    >
      {problem ? (
        <>
          <span className="mt-px">
            <WarningIcon stroke="var(--color-danger)" />
          </span>
          {problem.detail === null ? (
            <p className="flex-1 text-sm">{toast.message}</p>
          ) : (
            <div className="flex-1">
              <p className="text-sm font-semibold">{toast.message}</p>
              <p className="mt-0.5 text-xs text-fg-muted">{problem.detail}</p>
            </div>
          )}
          {problem.retry ? (
            <ToastButton
              onClick={() => {
                dismissToast();
                problem.retry?.();
              }}
            >
              Retry
            </ToastButton>
          ) : (
            <button
              type="button"
              aria-label="Dismiss"
              className="inline-flex size-7 flex-none items-center justify-center rounded-card text-fg-subtle transition-colors duration-(--dur-fast) hover:text-fg"
              onClick={dismissToast}
            >
              <CloseIcon size={14} />
            </button>
          )}
        </>
      ) : (
        <p className="flex-1 text-sm">{toast.message}</p>
      )}
      {toast.action && (
        <ToastButton
          onClick={() => {
            dismissToast();
            toast.action?.run();
          }}
        >
          {toast.action.label}
        </ToastButton>
      )}
      {toast.undoes && (
        <ToastButton
          aria-keyshortcuts="Meta+Z Control+Z"
          onClick={() => {
            undo();
            dismissToast();
          }}
        >
          Undo
          <Kbd>{UNDO_HINT}</Kbd>
        </ToastButton>
      )}
    </div>
  );
}

/** A toast's accent text button: Undo, Retry, Export again. */
function ToastButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="inline-flex h-7 flex-none items-center gap-1.5 rounded-card px-2.5 text-sm font-semibold text-accent transition-colors duration-(--dur-fast) hover:text-accent-hover"
      {...props}
    />
  );
}
