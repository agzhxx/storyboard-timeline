import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The Genframe Kit's components (src/components/ui, from `shadcn add`) import with @/.
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  // The import worker is a module worker (src/media/import-client.ts), built as its own chunk.
  worker: { format: "es" },
  build: {
    // Every browser the app supports (spec section 2: Chrome and Edge, Safari 26, Firefox 130)
    // preloads modules itself, so Vite's polyfill for those that don't stays out of the shell
    // (docs/PERF.md, M8).
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        // Everything the page loads at the start stays in one file. Left alone, Rolldown moved the
        // modules the lazy chunks share with the shell (React, the stores, playback) into two
        // more files loaded at the start, which cost 1.9 KB of the shell's budget in imports and
        // exports between them (docs/PERF.md, M7).
        codeSplitting: { groups: [{ name: "index", tags: ["$initial"] }] },
      },
    },
  },
});
