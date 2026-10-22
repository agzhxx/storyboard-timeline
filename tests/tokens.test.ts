import { describe, expect, test } from "vitest";
import { WAVEFORM_COLORS } from "../src/timeline/draw.ts";
import editorTokensCss from "../src/app/editor-tokens.css?raw";
import tokensCss from "../src/app/tokens.css?raw";

// Every `--name: value;` in the two token files, comments stripped. Later files win, as in CSS.
const tokens = new Map<string, string>();
for (const css of [tokensCss, editorTokensCss]) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, name, value] of code.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) tokens.set(name, value.trim());
  }
}

/** The color a token ends up as, following `var(--other)` aliases. */
function color(name: string): string {
  const value = tokens.get(`color-${name}`);
  if (value === undefined) throw new Error(`No token --color-${name}`);
  const alias = /^var\(--color-([\w-]+)\)$/.exec(value)?.[1];
  return alias === undefined ? value : color(alias);
}

/** WCAG 2.x relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Not a #rrggbb color: ${hex}`);
  const channel = (start: number) => {
    const c = parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(foreground: string, background: string): number {
  return contrastOf(color(foreground), color(background));
}

function contrastOf(foregroundHex: string, backgroundHex: string): number {
  const a = luminance(foregroundHex);
  const b = luminance(backgroundHex);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("text colors pass WCAG AA (4.5:1) on every surface", () => {
  for (const text of ["fg", "fg-muted", "fg-subtle"]) {
    for (const surface of ["bg", "surface", "surface-raised", "clip"]) {
      test(`${text} on ${surface}`, () => {
        expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  test("text on the accent (primary buttons)", () => {
    expect(contrast("on-accent", "accent")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("marks the editor relies on reach 3:1 (WCAG non-text contrast)", () => {
  const pairs: [mark: string, background: string][] = [
    ["playhead", "bg"],
    ["playhead", "surface"],
    ["selection", "clip"],
    ["focus", "bg"],
    ["snap", "bg"],
    ["waveform", "clip"],
    ["waveform-selected", "clip"],
    ["tick-major", "surface"],
    ["line-strong", "surface"],
    ["danger", "surface"],
    ["danger", "surface-raised"],
  ];
  for (const [mark, background] of pairs) {
    test(`${mark} on ${background}`, () => {
      expect(contrast(mark, background)).toBeGreaterThanOrEqual(3);
    });
  }
});

test("waveforms are drawn in the tokens' colors", () => {
  expect(WAVEFORM_COLORS).toEqual({
    normal: color("waveform"),
    selected: color("waveform-selected"),
  });
});

test("the playhead and a snap line look different", () => {
  expect(color("playhead")).not.toBe(color("snap"));
});
