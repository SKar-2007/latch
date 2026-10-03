import { encodeAbiParameters, isAddress, toHex } from "viem";
import { encode, toTwosComplement, tupleOf, word as uintWord, type SolValue } from "./abiCodec";
import { decodeConstraintArray, encodeConstraintArray, encodeExecutions, selectorOf as sel } from "./abi";
import {
  ConstraintType,
  InputParamFetcherType,
  InputParamType,
  OutputParamFetcherType,
  type ComposableExecution,
  type Constraint,
  type Hex,
  type InputParam,
  type OutputParam,
} from "./types";
import { BuilderErrorCode, fail } from "./errors";
import { MAX_ENTRIES } from "./constants";

// ---------------------------------------------------------------------------------------------
// Input param factories
// ---------------------------------------------------------------------------------------------

/**
 * Normalise an address to lowercase 20-byte hex.
 *
 * `toHex(value, { size: 20 })` is the number overload and rejects an address outright, so addresses
 * are normalised here instead. Case is lowered deliberately: the same address reached through two
 * different entry points has to produce identical bytes, or a namespace or slot derivation keyed on
 * it would fork.
 */
function addr20(address: string): Hex {
  return `0x${address.replace(/^0x/i, "").toLowerCase()}` as Hex;
}

/**
 * The `TARGET` param: which contract the composed call is sent to.
 *
 * At most one per entry, because two targets would mean two different contracts receiving one
 * calldata. The engine rejects the second rather than picking one.
 *
 * `paramData` is a full 32-byte word, not the bare 20-byte address. The module reads it with
 * `abi.decode(processedInput, (address))`, and Solidity's decoder requires 32 bytes for an address.
 * A 20-byte value reverts with empty return data, which is a miserable thing to debug from a
 * transaction receipt: the batch encodes, validates client-side, and dies on-chain with nothing to
 * go on. Found by executing a real batch against the deployed module.
 */
export function target(address: string): InputParam {
  if (!isAddress(address, { strict: false })) {
    fail(BuilderErrorCode.EncodingFailed, `not an address: ${address}`);
  }
  return {
    paramType: InputParamType.TARGET,
    fetcherType: InputParamFetcherType.RAW_BYTES,
    paramData: `0x${addr20(address).slice(2).padStart(64, "0")}` as Hex,
    constraints: [],
  };
}

/** The `VALUE` param: native value attached to the composed call. At most one per entry. */
export function value(amount: bigint | number): InputParam {
  return {
    paramType: InputParamType.VALUE,
    fetcherType: InputParamFetcherType.RAW_BYTES,
    paramData: encodeAbiParameters([{ type: "uint256" }], [BigInt(amount)]),
    constraints: [],
  };
}

/**
 * Literal calldata, concatenated after the function selector.
 *
 * Constraints are compared against the i-th 32-byte word of `data`, which is how a bound is expressed
 * for a value already known at signing time.
 */
export function callData(data: Hex, constraints: readonly Constraint[] = []): InputParam {
  return {
    paramType: InputParamType.CALL_DATA,
    fetcherType: InputParamFetcherType.RAW_BYTES,
    paramData: data,
    constraints,
  };
}

/**
 * `abi.encode(address, bytes)`, the form the `STATIC_CALL` fetcher decodes.
 *
 * The resolved value does not exist until execution, so the client cannot know it. Anything the user
 * needs to see before signing has to come from the call itself, not from a value shown here.
 */
export function staticCall(
  address: string,
  data: Hex,
  constraints: readonly Constraint[] = [],
): InputParam {
  if (!isAddress(address, { strict: false })) {
    fail(BuilderErrorCode.EncodingFailed, `not an address: ${address}`);
  }
  return {
    paramType: InputParamType.CALL_DATA,
    fetcherType: InputParamFetcherType.STATIC_CALL,
    paramData: encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [address as Hex, data]),
    constraints,
  };
}

/**
 * `abi.encodePacked(address token, address account)` — exactly 40 bytes.
 *
 * A `token` of `0x0` means the native balance, per the upstream rule, so a single constraint here
 * can gate a whole batch on holding ETH.
 */
export function balance(
  token: string,
  account: string,
  constraints: readonly Constraint[] = [],
): InputParam {
  const zero = "0x0000000000000000000000000000000000000000";
  if (token !== zero && !isAddress(token, { strict: false })) {
    fail(BuilderErrorCode.EncodingFailed, `not an address: ${token}`);
  }
  if (!isAddress(account, { strict: false })) {
    fail(BuilderErrorCode.EncodingFailed, `not an address: ${account}`);
  }
  if (constraints.length > 1) {
    fail(
      BuilderErrorCode.InvalidSetOfInputParams,
      "BALANCE resolves to exactly one word, so at most one constraint can index it",
    );
  }
  return {
    paramType: InputParamType.CALL_DATA,
    fetcherType: InputParamFetcherType.BALANCE,
    paramData: `${addr20(token)}${addr20(account).slice(2)}` as Hex,
    constraints,
  };
}

