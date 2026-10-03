import { keccak256, toHex } from "viem";
import { describeConstraint, type Constraint, type ConstraintType } from "@latch/client";

/**
 * Revert reasons, mapped to something a person can act on.
 *
 * Rule D7, and it is the rule this file exists for: **a bare error selector is not an error
 * message.** `ConstraintNotMet` tells a user that something they did not choose failed, and nothing
 * about which of the four gates it was. "The output was below the 0.5% floor you signed — raise the
 * tolerance or retry" tells them what to do next.
 *
 * The distinction matters more here than in a normal dApp because the whole product is a set of
 * gates. A user who cannot tell which gate failed cannot tell whether the batch was safe, and a batch
 * that looks safe and was not is the exact failure this project exists to prevent.
 *
 * Two honesty rules run through it:
 *
 *   - An unrecognised revert says so. It does not guess. A plausible invented sentence about a
 *     selector we do not recognise is worse than an honest "unknown", because the user acts on it.
 *   - The raw selector stays available underneath. The mapped sentence is the headline; the selector
 *     is the evidence, and a support engineer needs it.
 *
 * The error set is the twelve documented ERC-8211 errors, transcribed from
 * `ComposableExecutionLib` and cross-checked against `test/fork/EncodingFuzz.t.sol`.
 */

/** How much we actually know about a revert. Drives the tone of the panel. */
export type RevertKind =
  /** One of the twelve documented errors, and we know which. */
  | "documented"
  /** A Solidity `Panic(uint256)`. */
  | "panic"
  /** A `require`/`revert` string. */
  | "string"
  /**
   * Empty return data.
   *
   * V-21 and V-22 both land here: an empty `STATIC_CALL` return routed into `VALUE`, and a capture
   * asking for more words than the call returned. Both produce a blank revert, so "the batch reverted
   * with no reason" is the most that can honestly be said.
   */
  | "empty"
  /** Nothing matched. */
  | "unknown";

export interface RevertExplanation {
  readonly kind: RevertKind;
  /** Short label for the heading. Never a selector on its own. */
  readonly title: string;
  /** The actionable sentence. Says what happened and what the user can do. */
  readonly detail: string;
  /** The bound or gate involved, when we can name it. This is what makes the message actionable. */
  readonly gate?: string;
  /** The selector or panic code, kept as evidence. */
  readonly raw: string;
}

/** `keccak256(sig)[0:4]`, computed rather than pasted so a typo cannot survive review. */
function selectorOf(signature: string): string {
  return keccak256(toHex(signature)).slice(0, 10);
}

/** The twelve documented ERC-8211 errors, with the signature each one carries. */
const DOCUMENTED = {
  ConstraintNotMet: selectorOf("ConstraintNotMet(uint8)"),
  InvalidConstraintType: selectorOf("InvalidConstraintType()"),
  InvalidReferenceDataLength: selectorOf("InvalidReferenceDataLength()"),
  InvalidConstraintRange: selectorOf("InvalidConstraintRange()"),
  EmptyOrSubConstraints: selectorOf("EmptyOrSubConstraints()"),
  InsufficientRawValue: selectorOf("InsufficientRawValue()"),
  InvalidParameterEncoding: selectorOf("InvalidParameterEncoding(string)"),
  InvalidSetOfInputParams: selectorOf("InvalidSetOfInputParams(string)"),
  ComposableExecutionFailed: selectorOf("ComposableExecutionFailed()"),
  InvalidOutputParamFetcherType: selectorOf("InvalidOutputParamFetcherType()"),
  Output_StaticCallFailed: selectorOf("Output_StaticCallFailed()"),
  InsufficientReturnData: selectorOf("InsufficientReturnData()"),
} as const;

const PANIC = selectorOf("Panic(uint256)");
const ERROR_STRING = selectorOf("Error(string)");

/** ConstraintType ordinals, mirrored from the Solidity enum. */
const CONSTRAINT_TYPE: Record<number, ConstraintType> = {
  0: "EQ",
  1: "GTE",
  2: "LTE",
  3: "IN",
  4: "GTE_SIGNED",
  5: "LTE_SIGNED",
  6: "OR",
  7: "SKIP",
  8: "IN_SIGNED",
} as unknown as Record<number, ConstraintType>;

/**
 * Human phrasing for what a gate demands.
 *
 * Built on the client's `describeConstraint` rather than a second implementation, so the sentence in
 * the error panel and the gate drawn in the preview cannot drift apart. If they disagreed, the user
 * would be told to change a bound that the preview is not even showing.
 */
