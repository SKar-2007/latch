import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Seat H: the identity, enforced mechanically.
 *
 * docs/identity.md and the brief's hard rules are prose; this file is the check that runs on every
 * build. Each rule reports every offender as `file:line: what`, so a failure names the work rather
 * than describing a smell.
 *
 * Decisions taken where the rules could be read two ways, all of them deliberate:
 *
 *   - Colour literals are scanned in raw source, comments included. A hex restated in a comment is
 *     still a second copy of a value that can drift from `tokens.css`.
 *   - `transparent` and `currentColor` are keywords, not literals, and are not matched.
 *   - `box-shadow: none` is the removal of a shadow and carries no colour or geometry, so it is
 *     allowed outside `tokens.css`. Every other `box-shadow` value must be `var(--shadow*)`.
 *   - The `rgba(11, 11, 11, …)` grid lines in `base.css` are **not** waived. `11,11,11` is `--c-ink`
 *     (`#0b0b0b`) written out again, which is exactly the second source of truth the rule forbids;
 *     the grid wants a token of its own. Reported as a defect rather than excused.
 *   - Emoji are matched on Unicode pictograph ranges plus the legacy singles, so text glyphs the
 *     decoder legitimately uses (`✓ ✕ → ≠ ≥ · —`) are not emoji and are not flagged.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const SRC = path.join(WEB_ROOT, "src");
const TOKENS = path.join(SRC, "styles", "tokens.css");
const UI_CSS = path.join(SRC, "components", "ui", "ui.css");
const DECODER = path.join(SRC, "features", "decoder");

const SCANNED = new Set([".ts", ".tsx", ".css"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SCANNED.has(path.extname(entry))) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).sort();
const relative = (file: string): string => path.relative(WEB_ROOT, file);
const report = (offenders: readonly string[]): string => offenders.join("\n");

/** `#RGB`, `#RRGGBB`, `#RRGGBBAA` (and the 4-digit form) plus `rgb(`/`hsl(` functions. */
const RAW_COLOUR =
  /#[0-9a-fA-F]{8}(?![0-9a-fA-F])|#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{4}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F])|\b(?:rgb|rgba|hsl|hsla)\(/g;

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{2764}\u{2705}\u{274C}\u{2728}\u{2B50}\u{2B1B}\u{2B1C}\u{2795}-\u{2797}\u{26A0}\u{26A1}\u{23F3}\u{231A}\u{231B}]/u;

/** Blank a comment out while keeping its newlines, so reported line numbers stay true. */
const blank = (chunk: string): string => chunk.replace(/[^\n]/g, " ");
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/[^\n]*/g, blank);

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

describe("the design system is tokenised", () => {
  it("declares no raw colour outside src/styles/tokens.css", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file === TOKENS) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const match of line.matchAll(RAW_COLOUR)) {
          offenders.push(`${relative(file)}:${index + 1}: ${match[0]} in \`${line.trim()}\``);
        }
      });
    }
    expect(report(offenders)).toBe("");
  });

  it("declares no border-radius but 0 or var(--radius)", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file === TOKENS) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const match = /border-radius\s*:\s*([^;}]+)/.exec(line);
        if (match === null) return;
        const value = (match[1] ?? "").trim();
        if (/^(?:0|0px|var\(--radius\))$/.test(value)) return;
        offenders.push(`${relative(file)}:${index + 1}: border-radius: ${value}`);
      });
    }
    expect(report(offenders)).toBe("");
  });

  it("declares no box-shadow outside tokens.css except removal of one", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file === TOKENS) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const match = /box-shadow\s*:\s*([^;}]+)/.exec(line);
        if (match === null) return;
        const value = (match[1] ?? "").trim();
        if (value === "none") return;
        if (/^var\(--shadow[\w-]*\)$/.test(value)) return;
        offenders.push(`${relative(file)}:${index + 1}: box-shadow: ${value}`);
      });
    }
    expect(report(offenders)).toBe("");
  });

  it("contains no emoji anywhere under web/src (C4)", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(new RegExp(EMOJI, "gu"))) {
        offenders.push(
          `${relative(file)}:${lineOf(text, match.index ?? 0)}: ${match[0]} in \`${text
            .slice(match.index ?? 0, (match.index ?? 0) + 40)
            .split("\n")[0]}\``,
        );
      }
    }
    expect(report(offenders)).toBe("");
  });
});