// ---------------------------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------------------------

/**
 * One comparison word.
 *
 * Negative values are converted to two's complement first. `abi.encode(uint256)` refuses them, so
 * without this `gteSigned(-1)` would throw instead of encoding the value the chain would compare
 * against -- and the signed variants exist precisely so that negative deltas can be expressed.
 */
const word = (n: bigint | number): Hex => uintWord(toTwosComplement(BigInt(n)));

/**
 * A range, as two *static* words.
 *
 * Upstream does `abi.decode(referenceData, (bytes32, bytes32))`, which is 64 bytes. An ABI-encoded
 * `uint256[]` would also be a valid round trip but is 128 bytes, and the engine's length checks are
 * written against the static form.
 */
const range = (lower: bigint | number, upper: bigint | number): Hex =>
  concatHex(uintWord(toTwosComplement(BigInt(lower))), uintWord(toTwosComplement(BigInt(upper))));

/** Exact equality against word `i`. */
export function eq(expected: bigint | number): Constraint {
  return { constraintType: ConstraintType.EQ, referenceData: word(expected) };
}

/**
 * Unsigned `>=`.
 *
 * Compares `bytes32`, so it passes for every negative two's-complement input. For a value that can
 * legitimately be negative, use `gteSigned`.
 */
export function gte(minimum: bigint | number): Constraint {
  return { constraintType: ConstraintType.GTE, referenceData: word(minimum) };
}

/** Unsigned `<=`. */
export function lte(maximum: bigint | number): Constraint {
  return { constraintType: ConstraintType.LTE, referenceData: word(maximum) };
}

/** Unsigned inclusive range. A lower bound above the upper is rejected as unsatisfiable. */
export function inRange(lower: bigint | number, upper: bigint | number): Constraint {
  return { constraintType: ConstraintType.IN, referenceData: range(lower, upper) };
}

/** Signed `>=`, for deltas that can go below zero. */
export function gteSigned(minimum: bigint | number): Constraint {
  return { constraintType: ConstraintType.GTE_SIGNED, referenceData: word(minimum) };
}

/** Signed `<=`. */
export function lteSigned(maximum: bigint | number): Constraint {
  return { constraintType: ConstraintType.LTE_SIGNED, referenceData: word(maximum) };
}

/** Signed inclusive range. */
export function inRangeSigned(lower: bigint | number, upper: bigint | number): Constraint {
  return { constraintType: ConstraintType.IN_SIGNED, referenceData: range(lower, upper) };
}

/**
 * Satisfied if any sub-constraint holds.
 *
 * An empty list is rejected rather than encoded, because it can never be satisfied and would present
 * as a gate that always passes. A nested `OR` is rejected rather than flattened, because flattening
 * changes what the user reviewed into something they did not.
 */
export function or(subConstraints: readonly Constraint[]): Constraint {
  if (subConstraints.length === 0) {
    fail(BuilderErrorCode.EmptyOrSubConstraints, "an OR with no sub-constraints can never be satisfied");
  }
  for (const [i, sub] of subConstraints.entries()) {
    if (sub.constraintType === ConstraintType.OR) {
      fail(BuilderErrorCode.InvalidConstraintType, "OR cannot be nested inside OR", `subConstraints[${i}]`);
    }
  }
  return { constraintType: ConstraintType.OR, referenceData: encodeOr(subConstraints) };
}

function encodeOr(subs: readonly Constraint[]): Hex {
  return encodeConstraintArray(subs);
}

/**
 * Consumes a constraint slot without checking anything.
 *
 * Carries no payload by contract, and the engine rejects a non-empty `referenceData` so that a
 * mistake fails loudly. The decoder renders this as "not checked", never as a pass.
 */
export function skip(): Constraint {
  return { constraintType: ConstraintType.SKIP, referenceData: "0x" };
}

// ---------------------------------------------------------------------------------------------
// Output params
// ---------------------------------------------------------------------------------------------

export interface CaptureSpec {
  /** How many words of the result to store. */
  readonly returnValues: number;
  /**
   * The middle word of the fixed three-word layout: `abi.encode(uint256, address, bytes32)`.
   *
   * `FailSafeExecutor._decodeOutputParam` reads only the first and third words, but the field is part
   * of the encoding, so it cannot be omitted. Which address belongs here is the module's business;
   * the client passes what the batch was built with rather than inventing a default.
   */
  readonly storageContract: string;
  /** The base storage key. The module derives each word's slot as `keccak256(baseSlot, index)`. */
  readonly storageKey: Hex;
}