function describeDemand(constraint: Constraint): string {
  const rendered = describeConstraint(constraint);
  const label = "label" in rendered ? rendered.label : null;
  if (label === null) return "a comparison this client cannot describe";

  // `= 1000` reads as a demand once it is phrased as one.
  const [operator = "", ...rest] = label.split(" ");
  const value = rest.join(" ");
  switch (operator) {
    case "=":
      return `exactly ${value}`;
    case "≥":
      return `at least ${value}`;
    case "≤":
      return `at most ${value}`;
    case "within":
      return label;
    default:
      return label;
  }
}

/**
 * Options for narrowing a message to the batch the user is actually looking at.
 *
 * Supplied by the caller, never discovered. `docs/06` rule D10 is about addresses; the same principle
 * applies here — if we cannot name the gate from data we were handed, we say the gate failed rather
 * than inventing which one.
 */
export interface RevertContext {
  /** Every gate in the batch, in order. Used to pick the most likely culprit. */
  readonly gates?: readonly Constraint[];
  /** Slippage in basis points, so a floor message can quote the user's own number. */
  readonly slippageBps?: number;
}

function decodeWord(data: string, wordIndex: number): bigint | undefined {
  const start = 10 + wordIndex * 64;
  const slice = data.slice(start, start + 64);
  if (slice.length < 64) return undefined;
  return BigInt(`0x${slice}`);
}

