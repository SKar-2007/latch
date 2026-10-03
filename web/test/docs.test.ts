import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Seat H: the documentation conventions in README.md (C1–C8), checked against the one document
 * this frontend is written from, `docs/identity.md`.
 *
 * Failures print the offending heading, link or line so the fix is obvious.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const DOCS = path.join(REPO, "docs");
const IDENTITY = path.join(DOCS, "identity.md");
const README = path.join(REPO, "README.md");

const identity = readFileSync(IDENTITY, "utf8");
const readme = readFileSync(README, "utf8");

const relative = (file: string): string => path.relative(REPO, file);

/** Headings and links live in prose; fenced blocks are examples and must not be parsed. */
const withoutFences = (text: string): string =>
  text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "));

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{2764}\u{2705}\u{274C}\u{2728}\u{2B50}\u{2B1B}\u{2B1C}\u{2795}-\u{2797}\u{26A0}\u{26A1}\u{23F3}\u{231A}\u{231B}]/u;

function frontMatter(text: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (block === null) return {};
  const fields: Record<string, string> = {};
  for (const line of (block[1] ?? "").split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (pair !== null) fields[pair[1] ?? ""] = (pair[2] ?? "").trim();
  }
  return fields;
}

describe("C5: front matter", () => {
  it("declares title, status, project and last_reviewed", () => {
    const fields = frontMatter(identity);
    const missing = ["title", "status", "project", "last_reviewed"].filter(
      (key) => (fields[key] ?? "").length === 0,
    );
    expect(
      missing.map((key) => `${relative(IDENTITY)}: front matter is missing \`${key}\``).join("\n"),
    ).toBe("");
  });
});

describe("C4: heading discipline", () => {
  it("goes no deeper than ###", () => {
    const prose = withoutFences(identity);
    const deep: string[] = [];
    for (const match of prose.matchAll(/^(#{1,6})\s+\S.*$/gm)) {
      const depth = (match[1] ?? "").length;
      if (depth > 3) deep.push(`${relative(IDENTITY)}:${lineOf(prose, match.index ?? 0)}: ${match[0]}`);
    }
    expect(deep.join("\n")).toBe("");
  });

  it("has headings at all, so the depth check is not vacuous", () => {
    expect(withoutFences(identity).match(/^#{1,6}\s+\S/gm)?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("C7: reachability", () => {
  it("links identity.md from README.md", () => {
    expect(/\]\(docs\/identity\.md\)/.test(readme)).toBe(true);
  });

  it("keeps every Related documents target on disk", () => {
    const heading = identity.indexOf("## Related documents");
    expect(heading, `${relative(IDENTITY)} has no "## Related documents" section`).toBeGreaterThan(-1);

    const section = withoutFences(identity.slice(heading));
    const targets = [...section.matchAll(/\]\(([^)\s]+)\)/g)]
      .map((match) => match[1] ?? "")
      .filter((target) => !/^(?:[a-z]+:|\/\/|#)/i.test(target));

    expect(targets.length, "the Related documents table named no relative links").toBeGreaterThan(0);

    const missing = targets
      .map((target) => target.split("#")[0] ?? "")
      .filter((target) => target.length > 0 && !existsSync(path.resolve(DOCS, target)))
      .map((target) => `${relative(IDENTITY)}: broken link ${target}`);

    expect(missing.join("\n")).toBe("");
  });
});

describe("C4: no emoji in the prose this product speaks with", () => {
  it("keeps docs/identity.md and README.md pictograph-free", () => {
    const offenders: string[] = [];
    for (const file of [IDENTITY, README]) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(new RegExp(EMOJI, "gu"))) {
        offenders.push(`${relative(file)}:${lineOf(text, match.index ?? 0)}: ${match[0]}`);
      }
    }
    expect(offenders.join("\n")).toBe("");
  });
});
