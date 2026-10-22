import "@fontsource-variable/instrument-sans";
import "./app/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { handOverHandleFocus } from "./app/actions.ts";
import { announceEdits } from "./app/announcer.ts";
import { Root } from "./app/Root.tsx";
import { startSession } from "./app/startup.ts";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

// The project comes back from this browser's storage before the editor shows (src/app/startup.ts).
startSession();
announceEdits();
handOverHandleFocus();

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
