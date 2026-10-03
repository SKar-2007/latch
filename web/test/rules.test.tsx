import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppProvider } from "@/app/AppProvider";
import { AppShell } from "@/app/AppShell";
import { UNCONFIGURED, isConfigured } from "@/core/addresses";
import { readClient, writeClient } from "@/core/chain";

/**
 * D9 and D10, the two rules with no feature component to render them.
 *
 * D1–D8 are asserted against the components that hold them (decoder, builder, wallet, execute).
 * These two live in `core/`, so they are asserted structurally instead: what the chain clients are
 * configured to do, what the source is allowed to contain, and what the shell does when it has no
 * address to author against. Every failure reports `file:line` or an exact value, so it names the
 * change rather than describing a smell.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const SRC = path.join(WEB_ROOT, "src");
const SCANNED = new Set([".ts", ".tsx"]);

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
const rel = (file: string): string => path.relative(WEB_ROOT, file);
const read = (file: string): string => readFileSync(file, "utf8");

/** Every source file, with `file:line: text` for each match. */
function hits(pattern: RegExp, allow: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const file of FILES) {
    if (allow(file)) continue;
    read(file)
      .split("\n")
      .forEach((line, index) => {
        if (pattern.test(line)) out.push(`${rel(file)}:${index + 1}: ${line.trim()}`);
      });
    pattern.lastIndex = 0;
  }
  return out;
}

const ADDRESS_LITERAL = /\b0x[0-9a-fA-F]{40}\b/;

describe("D10 — addresses are pinned configuration, never discovered or invented", () => {
  it("has one representation of 'not configured', and it cannot pass for an address", () => {
    expect(UNCONFIGURED).toBe("");
    expect(isConfigured(UNCONFIGURED)).toBe(false);
    // A plausible stand-in is exactly what the rule forbids, so the guard is length plus prefix.
    expect(isConfigured(UNCONFIGURED.repeat(42))).toBe(false);
    expect(isConfigured("0x1234")).toBe(false);
    expect(isConfigured("0x1234567890123456789012345678901234567890")).toBe(true);
  });

  it("keeps every address literal in the one file that pins them", () => {
    const PINNED = path.join("core", "addresses.ts");
    const offenders = hits(ADDRESS_LITERAL, (file) => file.endsWith(PINNED));
    expect(offenders.join("\n")).toBe("");
  });

  it("refuses to author a batch when there is no account to author it against", async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <AppShell />
      </AppProvider>,
    );

    // The empty plan before anything is asked of the app.
    expect(screen.getByText(/no batch built yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /build batch/i }));

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("NO_ACCOUNT");
    expect(notice).toHaveTextContent(/connect a wallet first/i);
    // Nothing was built, so no fabricated plan is on the page to be mistaken for a real one.
    expect(screen.getByText(/no batch built yet/i)).toBeInTheDocument();
  });
});

describe("D9 — reads fall back, writes do not", () => {
  const transportOf = (client: unknown): Record<string, unknown> => {
    const transport = (client as { transport: Record<string, unknown> }).transport;
    return transport;
  };

  it("keeps the write client on a single provider with no rotation", () => {
    const write = transportOf(writeClient);
    // A `fallback` transport retries a timed-out call against the next provider. That is correct
    // for a read and is how a transaction gets sent twice, so the write client must never have one.
    expect(write.type).toBe("http");
    expect(write.timeout).toBe(15_000);
    expect(write.retryCount).toBe(1);
  });

  it("gives reads the opposite policy, so a stale timeout is not a duplicate", () => {
    const read = transportOf(readClient);
    expect(read.timeout).toBe(10_000);
    expect(read.retryCount).toBe(3);
  });

  it("builds the read transport from the fallback list and the write transport from one URL", () => {
    const source = read(path.join(SRC, "core", "chain.ts"));
    const writeAt = source.indexOf("export const writeClient");
    const readAt = source.indexOf("export const readClient");
    // Both anchors must be found, or the slices below would be measuring an absent declaration.
    expect(writeAt).toBeGreaterThan(0);
    expect(readAt).toBeGreaterThan(0);

    const writeBlock = source.slice(writeAt);
    expect(writeBlock).not.toContain("fallback(");
    expect(writeBlock).toContain("RPC_URLS[0]");
    // The read side is the only one allowed to rotate.
    expect(source.slice(0, readAt)).toContain("fallback(");
  });

  it("never broadcasts through a viem client — submission is the injected wallet's job", () => {
    // The viem write client exists to wait for a receipt, which is a read.
    const writeUsages = hits(/writeClient\s*\./, () => false);
    expect(writeUsages.length).toBeGreaterThan(0);
    for (const usage of writeUsages) {
      expect(usage, `${usage} is not a receipt wait`).toMatch(/waitForTransactionReceipt/);
    }

    // And a file that broadcasts must not be a file that owns the viem client: the two paths are
    // separate on purpose, so a receipt wait and a submission can never be the same call.
    const broadcasters = FILES.filter((file) =>
      read(file).includes('method: "eth_sendTransaction"'),
    );
    expect(broadcasters.length).toBeGreaterThan(0);
    for (const file of broadcasters) {
      expect(read(file), `${rel(file)} broadcasts and owns the write client`).not.toContain(
        "writeClient",
      );
    }
  });
});
