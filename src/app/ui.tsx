// Small pieces the panels share, as drawn on the canvas: key hints, icon buttons, the outlined and
// primary buttons, and the "AI" badge on the Feed's clips.

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * A key hint, such as the N after "Snapping". Screen readers skip it: the button it's in names
 * the key with `aria-keyshortcuts` instead, so its name stays "Snapping", not "Snapping N".
 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      aria-hidden="true"
      className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-badge bg-surface px-1 font-mono text-2xs font-normal text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]"
    >
      {children}
    </kbd>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** A 36 px square button with only an icon; `aria-label` names it. */
export function IconButton({ className = "", ...props }: ButtonProps & { "aria-label": string }) {
  return (
    <button
      type="button"
      className={`inline-flex size-control flex-none items-center justify-center rounded-control text-fg-muted transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-fg disabled:pointer-events-none disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

/** The outlined button, such as Split and Delete in the inspector. */
export function SecondaryButton({ className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex h-control items-center justify-center gap-2 rounded-control bg-surface-raised text-sm text-fg shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-(--dur-fast) hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)] ${className}`}
      {...props}
    />
  );
}

/** The accent button, for the one main action in view. */
export function PrimaryButton({ className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex h-control items-center gap-2 rounded-control bg-accent px-3.5 text-sm font-semibold text-on-accent transition-colors duration-(--dur-fast) hover:bg-accent-hover ${className}`}
      {...props}
    />
  );
}

/** A panel's 40 px header: "Program", "Inspector". */
export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-10 flex-none items-center justify-between gap-3 px-4">
      <h2 className="text-xs font-semibold text-fg-muted">{title}</h2>
      {children}
    </div>
  );
}

/**
 * "AI" on a Feed clip's picture: its media is AI-generated (spec section 1). Screen readers get it
 * in words from the text around it instead. `className` places it.
 */
export function AiBadge({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute rounded-badge bg-scrim px-1 text-2xs font-semibold tracking-label ${className}`}
    >
      AI
    </span>
  );
}
