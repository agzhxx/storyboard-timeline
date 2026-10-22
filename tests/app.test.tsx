import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "../src/app/App.tsx";

test("shows the app's name as the page heading", () => {
  render(<App />);

  const heading = screen.getByRole("heading", { level: 1 });
  expect(heading.textContent).toBe("Storyboard Timeline");
});
