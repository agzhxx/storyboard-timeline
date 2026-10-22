// A `test` whose pages can store files in WebKit too. Playwright's WebKit gives its default,
// ephemeral contexts no origin private file system, so an import fails there with "this browser
// won't let the site store files". A persistent context has one, as Safari does: each WebKit test
// gets its own, in a new temporary profile that starts empty and is deleted when the test ends.
// Chrome keeps Playwright's own context.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "./test.ts";

export { expect } from "./test.ts";

export const test = base.extend({
  context: async ({ browserName, context, playwright }, use) => {
    if (browserName !== "webkit") {
      await use(context);
      return;
    }
    const profile = await mkdtemp(join(tmpdir(), "webkit-profile-"));
    // On macOS, Playwright's WebKit keeps the file system under ~/Library/WebKit rather than in
    // the profile, so every test would share one (and find the last run's files). macOS takes the
    // home folder from CFFIXED_USER_HOME when it's set, so ~ moves into the profile too.
    // Playwright applies the project's options (device, viewport, base URL) and its tracing to
    // this context as it does to its own.
    const persistent = await playwright.webkit.launchPersistentContext(profile, {
      env: { ...process.env, CFFIXED_USER_HOME: profile },
    });
    await use(persistent);
    await persistent.close();
    await rm(profile, { recursive: true, force: true });
  },
});