describe("D4: the decoder never claims an outcome", () => {
  it("uses no GateTone \"pass\" or \"blocked\" in features/decoder", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (!file.startsWith(DECODER + path.sep)) continue;
      const raw = readFileSync(file, "utf8");
      const text = stripComments(raw);
      for (const match of text.matchAll(/(["'`])(?:pass|blocked)\1|ui-gate--(?:pass|blocked)/g)) {
        offenders.push(
          `${relative(file)}:${lineOf(text, match.index ?? 0)}: ${match[0]} in \`${text
            .slice(Math.max(0, (match.index ?? 0) - 30), (match.index ?? 0) + 30)
            .split("\n")
            .join(" ")}\``,
        );
      }
    }
    expect(report(offenders)).toBe("");
  });
});

/* ------------------------------------------------------------------ contrast */

/** First `--c-<name>: <hex>` wins, so a media-query override cannot silently change a rule. */
function colourTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of stripComments(readFileSync(TOKENS, "utf8")).matchAll(
    /(--c-[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g,
  )) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined && !(name in out)) out[name] = value;
  }
  return out;
}

/** Declarations of the first rule whose selector list is exactly the one asked for. */
function rule(css: string, selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|,|\\s)${esc}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (match === null) return {};
  const out: Record<string, string> = {};
  for (const decl of (match[1] ?? "").split(";")) {
    const pair = /^([\w-]+)\s*:\s*(.+)$/.exec(decl.trim());
    if (pair !== null && pair[1] !== undefined && pair[2] !== undefined) out[pair[1]] = pair[2];
  }
  return out;
}

const resolveColour = (value: string | undefined, tokens: Record<string, string>): string | null => {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  const ref = /var\((--c-[\w-]+)\)/.exec(trimmed);
  return ref?.[1] !== undefined ? (tokens[ref[1]] ?? null) : null;
};

/** WCAG 2.1 relative luminance, then the contrast ratio between two hex colours. */
function contrast(a: string, b: string): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const hex = (s: string): number[] => {
    const clean = s.replace("#", "");
    const full = clean.length === 3 ? [...clean].map((c) => c + c).join("") : clean;
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
  };
  const lum = (s: string): number => {
    const [r, g, bl] = hex(s);
    return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(bl ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("a chip says what it is where it is used", () => {
  /**
   * `.ui-chip` is the one primitive that renders inside `.ui-panel__header`, whose background is
   * `--c-surface-inverted` and whose colour is `--c-ink-inverted`. A tone that sets only a
   * background inherits that white, so white-on-white ships as an invisible status: SIMULATION's
   * chip rendered as a blank box and EXECUTION's "disconnected" sat at 1.05:1. Resolving the
   * cascade here — base rule, then tone, then the header the chip inherits from — is what makes
   * that failure visible without a browser.
   */
  const tokens = colourTokens();
  const css = stripComments(readFileSync(UI_CSS, "utf8"));
  const headerColour = resolveColour(rule(css, ".ui-panel__header").color, tokens);
  const base = rule(css, ".ui-chip");
  const tones = ["default", ...[...css.matchAll(/\.ui-chip--([a-z]+)\b/g)].map((m) => m[1] ?? "")];

  it("parses a base rule, a header to inherit from, and every tone (not vacuous)", () => {
    expect(Object.keys(base).length).toBeGreaterThan(0);
    expect(headerColour).not.toBeNull();
    expect(new Set(tones).size).toBeGreaterThanOrEqual(5);
    expect(tones.every((tone) => tone === "default" || css.includes(`.ui-chip--${tone}`))).toBe(true);
  });

  it("keeps every tone at 4.5:1 or better against the background it actually gets", () => {
    const offenders: string[] = [];
    for (const tone of tones) {
      const decls = tone === "default" ? base : rule(css, `.ui-chip--${tone}`);
      const background = resolveColour(decls.background ?? base.background, tokens);
      const colour = resolveColour(decls.color ?? base.color, tokens) ?? headerColour;
      if (background === null || colour === null) {
        offenders.push(`.ui-chip--${tone}: could not resolve colour or background`);
        continue;
      }
      const ratio = contrast(colour, background);
      if (ratio < 4.5) {
        offenders.push(
          `.ui-chip--${tone}: ${colour} on ${background} = ${ratio.toFixed(2)}:1 (needs 4.5:1)`,
        );
      }
    }
    expect(report(offenders)).toBe("");
  });
});
