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
