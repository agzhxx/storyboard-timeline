// Reduced motion (spec section 3.6): with `prefers-reduced-motion: reduce`, nothing in the UI
// animates; playback, drawn frame by frame on a canvas, is unaffected. jsdom doesn't apply CSS, so
// this reads the source: every transition times itself with the motion tokens, which go to 0
// under the preference, and every animation stops under it.

import { describe, expect, test } from "vitest";
import globalsCss from "../src/app/globals.css?raw";
import tokensCss from "../src/app/tokens.css?raw";

const components = import.meta.glob<string>("../src/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Every class string in a component, from className="…" and className={`…`}. */
function classStrings(source: string): string[] {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
    ([, plain, template]) => plain ?? template ?? "",
  );
}

describe("reduced motion", () => {
  test("the motion tokens are 0 ms under the preference", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(
      tokensCss,
    )?.[1];
    expect(reduced).toContain("--dur-fast: 0ms;");
    expect(reduced).toContain("--dur-base: 0ms;");
  });

  test("every transition in the components is timed by the motion tokens", () => {
    const untimed: string[] = [];
    let transitions = 0;
    for (const [file, source] of Object.entries(components)) {
      for (const classes of classStrings(source)) {
        if (!/(^|\s)transition(-\w+)?(\s|$)/.test(classes)) continue;
        transitions += 1;
        if (!/duration-\(--dur-(fast|base)\)/.test(classes)) untimed.push(`${file}: ${classes}`);
      }
    }
    expect(untimed).toEqual([]);
    // The scan found the hover and press feedback it's about.
    expect(transitions).toBeGreaterThan(20);
  });

  test("every animation stops under the preference", () => {
    const moving: string[] = [];
    let animations = 0;
    for (const [file, source] of Object.entries(components)) {
      // Any string of classes with an animation in it, such as the spinner's.
      for (const [classes = ""] of source.matchAll(/["`][^"`]*\banimate-(?!none)[^"`]*["`]/g)) {
        animations += 1;
        if (!classes.includes("motion-reduce:animate-none")) moving.push(`${file}: ${classes}`);
      }
    }
    expect(moving).toEqual([]);
    expect(animations).toBeGreaterThan(0);
    // No CSS of the app's own animates either.
    expect(globalsCss).not.toMatch(/animation|transition|@keyframes/);
  });
});