function decodeString(data: string): string | undefined {
  // Error(string): offset, length, then the bytes.
  const offset = decodeWord(data, 0);
  const length = decodeWord(data, 1);
  if (offset === undefined || length === undefined) return undefined;
  const from = 10 + Number(offset) * 2 + 64;
  const hex = data.slice(from, from + Number(length) * 2);
  if (hex.length < Number(length) * 2) return undefined;
  try {
    const bytes = new Uint8Array(Number(length));
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/** Solidity panic codes we can say something useful about. */
const PANIC_MEANING: Record<string, string> = {
  "0x00": "a generic compiler-inserted panic",
  "0x11": "an arithmetic overflow or underflow",
  "0x12": "a division or modulo by zero",
  "0x21": "an invalid enum value reached the contract",
  "0x31": "a `pop()` on an empty array",
  "0x32": "an array index past its length",
  "0x41": "too much memory was allocated",
  "0x51": "a zero-initialised function pointer was called",
};

/**
 * Turn raw revert data into something a person can act on.
 *
 * `data` is the raw return data from the call: `"0x"` for a blank revert, or a selector followed by
 * ABI-encoded arguments.
 */
export function explainRevert(data: string, context: RevertContext = {}): RevertExplanation {
  const raw = data.length > 0 ? data : "0x";

  if (raw === "0x" || raw.length < 10) {
    // V-21 and V-22. Named rather than guessed at.
    return {
      kind: "empty",
      title: "Reverted with no reason",
      detail:
        "The module reverted without returning data. This is a known failure shape (V-21, V-22), not " +
        "a message from your batch: a static call that returned nothing, or a capture that asked for " +
        "more words than the call produced. Nothing was committed. Re-run the simulation, and if it " +
        "persists, treat it as a module bug rather than a bound you chose.",
      raw,
    };
  }

  const selector = raw.slice(0, 10).toLowerCase();

  if (selector === PANIC) {
    const code = decodeWord(raw, 0);
    const meaning = code === undefined ? undefined : PANIC_MEANING[`0x${code.toString(16)}`];
    return {
      kind: "panic",
      title: "Contract panicked",
      detail:
        meaning === undefined
          ? "The module hit an unrecoverable Solidity panic. This is a module-level fault, not a bound you set."
          : `The module panicked: ${meaning}. This is a module-level fault, not a bound you set — nothing you configured causes it.`,
      raw: `Panic(0x${(code ?? 0n).toString(16)})`,
    };
  }

  if (selector === ERROR_STRING) {
    const message = decodeString(raw);
    return {
      kind: "string",
      title: "Reverted",
      detail:
        message === undefined
          ? "The module reverted with a message this client could not decode."
          : `The module reverted: ${message}`,
      raw,
    };
  }

  if (selector === DOCUMENTED.ConstraintNotMet) {
    return explainConstraintNotMet(raw, context);
  }

  const documented = explainDocumented(selector);
  if (documented !== undefined) return { ...documented, raw };

  return {
    kind: "unknown",
    title: "Unrecognised revert",
    detail:
      "The module reverted with a reason this client does not recognise. It is shown below exactly as " +
      "received. No bound you set can be identified from it, so do not assume the batch was safe.",
    raw,
  };
}

/**
 * `ConstraintNotMet` is the one error worth real effort: it is the expected failure for every gate,
 * and the difference between a useful and a useless message is naming the gate.
 */
function explainConstraintNotMet(raw: string, context: RevertContext): RevertExplanation {
  const ordinal = decodeWord(raw, 0);
  const type = ordinal === undefined ? undefined : CONSTRAINT_TYPE[Number(ordinal)];

  const gate = pickGate(context.gates, type);
  const demand = gate === undefined ? undefined : describeDemand(gate);

  const slippage =
    context.slippageBps === undefined ? undefined : `${(context.slippageBps / 100).toFixed(2)}%`;

  let detail: string;
  if (demand !== undefined && slippage !== undefined) {
    detail =
      `A gate failed: the resolved value had to be ${demand}. If this is the output floor, the swap ` +
      `returned less than the ${slippage} tolerance you signed — raise the tolerance or retry. If it is ` +
      `a freshness or balance check, the chain state moved since you signed and re-running is safe.`;
  } else if (demand !== undefined) {
    detail = `A gate failed: the resolved value had to be ${demand}. Re-run the simulation; if it persists, the bound you set is not reachable.`;
  } else {
    detail =
      "A constraint was not met, but this client cannot say which one. Nothing was committed. Re-run " +
      "the simulation and compare the gates in the preview against the chain's current state.";
  }

  const explanation: RevertExplanation = {
    kind: "documented",
    title: "A gate failed",
    detail,
    raw,
  };

  // `exactOptionalPropertyTypes` means the key must be absent rather than set to undefined, so the
  // branch is explicit rather than a spread of a conditional object.
  return demand === undefined ? explanation : { ...explanation, gate: demand };
}

/**
 * Choose the gate to blame.
 *
 * If the revert names the constraint type, prefer a gate of that type — an exact match is better than
 * a plausible one. Otherwise fall back to the first gate, because in practice the first gate to fail
 * is the one that reverted, but say only what we know: the caller gets the demand, not a claim about
 * which step failed.
 */
function pickGate(
  gates: readonly Constraint[] | undefined,
  type: ConstraintType | undefined,
): Constraint | undefined {
  if (gates === undefined || gates.length === 0) return undefined;
  if (type === undefined) return gates[0];
  return gates.find((gate) => gate.constraintType === type) ?? gates[0];
}

function explainDocumented(selector: string): Omit<RevertExplanation, "raw"> | undefined {
  switch (selector) {
    case DOCUMENTED.InsufficientRawValue:
      return {
        kind: "documented",
        title: "A gate checked a value that was too short",
        detail:
          "A constraint was applied to a word the resolved value did not supply. The batch is " +
          "malformed rather than unmet — re-run the build. Nothing was committed.",
      };
    case DOCUMENTED.EmptyOrSubConstraints:
      return {
        kind: "documented",
        title: "An 'any of' gate can never pass",
        detail:
          "One of the gates was an OR with no alternatives, so it could never be satisfied. This is a " +
          "bug in the batch you built, not in your settings. Nothing was committed.",
      };
    case DOCUMENTED.InvalidConstraintRange:
      return {
        kind: "documented",
        title: "A range gate is upside down",
        detail:
          "A range bound had its lower limit above its upper limit, so no value could satisfy it. Widen " +
          "or reorder the bound. Nothing was committed.",
      };
    case DOCUMENTED.InvalidReferenceDataLength:
    case DOCUMENTED.InvalidConstraintType:
    case DOCUMENTED.InvalidParameterEncoding:
    case DOCUMENTED.InvalidSetOfInputParams:
    case DOCUMENTED.InvalidOutputParamFetcherType:
      return {
        kind: "documented",
        title: "The batch is malformed",
        detail:
          "The module rejected the batch's encoding before executing anything. Nothing was committed " +
          "and no funds moved. Re-run the build; if it persists, the batch builder produced something " +
          "the module cannot accept.",
      };
    case DOCUMENTED.ComposableExecutionFailed:
    case DOCUMENTED.Output_StaticCallFailed:
      return {
        kind: "documented",
        title: "A call inside the batch failed",
        detail:
          "One of the calls the batch made reverted. The whole batch unwound, so nothing was " +
          "committed — the atomicity guarantee held. Check the step's own preconditions.",
      };
    case DOCUMENTED.InsufficientReturnData:
      return {
        kind: "documented",
        title: "A call returned fewer words than expected",
        detail:
          "The batch tried to capture more words than a call actually produced. Nothing was committed. " +
          "This is a known failure shape (V-22).",
      };
    default:
      return undefined;
  }
}

/**
 * True when the explanation is one the user can act on rather than merely observe.
 *
 * `unknown` and `empty` are honest but not actionable, so the panel shows them differently: the
 * point is never to dress up "we do not know" as a fix.
 */
export function isActionable(explanation: RevertExplanation): boolean {
  return explanation.kind !== "unknown";
}