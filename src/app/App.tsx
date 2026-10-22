// The editor at 1440 × 900, as drawn (docs/design/README.md): the app bar; the media bin, the
// program monitor and the inspector; then the timeline's toolbar and tracks. The timeline keeps
// its height and the panels above it take what's left. From 768 px to 1024 px the page scrolls
// sideways; under 768 px the read-only phone view shows instead (src/app/Root.tsx).

import { Timeline } from "../timeline/Timeline.tsx";
import { AppBar } from "./AppBar.tsx";
import { chunk } from "./chunks.ts";
import { closeNewProject, closeShortcuts, useDialogs } from "./dialogs.ts";
import { closeExportDialog, useExportDialog } from "./export-open.ts";
import { Inspector } from "./Inspector.tsx";
import { useShortcuts } from "./keyboard.ts";
import { LazyHost } from "./lazy.tsx";
import { MediaBin } from "./MediaBin.tsx";
import { Monitor } from "./Monitor.tsx";
import { showToast } from "./toast-store.ts";
import { Toasts } from "./Toasts.tsx";
import { Toolbar } from "./Toolbar.tsx";

/**
 * The dialogs are their own chunks, loaded the first time each opens: the export dialog with the
 * export worker's client and the mix, and the app bar's two, the shortcuts and the New project
 * confirmation. One that won't load (offline) says so rather than taking the editor down, and is
 * tried again the next time.
 */
const exportChunk = chunk(() => import("./ExportDialog.tsx"));
const appBarChunk = chunk(() => import("./AppBarDialogs.tsx"));

const dialogs = {
  export: {
    load: () => exportChunk().then((module) => module.default),
    failed: () => {
      closeExportDialog();
      showToast("Export couldn't load: check your connection. Editing still works.");
    },
  },
  shortcuts: {
    load: () => appBarChunk().then((module) => module.ShortcutsDialog),
    failed: () => {
      closeShortcuts();
      showToast("The keyboard shortcuts couldn't load: check your connection.");
    },
  },
  newProject: {
    load: () => appBarChunk().then((module) => module.NewProjectDialog),
    failed: () => {
      closeNewProject();
      showToast("New project couldn't load: check your connection.");
    },
  },
};

export function App() {
  useShortcuts();
  const exporting = useExportDialog((state) => state.open);
  const { shortcuts, newProject } = useDialogs();
  return (
    <div className="flex h-dvh min-h-[640px] min-w-[1024px] flex-col overflow-hidden">
      <AppBar />
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 border-b border-line">
          <MediaBin />
          <Monitor />
          <Inspector />
        </div>
        <Toolbar />
        <Timeline />
      </main>
      <Toasts />
      <LazyHost open={exporting} {...dialogs.export} />
      <LazyHost open={shortcuts} {...dialogs.shortcuts} />
      <LazyHost open={newProject} {...dialogs.newProject} />
    </div>
  );
}
