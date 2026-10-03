import { ConstraintType } from "@latch/client";
import { toFunctionSelector } from "viem";

/**
 * D7: a revert reason is mapped to an actionable sentence (docs/06, UI state machine).
 *
 * A bare `ConstraintNotMet` selector is not an error message, so the selector is only ever shown as
 * *detail underneath* the sentence — never instead of it. The table below is the mapping; anything
 * it does not recognise falls through to an honest "unrecognised selector" sentence rather than to
 * silence, because a silent failure reads like a pass.
 *
 * Selectors are derived from the signatures rather than copied as literals, so the table cannot
 * drift from the contracts it describes:
 *
 * | Signature | Source |
 * |---|---|
 * | `ConstraintNotMet(uint8)` | docs/technical-reference/composable-execution-lib.md. The parameter is `ConstraintType`, which the ABI canonicalises to `uint8` — verified by compiling the declaration and reading the selector out of the bytecode, and by an `eth_call` against the deployed module that reverted with `0xa31844b0` |
 * | `StaleFeed(address,int256,uint256,uint256,uint256)` | `contracts/FeedGuard.sol` (docs/04 shows an abridged one-argument form; the contract is normative) |
 * | `InsufficientOutput(uint256,uint256)`, `ZeroQuote(address,address,uint256,uint24)` | `contracts/QuoterGuard.sol` |
 * | `AccountAccessUnauthorized()` | observed from the deployed Nexus 1.3.1 account |
 * | `ComposableExecutionFailed()`, `Output_StaticCallFailed()` | docs/02 error catalogue |
 *
 * The ERC-20 balance errors are listed in both shapes actually seen in the wild: custom-error
 * tokens (OZ v5 style) and string-reason tokens (the `Error(string)` row below, which is what
 * USDC on Base Sepolia returns: "ERC20: transfer amount exceeds balance").
 */

export interface MappedRevert {
  /** The sentence the user reads first. Full words, always. */
  readonly message: string;
  /** The raw selector and reason, shown underneath as detail and never in place of `message`. */
  readonly revertReason: string;
}

const SENTENCES = {
  constraint: "A bound you set was violated — nothing was executed. Adjust the bound and retry.",
  balance: "The account does not hold enough to cover this step.",
  freshness:
    "The price feed is outside your freshness window — wait for a new round or widen max staleness.",
  output:
    "The output came in below the minimum you set — nothing was executed. Widen the slippage preset or lower the bound.",
  zeroQuote:
    "The quoter returned nothing for this pair, so there is no price to check against. Nothing was executed.",
  staticCall:
    "A read the batch depends on reverted before anything executed — the gate never got to run.",
  access:
    "The account refused this batch: the sender of the call is not one of the entry points the account accepts.",
  panic:
    "The batch hit an internal panic — a contract it calls failed an assertion. Nothing was executed.",
} as const;

interface Entry {
  readonly name: string;
  readonly selector: string;
  readonly sentence: string;
}

function entry(name: string, sentence: string): Entry {
  return { name, selector: toFunctionSelector(name), sentence };
}

const CONSTRAINT_NOT_MET_NAME = "ConstraintNotMet(uint8)";

const TABLE: readonly Entry[] = [
  entry(CONSTRAINT_NOT_MET_NAME, SENTENCES.constraint),
  entry("StaleFeed(address,int256,uint256,uint256,uint256)", SENTENCES.freshness),
  entry("InsufficientOutput(uint256,uint256)", SENTENCES.output),
  entry("ZeroQuote(address,address,uint256,uint24)", SENTENCES.zeroQuote),
  entry("InsufficientBalance()", SENTENCES.balance),
  entry("ERC20InsufficientBalance(address,uint256,uint256)", SENTENCES.balance),
  entry("ComposableExecutionFailed()", SENTENCES.staticCall),
  entry("Output_StaticCallFailed()", SENTENCES.staticCall),
  entry("AccountAccessUnauthorized()", SENTENCES.access),
];