/**
 * Capture this entry's result into composable storage.
 *
 * This is what lets a later entry gate on an earlier one: entry A captures a quote, entry B reads the
 * slot and constrains it. The slot is the module's to derive, not the client's to choose, so it is
 * supplied by whoever assembled the batch rather than invented here.
 */
export function captureExecResult(spec: CaptureSpec): OutputParam {
  if (!Number.isInteger(spec.returnValues) || spec.returnValues < 0) {
    fail(BuilderErrorCode.EncodingFailed, "returnValues must be a non-negative integer");
  }
  if (!isAddress(spec.storageContract, { strict: false })) {
    fail(BuilderErrorCode.EncodingFailed, `not an address: ${spec.storageContract}`);
  }
  if (spec.storageKey.length !== 66) {
    fail(BuilderErrorCode.EncodingFailed, "storageKey must be a 32-byte bytes32");
  }
  return {
    fetcherType: OutputParamFetcherType.EXEC_RESULT,
    paramData: encode(
      tupleOf([
        { t: "uint", v: BigInt(spec.returnValues) },
        { t: "address", v: addr20(spec.storageContract) },
        { t: "bytesN", v: spec.storageKey, n: 32 },
      ] as SolValue[]),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Entries and batches
// ---------------------------------------------------------------------------------------------

export interface EntrySpec {
  /** Four-byte selector. `0x` for a predicate, which resolves without calling anything. */
  readonly functionSig: Hex;
  readonly inputParams?: readonly InputParam[];
  readonly outputParams?: readonly OutputParam[];
}

/** Build one entry of a batch. */
export function entry(spec: EntrySpec): ComposableExecution {
  return {
    functionSig: spec.functionSig,
    inputParams: spec.inputParams ?? [],
    outputParams: spec.outputParams ?? [],
  };
}

/** True when the entry has no TARGET, so it resolves without calling a contract. */
export function isPredicate(e: ComposableExecution): boolean {
  return !e.inputParams.some((p) => p.paramType === InputParamType.TARGET);
}

const wordsIn = (hex: Hex): number => Math.ceil((hex.length - 2) / 2 / 32);

/**
 * Validate one entry against the engine's rules.
 *
 * This is the reason the library exists. The engine rejects malformed batches at execution time,
 * inside a UserOp, with a revert reason the user never sees. Running the same checks here means the
 * failure happens while the user is still looking at the batch and can be explained.
 *
 * Every rejection corresponds to a specific branch in `ComposableExecutionLib`. The engine's source
 * is the specification; this is a transcription of it, not an independent opinion.
 */
export function validateEntry(e: ComposableExecution, path = "entry"): void {
  if (e.functionSig.length !== 10) {
    fail(
      BuilderErrorCode.InvalidParameterEncoding,
      `functionSig must be 4 bytes, got ${(e.functionSig.length - 2) / 2}`,
      `${path}.functionSig`,
    );
  }

  let sawTarget = false;
  let sawValue = false;

  for (const [i, p] of e.inputParams.entries()) {
    const at = `${path}.inputParams[${i}]`;

    if (p.paramType === InputParamType.TARGET) {
      if (p.fetcherType === InputParamFetcherType.BALANCE) {
        fail(BuilderErrorCode.InvalidParameterEncoding, "BALANCE cannot be used for a TARGET param", at);
      }
      if (sawTarget) {
        fail(BuilderErrorCode.InvalidSetOfInputParams, "TARGET may only be set once", at);
      }
      sawTarget = true;
    } else if (p.paramType === InputParamType.VALUE) {
      if (sawValue) {
        fail(BuilderErrorCode.InvalidSetOfInputParams, "VALUE may only be set once", at);
      }
      sawValue = true;
    } else if (p.paramType !== InputParamType.CALL_DATA) {
      fail(BuilderErrorCode.InvalidParameterEncoding, `unknown paramType ${p.paramType}`, at);
    }

    validateConstraints(p, at);
  }
}

function validateConstraints(p: InputParam, at: string): void {
  // How many 32-byte words the resolved value can supply. The engine reverts with
  // `InsufficientRawValue` when constraints outnumber words, so it is checked before signing.
  let available: number;
  switch (p.fetcherType) {
    case InputParamFetcherType.RAW_BYTES:
      available = wordsIn(p.paramData);
      break;
    case InputParamFetcherType.BALANCE:
      available = 1;
      break;
    case InputParamFetcherType.STATIC_CALL:
      // Unknowable client-side: the return length is only known at execution.
      available = Number.POSITIVE_INFINITY;
      break;
    default:
      return fail(
        BuilderErrorCode.InvalidParameterEncoding,
        `unknown fetcherType ${p.fetcherType}`,
        at,
      );
  }

  if (p.constraints.length > available) {
    fail(
      BuilderErrorCode.InvalidParameterEncoding,
      `${p.constraints.length} constraints but the resolved value supplies only ${available} word(s); ` +
        "the engine would revert with InsufficientRawValue",
      `${at}.constraints`,
    );
  }

  for (const [i, c] of p.constraints.entries()) validateConstraint(c, `${at}.constraints[${i}]`);
}

function validateConstraint(c: Constraint, at: string): void {
  const len = (c.referenceData.length - 2) / 2;

  switch (c.constraintType) {
    case ConstraintType.EQ:
    case ConstraintType.GTE:
    case ConstraintType.LTE:
    case ConstraintType.GTE_SIGNED:
    case ConstraintType.LTE_SIGNED:
      if (len !== 32) {
        fail(BuilderErrorCode.InvalidReferenceDataLength, `expected 32 bytes, got ${len}`, at);
      }
      break;

    case ConstraintType.IN:
    case ConstraintType.IN_SIGNED: {
      if (len !== 64) {
        fail(BuilderErrorCode.InvalidReferenceDataLength, `expected 64 bytes for a range, got ${len}`, at);
      }
      // Two static 32-byte words, not an ABI-encoded array: the engine's length check expects 64
      // bytes. Reading the whole 64-byte string as one number would compare the *concatenation* of
      // the bounds against itself, which is never inverted and never equal to either bound.
      const lower = BigInt(`0x${c.referenceData.slice(2, 66)}`);
      const upper = BigInt(`0x${c.referenceData.slice(66)}`);
      if (lower > upper) {
        fail(
          BuilderErrorCode.InvalidConstraintRange,
          `lower bound ${lower} exceeds upper ${upper}, so the range can never be satisfied`,
          at,
        );
      }
      break;
    }

    case ConstraintType.SKIP:
      if (len !== 0) {
        fail(
          BuilderErrorCode.InvalidReferenceDataLength,
          `SKIP must carry no referenceData, got ${len} bytes`,
          at,
        );
      }
      break;

    case ConstraintType.OR: {
      const subs = decodeOr(c.referenceData, at);
      if (subs.length === 0) {
        fail(BuilderErrorCode.EmptyOrSubConstraints, "OR has no sub-constraints", at);
      }
      for (const [j, sub] of subs.entries()) {
        if (sub.constraintType === ConstraintType.OR) {
          fail(BuilderErrorCode.InvalidConstraintType, "OR cannot be nested inside OR", `${at}[${j}]`);
        }
        validateConstraint(sub, `${at}.or[${j}]`);
      }
      break;
    }

    default:
      fail(BuilderErrorCode.InvalidConstraintType, `unknown constraintType ${c.constraintType}`, at);
  }
}

function decodeOr(referenceData: Hex, at: string): readonly Constraint[] {
  let rows: readonly { constraintType: number; referenceData: Hex }[];
  try {
    rows = decodeConstraintArray(referenceData);
  } catch (cause) {
    fail(
      BuilderErrorCode.InvalidReferenceDataLength,
      `OR referenceData is not an abi-encoded Constraint[]: ${String(cause)}`,
      at,
    );
  }
  return rows as readonly Constraint[];
}

// ---------------------------------------------------------------------------------------------

export interface EncodeOptions {
  /** Defaults to `MAX_ENTRIES`. Raise deliberately; see the note on `MAX_ENTRIES`. */
  readonly maxEntries?: number;
}

/**
 * Validate and ABI-encode a batch.
 *
 * Throws `BuilderError` on the first problem found, naming both the upstream error the engine would
 * have raised and the path within the batch.
 */
export function encodeBatch(
  entries: readonly ComposableExecution[],
  options: EncodeOptions = {},
): Hex {
  const max = options.maxEntries ?? MAX_ENTRIES;
  if (entries.length > max) {
    fail(
      BuilderErrorCode.BatchTooLarge,
      `${entries.length} entries exceeds the limit of ${max}. A batch must be reviewable in one screen. ` +
        "Pass maxEntries to override this deliberately.",
      "batch",
    );
  }
  for (const [i, e] of entries.entries()) validateEntry(e, `batch[${i}]`);
  return encodeExecutions(entries);
}

function concatHex(a: Hex, b: Hex): Hex {
  return `0x${a.slice(2)}${b.slice(2)}` as Hex;
}

/** The 4-byte selector for a human-readable signature, as the module would compute it. */
export const selectorOf = sel;