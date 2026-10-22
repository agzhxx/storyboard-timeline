// Whether the export dialog is open (Export boards). The toolbar's Export opens it; the dialog, its
// steps and the export worker are their own chunks, loaded the first time it opens.

import { create } from "zustand";
import { playback } from "../media/playback.ts";

export const useExportDialog = create<{ open: boolean }>(() => ({ open: false }));

/** Export: pauses playback and opens the dialog over the editor. */
export function openExport(): void {
  playback.pause();
  useExportDialog.setState({ open: true });
}

export function closeExportDialog(): void {
  useExportDialog.setState({ open: false });
}

/**
 * Whether this browser encodes video at all (WebCodecs), checked without loading anything: the
 * toolbar's Export says why it can't when it doesn't. The dialog asks which codecs encode.
 */
export function encodesVideo(): boolean {
  return "VideoEncoder" in globalThis;
}