const ERROR_STRING = "Error(string)";
const ERROR_STRING_SELECTOR = toFunctionSelector(ERROR_STRING);
const PANIC_SELECTOR = toFunctionSelector("Panic(uint256)");

/** Ordinal to name, read off the client's own enum so the two cannot drift (V-10). */
const CONSTRAINT_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(ConstraintType).map(([name, value]) => [value, name]),
);

/** Words the ERC-20 string reasons carry. Matched on the decoded text, never on the selector. */
const BALANCE_TEXT = /exceeds balance|insufficient balance|balance too (?:low|small)/i;

const HEX = /^0x[0-9a-fA-F]*$/;

function constraintLabel(raw: string): string {
  const word = raw.slice(10, 74);
  if (word.length < 64) return "ConstraintNotMet";
  let ordinal: number;
  try {
    ordinal = Number(BigInt(`0x${word}`));
  } catch {
    return "ConstraintNotMet";
  }
  const name = CONSTRAINT_NAMES.get(ordinal);
  return name === undefined ? "ConstraintNotMet" : `ConstraintNotMet(${name})`;
}

function fromSelector(raw: string): MappedRevert {
  const selector = raw.slice(0, 10).toLowerCase();

  if (selector === ERROR_STRING_SELECTOR) {
    const reason = decodeErrorString(raw);
    if (reason !== null) {
      if (BALANCE_TEXT.test(reason)) {
        return { message: SENTENCES.balance, revertReason: `${reason} · ${selector}` };
      }
      return {
        message: `Reverted with an unrecognised reason: ${reason}.`,
        revertReason: `${reason} · ${selector}`,
      };
    }
    return { message: `Reverted with an unrecognised selector: ${selector}.`, revertReason: raw };
  }

  if (selector === PANIC_SELECTOR) {
    return { message: SENTENCES.panic, revertReason: `${raw.slice(0, 74)} · ${selector}` };
  }

  const hit = TABLE.find((e) => e.selector === selector);
  if (hit !== undefined) {
    // The constraint that failed is decoded into the detail: the operator is the actionable part
    // and the bare selector would tell the reader nothing.
    const detail =
      hit.name === CONSTRAINT_NOT_MET_NAME
        ? `${constraintLabel(raw)} · ${selector}`
        : `${hit.name} · ${selector}`;
    return { message: hit.sentence, revertReason: detail };
  }

  return { message: `Reverted with an unrecognised selector: ${selector}.`, revertReason: raw };
}

function decodeErrorString(raw: string): string | null {
  // 4-byte selector, 32-byte offset, 32-byte length, then the bytes.
  if (raw.length < 74 + 128) return null;
  try {
    const length = Number(BigInt(`0x${raw.slice(74, 138)}`));
    if (!Number.isFinite(length) || length === 0) return null;
    const start = 138;
    const end = start + length * 2;
    if (raw.length < end) return null;
    const bytes = raw.slice(start, end);
    let out = "";
    for (let i = 0; i < bytes.length; i += 2) {
      out += String.fromCharCode(Number.parseInt(bytes.slice(i, i + 2), 16));
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Map raw revert data — a `0x…` selector blob or a plain reason string — to a sentence plus its
 * detail. Never returns an empty sentence: an unrecognised revert still gets words.
 */
export function mapRevertReason(raw: string | null | undefined): MappedRevert {
  if (raw === null || raw === undefined) {
    return {
      message: "The batch reverted without giving a reason, so there is nothing to act on yet.",
      revertReason: "no revert data",
    };
  }
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "0x") {
    return {
      message: "The batch reverted without giving a reason, so there is nothing to act on yet.",
      revertReason: "no revert data",
    };
  }
  if (HEX.test(trimmed) && trimmed.length >= 10) {
    return fromSelector(trimmed);
  }
  if (BALANCE_TEXT.test(trimmed)) {
    return { message: SENTENCES.balance, revertReason: trimmed };
  }
  return { message: `Reverted with an unrecognised reason: ${trimmed}.`, revertReason: trimmed };
}