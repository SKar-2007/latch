import { decodeAbiParameters } from "viem";
import {
  ConstraintType,
  InputParamFetcherType,
  InputParamType,
  OutputParamFetcherType,
  type ComposableExecution,
  type Constraint,
  type Hex,
} from "./types";
import { isPredicate } from "./builder";
import { asBytes, asTuple, asUint, decodeConstraintArray, decodeExecutions } from "./abi";
import { decodeBare, tupleOf, type SolValue } from "./abiCodec";

/**
 * Decode an `OR` constraint's sub-constraints, for callers that want the structure rather than the
 * rendered text, so a UI can list the alternatives individually.
 */
export function decodeOrSubs(referenceData: Hex) {
  return decodeConstraintArray(referenceData);
}

/**
 * The decoder.
 *
 * Its job is to make a batch reviewable by a person, and the failure mode that matters is not a
 * crash. It is a rendering that is confidently wrong: a green tick on a check that never ran, a
 * resolved value shown as though it were known, or `GTE 1000` and `LTE 1000` rendered identically.
 * Every one of those produces a user who signs something other than what they read.
 *
 * So this module never invents a value it does not have, and it never collapses a comparison to a
 * boolean. Three rules, from docs/06-frontend-blueprint.md:
 *
 *   1. `SKIP` renders as "not checked", never as a pass.
 *   2. The actual operator is shown. A gate is not a boolean.
 *   3. A `STATIC_CALL` fetcher's value is unknown until execution. Show the call, never the result,
 *      even when a simulation has already produced one.
 */

/** How a gate should be drawn. Deliberately not a boolean. */
export type GateVerdict =
  | { readonly kind: "checked"; readonly label: string }
  | { readonly kind: "not-checked"; readonly label: string }
  | { readonly kind: "any-of"; readonly label: string; readonly subs: readonly string[] }
  | { readonly kind: "undecodable"; readonly label: string; readonly reason: string };

export interface GateView {
  /** Which param's value this gate checks, and which 32-byte word of it. */
  readonly paramIndex: number;
  readonly wordIndex: number;
  readonly constraintType: ConstraintType;
  readonly verdict: GateVerdict;
}

export type ParamSource =
  /** Known at signing time. Safe to display as a value. */
  | { readonly kind: "literal"; readonly label: string }
  /** Resolved on-chain at execution. The value is not known now. */
  | { readonly kind: "runtime"; readonly label: string }
  /** A BALANCE gate. Also runtime, but named so the UI can show the account. */
  | { readonly kind: "balance"; readonly label: string }
  | { readonly kind: "opaque"; readonly label: string; readonly reason: string };

export interface DescribeOptions {
  /**
   * Maps an address to a human name. Supplied by the caller, never inferred.
   *
   * An unknown address renders as its literal hex. Guessing a name from a partial match is how a
   * review screen ends up asserting something the chain never said.
   */
  readonly names?: Readonly<Record<string, string>>;
}

export interface StepView {
  readonly index: number;
  readonly functionSig: Hex;
  /** Named target, when the caller supplied a table. Never guessed from an unknown address. */
  readonly target: string | undefined;
  readonly isPredicate: boolean;
  readonly params: readonly ParamView[];
  readonly gates: readonly GateView[];
  readonly captures: readonly string[];
}

export interface ParamView {
  readonly index: number;
  readonly paramType: InputParamType;
  readonly source: ParamSource;
}

const CONSTRAINT_LABEL: Record<number, string> = {
  [ConstraintType.EQ]: "=",
  [ConstraintType.GTE]: "≥",
  [ConstraintType.LTE]: "≤",
  [ConstraintType.GTE_SIGNED]: "≥ (signed)",
  [ConstraintType.LTE_SIGNED]: "≤ (signed)",
};

function uint(hex: Hex): bigint {
  return BigInt(hex);
}

/** Reinterpret a 256-bit word as a two's-complement signed integer. */
function toSigned(raw: bigint): bigint {
  return raw >= 1n << 255n ? raw - (1n << 256n) : raw;
}

function signedWord(hex: Hex): bigint {
  return toSigned(BigInt(hex));
}

/**
 * Render one constraint for human review.
 *
 * Exported because a UI renders gates in isolation -- a summary row, a tooltip, a diff between two
 * batches -- and should not have to reconstruct a whole batch to describe one comparison.
 */
export function describeConstraint(c: Constraint): GateVerdict {
  return renderOne(c);
}

function renderOne(c: Constraint): GateVerdict {
  const len = (c.referenceData.length - 2) / 2;

  switch (c.constraintType) {
    case ConstraintType.EQ:
      return checked(CONSTRAINT_LABEL[ConstraintType.EQ]!, uint(c.referenceData));
    case ConstraintType.GTE:
      return checked(CONSTRAINT_LABEL[ConstraintType.GTE]!, uint(c.referenceData));
    case ConstraintType.LTE:
      return checked(CONSTRAINT_LABEL[ConstraintType.LTE]!, uint(c.referenceData));
    case ConstraintType.GTE_SIGNED:
      return checked(CONSTRAINT_LABEL[ConstraintType.GTE_SIGNED]!, signedWord(c.referenceData));
    case ConstraintType.LTE_SIGNED:
      return checked(CONSTRAINT_LABEL[ConstraintType.LTE_SIGNED]!, signedWord(c.referenceData));

    case ConstraintType.IN:
    case ConstraintType.IN_SIGNED: {
      // Two static 32-byte words, matching `abi.decode(referenceData, (bytes32, bytes32))`.
      // Not an ABI-encoded array: that is 128 bytes and the engine's length check expects 64.
      const lo = BigInt(`0x${c.referenceData.slice(2, 66)}`);
      const hi = BigInt(`0x${c.referenceData.slice(66)}`);
      const signedRange = c.constraintType === ConstraintType.IN_SIGNED;
      const show = signedRange ? toSigned : (x: bigint) => x;
      return {
        kind: "checked",
        label: `within${signedRange ? " (signed)" : ""} ${show(lo)} … ${show(hi)}`,
      };
    }

    case ConstraintType.SKIP:
      // Rule 1. Not a pass. A green tick here would tell the user a field was verified when it
      // never was, which is the single most damaging thing this renderer could do.
      return { kind: "not-checked", label: "not checked (SKIP)" };

    case ConstraintType.OR: {
      const subs = decodeOrLabels(c.referenceData);
      return { kind: "any-of", label: "any of", subs };
    }

    default:
      return {
        kind: "undecodable",
        label: "unknown constraint",
        reason: `constraintType ${c.constraintType} is outside the enum`,
      };
  }
}

