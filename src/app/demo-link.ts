// A link that opens the robot story (spec section 4.9: the Feed's "Open in Timeline" on its story
// items): `?demo=story`. Once the project is in (src/app/startup.ts), an empty timeline gets the
// story, as "Load the robot story" does. A cut that's already there is never replaced unasked: a
// toast offers New project, whose confirmation says what goes, and the empty state's "Load the robot
// story" is then one press away. The parameter leaves the address at once, so a reload doesn't
// load or ask again.

import { projectDuration } from "../engine/project.ts";
import { useDocumentStore } from "../engine/store.ts";
import { openNewProject } from "./dialogs.ts";
import { loadRobotStory } from "./story-loader.ts";
import { showToast } from "./toast-store.ts";

/** What the toast says when a cut is already there. */
export const KEEPS_YOUR_CUT = "Your cut is still here. The robot story opens in a new project.";

/** Follows `?demo=story` in the page's address, if it's there. */
export function followDemoLink(
  location: Pick<Location, "href"> = window.location,
  history: Pick<History, "state" | "replaceState"> = window.history,
): void {
  const url = new URL(location.href);
  if (url.searchParams.get("demo") !== "story") return;
  url.searchParams.delete("demo");
  history.replaceState(history.state, "", url);
  if (projectDuration(useDocumentStore.getState().project) === 0) {
    void loadRobotStory();
    return;
  }
  showToast(KEEPS_YOUR_CUT, null, { label: "New project", run: openNewProject });
}
