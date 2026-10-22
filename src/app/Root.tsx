// The page: nothing while the tab gets the project and restores it (src/app/startup.ts), then the
// editor, or the read-only phone view under 768 px (its own chunk), or, when another tab has the
// project, a note saying so. The app's live region is always there (src/app/LiveRegion.tsx).

import { useCallback, useState } from "react";
import { App } from "./App.tsx";
import { chunk } from "./chunks.ts";
import { LazyHost } from "./lazy.tsx";
import { LiveRegion } from "./LiveRegion.tsx";
import { useNarrowScreen } from "./narrow.ts";
import { OpenElsewhere } from "./OpenElsewhere.tsx";
import { useSession } from "./startup.ts";
import { SecondaryButton } from "./ui.tsx";

const phoneChunk = chunk(() => import("../phone/PhoneView.tsx"));

function loadPhoneView() {
  return phoneChunk().then((module) => module.default);
}

export function Root() {
  const state = useSession((session) => session.state);
  const narrow = useNarrowScreen();
  let view = null;
  if (state === "editing") view = narrow ? <PhoneHost /> : <App />;
  else if (state !== "starting") view = <OpenElsewhere />;
  return (
    <>
      {view}
      <LiveRegion />
    </>
  );
}

/** The phone view, once its chunk is in; if it won't load, why, and Retry. */
function PhoneHost() {
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => {
    setFailed(true);
  }, []);
  if (!failed) return <LazyHost open load={loadPhoneView} failed={fail} />;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="alert" className="text-sm text-fg-muted">
        This view couldn&rsquo;t load: check your connection.
      </p>
      <SecondaryButton
        className="px-3.5"
        onClick={() => {
          setFailed(false);
        }}
      >
        Retry
      </SecondaryButton>
    </main>
  );
}
