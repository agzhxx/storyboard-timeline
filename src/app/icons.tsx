// The design's icons, as SVG in the markup like on the canvas: a 24 × 24 view box, round caps and
// joins, in the text's color. No icon library.

import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  strokeWidth?: number;
  /** A stroke color other than the text's, such as the accent on the snapping magnet. */
  stroke?: string;
}

function Svg({
  size = 16,
  strokeWidth = 1.75,
  stroke = "currentColor",
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      {children}
    </svg>
  );
}

export function GoToStartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 5v14" />
      <path d="M18 5 9 12l9 7z" />
    </Svg>
  );
}

export function FrameBackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function FrameForwardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

/** Filled, as drawn on the monitor's round Play button. */
export function PlayIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="flex-none"
    >
      <path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z" />
    </svg>
  );
}

/** Play's pair while playing: two filled bars of the same weight. */
export function PauseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="flex-none"
    >
      <rect x="6.5" y="5" width="4" height="14" rx="1" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function GoToEndIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 5v14" />
      <path d="M6 5l9 7-9 7z" />
    </Svg>
  );
}

export function SplitIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="6" cy="17" r="2.5" />
      <path d="M8.2 8.4 20 17M8.2 15.6 20 7" />
    </Svg>
  );
}

export function DeleteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </Svg>
  );
}

export function MagnetIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3v9a6 6 0 0 0 12 0V3" />
      <path d="M6 7h4M14 7h4" />
    </Svg>
  );
}

export function MagnetOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3v9a6 6 0 0 0 12 0V3" />
      <path d="M6 7h4M14 7h4" />
      <path d="M3 21 21 3" />
    </Svg>
  );
}

export function ZoomOutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function ZoomInIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Svg>
  );
}

export function VideoTrackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4" />
    </Svg>
  );
}

export function MusicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </Svg>
  );
}

export function AddIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/** Files going up into the bin: the empty bin's drop zone. */
export function UploadIcon(props: IconProps) {
  return (
    <Svg strokeWidth={1.5} {...props}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </Svg>
  );
}

/** Files coming down into the bin: files dragged over it. */
export function DropIcon(props: IconProps) {
  return (
    <Svg strokeWidth={1.5} {...props}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </Svg>
  );
}

/** Three quarters of a circle: something under way. It turns unless motion is reduced. */
export function SpinnerIcon({ spinning = true, ...props }: IconProps & { spinning?: boolean }) {
  return (
    <span className={spinning ? "flex animate-spin motion-reduce:animate-none" : "flex"}>
      <Svg strokeWidth={2} {...props}>
        <path d="M12 3a9 9 0 1 0 9 9" />
      </Svg>
    </span>
  );
}

/** Retry: a circle coming back on itself, as on the Feed's "Can't reach" panel. */
export function RetryIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </Svg>
  );
}

/** The chevron of a select, such as the Feed tab's Collection picker. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

/** Export: the film going up out of the tray, on the toolbar's button. */
export function ExportIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </Svg>
  );
}

/** Download: the finished film coming down. */
export function DownloadIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Svg>
  );
}

/** A check: the browser can encode it, the file passed its check. */
export function CheckIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

/** An "i" in a circle: a note, such as why the film will be WebM or why Export is off. */
export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.2" />
    </Svg>
  );
}

/** The error mark, drawn in the danger color: errors' text stays white. */
export function WarningIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </Svg>
  );
}

/** A question mark in a circle: the app bar's "Keyboard shortcuts". */
export function HelpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.25c-.7.35-1.1.95-1.1 1.7v.3" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

/** A crossed-out signal: the Feed tab while offline. */
export function OfflineIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 8.5a15 15 0 0 1 4-2.4M10 5.2A15 15 0 0 1 22 8.5M5 12a10 10 0 0 1 4-2.1M15.5 10.3A10 10 0 0 1 19 12M8.5 15.5a5 5 0 0 1 7 0M12 19.5v.2M3 3l18 18" />
    </Svg>
  );
}

/** A laptop: the phone view's "Editing works best on a laptop". */
export function LaptopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </Svg>
  );
}

/** The app's mark: three clips on tracks, crossed by the playhead. */
export function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true" className="flex-none">
      <rect width="32" height="32" rx="7" fill="var(--color-surface-raised)" />
      <rect x="5" y="8" width="12" height="5" rx="1.5" fill="var(--color-fg-muted)" />
      <rect x="5" y="15" width="22" height="5" rx="1.5" fill="var(--color-fg)" />
      <rect x="5" y="22" width="16" height="4" rx="1.5" fill="var(--color-line-strong)" />
      <rect x="19" y="4" width="2" height="24" rx="1" fill="var(--color-accent)" />
    </svg>
  );
}
