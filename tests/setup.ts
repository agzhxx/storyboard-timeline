import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans when test globals are enabled; we import them explicitly.
afterEach(cleanup);

// jsdom has pointer events but not pointer capture, which the timeline's drags ask for. Without a
// layout, capturing changes nothing in jsdom anyway: the drags listen on the window.
if (typeof Reflect.get(Element.prototype, "setPointerCapture") !== "function") {
  Object.assign(Element.prototype, {
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
  });
}

// jsdom has <dialog> but not showModal() or close(). Opening one sets `open`; closing clears it and
// fires "close", as browsers do. Esc's "cancel" event the tests fire themselves.
if (typeof Reflect.get(HTMLDialogElement.prototype, "showModal") !== "function") {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
    close(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
}
