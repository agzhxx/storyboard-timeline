// Every lazily loaded chunk imports from the shell alone. A chunk that
// failed to load is tried again under a new address (src/app/chunks.ts), but a chunk it imports keeps
// its own address, and a browser that saw that one fail keeps it failed for the page's life, as it
// does a chunk preloaded beside it. So two lazy chunks must never share a third. This reads the
// production build itself, once (the browser doesn't matter).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./test.ts";

const ASSETS = join(import.meta.dirname, "..", "dist", "assets");

test("every lazy chunk imports from the shell alone", ({ browserName }) => {
  test.skip(browserName !== "chromium", "It reads the build, not a page");
  const html = readFileSync(join(ASSETS, "..", "index.html"), "utf8");
  const shell = /\/assets\/(index-[\w-]+\.js)/.exec(html)?.[1];
  expect(shell).toBeDefined();
  const lazy = readdirSync(ASSETS).filter(
    (file) => file.endsWith(".js") && file !== shell && !file.includes(".worker-"),
  );
  expect(lazy.length).toBeGreaterThan(0);
  for (const file of lazy) {
    const imports = new Set(
      [...readFileSync(join(ASSETS, file), "utf8").matchAll(/from"\.\/([^"]+)"/g)].map(
        (match) => match[1],
      ),
    );
    expect(
      [...imports].filter((imported) => imported !== shell),
      file,
    ).toEqual([]);
  }
});