/**
 * Render a satisfied-shape comparison with its own operator.
 *
 * The operator is a required argument rather than looked up, so a new constraint type cannot be added
 * without deciding how it reads. Collapsing these to a tick is what this whole module avoids.
 */
function checked(operator: string, value: bigint): GateVerdict {
  return { kind: "checked", label: `${operator} ${value}` };
}

function decodeOrLabels(referenceData: Hex): readonly string[] {
  try {
    return decodeConstraintArray(referenceData).map((row) => {
      const v = renderOne({
        constraintType: row.constraintType as Constraint["constraintType"],
        referenceData: row.referenceData,
      });
      return v.kind === "checked" || v.kind === "not-checked" ? v.label : "undecodable";
    });
  } catch {
    return ["undecodable"];
  }
}

function describeEntry(
  e: ComposableExecution,
  i: number,
  options: DescribeOptions = {},
): StepView {
  const params: ParamView[] = [];
  const gates: GateView[] = [];

  for (const [pi, p] of e.inputParams.entries()) {
    params.push({ index: pi, paramType: p.paramType, source: describeParam(p) });

    for (const [ci, c] of p.constraints.entries()) {
      gates.push({
        paramIndex: pi,
        wordIndex: ci,
        constraintType: c.constraintType,
        verdict: renderOne(c),
      });
    }
  }

  const targetParam = e.inputParams.find((p) => p.paramType === InputParamType.TARGET);

  return {
    index: i,
    functionSig: e.functionSig,
    target: targetParam ? nameOf(targetParam.paramData, options.names) : undefined,
    isPredicate: isPredicate(e),
    params,
    gates,
    captures: e.outputParams.map(describeCapture),
  };
}

function nameOf(paramData: Hex, names: DescribeOptions["names"]): string {
  // A `TARGET` param is a 32-byte word with the address in its low-order 20 bytes.
  const addr = `0x${paramData.slice(-40)}`;
  const named = names?.[addr.toLowerCase()] ?? names?.[addr];
  return named ?? addr;
}

function describeParam(p: {
  paramType: InputParamType;
  fetcherType: InputParamFetcherType;
  paramData: Hex;
}): ParamSource {
  switch (p.fetcherType) {
    case InputParamFetcherType.RAW_BYTES: {
      if (p.paramType === InputParamType.TARGET) return { kind: "literal", label: nameOf(p.paramData, undefined) };
      if (p.paramType === InputParamType.VALUE) {
        return { kind: "literal", label: `${uint(p.paramData)} wei` };
      }
      return { kind: "literal", label: p.paramData };
    }

    case InputParamFetcherType.BALANCE: {
      // Rule 3. The balance does not exist until execution. Naming the token and account is useful;
      // printing a number here would not be.
      const token = `0x${p.paramData.slice(2, 42)}`;
      const account = `0x${p.paramData.slice(42, 82)}`;
      const label =
        token === "0x0000000000000000000000000000000000000000"
          ? `native balance of ${account}`
          : `balance of ${token} held by ${account}`;
      return { kind: "balance", label };
    }

    case InputParamFetcherType.STATIC_CALL: {
      try {
        const [addr, data] = decodeAbiParameters([{ type: "address" }, { type: "bytes" }], p.paramData);
        return { kind: "runtime", label: `result of ${addr}.${data.slice(0, 10)}()` };
      } catch (cause) {
        return { kind: "opaque", label: "static call", reason: String(cause) };
      }
    }

    default:
      return { kind: "opaque", label: "unknown fetcher", reason: `fetcherType ${p.fetcherType as number}` };
  }
}

function describeCapture(o: { fetcherType: OutputParamFetcherType; paramData: Hex }): string {
  if (o.fetcherType === OutputParamFetcherType.EXEC_RESULT) {
    try {
      const fields = asTuple(
        decodeBare(
          o.paramData,
          tupleOf([
            { t: "uint", v: 0n },
            { t: "address", v: "0x0000000000000000000000000000000000000000" },
            { t: "bytesN", v: `0x${"00".repeat(32)}`, n: 32 },
          ] as SolValue[]),
        ),
      );
      const returnValues = asUint(fields[0]!);
      const storageKey = asBytes(fields[2]!);
      return `captures ${returnValues} word(s) under key ${storageKey}`;
    } catch {
      return "capture (undecodable)";
    }
  }
  return `static-call capture (${(o.paramData.length - 2) / 2} bytes)`;
}

/** Decode ABI-encoded `ComposableExecution[]` calldata back into reviewable steps. */
export function decodeBatch(data: Hex, options: DescribeOptions = {}): readonly StepView[] {
  // `decodeExecutions` already narrows `functionSig` back to 4 bytes.
  return decodeExecutions(data).map((e, i) => describeEntry(e, i, options));
}
