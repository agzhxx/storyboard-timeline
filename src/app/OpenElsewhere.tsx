// Another tab of this browser has the project (src/save/project-lock.ts): this one shows that
// instead of the editor, so the two never save over each other. "Use it here" moves the project to
// this tab; the other one then shows this in turn. When the other tab closes, this one gets the
// project on its own. The boards don't draw it: it's the empty state's look (docs/design).

import { moveProjectHere, useSession } from "./startup.ts";
import { Logo } from "./icons.tsx";
import { PrimaryButton } from "./ui.tsx";

export function OpenElsewhere() {
  const moved = useSession((state) => state.state === "moved");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <Logo />
      <div className="max-w-[420px]">
        <h1 className="text-lg font-semibold">
          {moved ? "Your project moved to another tab" : "Your project is open in another tab"}
        </h1>
        <p className="mt-2 text-base text-fg-muted">
          {moved
            ? "Another tab took it over and saves it now, so this one stopped. Use it here to bring it back."
            : "One tab at a time can edit it, so the two never save over each other. Close the other tab, or use it here."}
        </p>
      </div>
      <PrimaryButton onClick={moveProjectHere}>Use it here</PrimaryButton>
    </main>
  );
}
