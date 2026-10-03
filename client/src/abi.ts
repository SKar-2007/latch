import { keccak256, toHex } from "viem";
import { Reader, decodeBare, encode, tupleOf, word, type SolValue } from "./abiCodec";
import type { ComposableExecution, Hex } from "./types";

/**
 * The ERC-8211 struct shape, as `SolValue` templates.
 *
 * The layout mirrors `IComposableTypes.sol` exactly, and `abiParity.test.ts` checks each field's
 * width against the Solidity declaration. Everything structural lives in `abiCodec`; this file only
 * says what the struct is.
 */

// The field templates below carry shape, not values. Encoding supplies the real data; decoding walks
// the same shape to know how many words to read. An empty `items: [[]]` decodes to a zero-field tuple,
// so every array template names the tuple it contains.

const U = { t: "uint", v: 0n } as const satisfies SolValue;
const B = { t: "bytes", v: "0x" } as const satisfies SolValue;

/** `(ConstraintType, bytes)`, the fields of a `Constraint`. */
export const constraintFields: readonly SolValue[] = [U, B];

/** `(InputParamType, InputParamFetcherType, bytes, Constraint[])`, the fields of an `InputParam`. */
export const inputParamFields: readonly SolValue[] = [
  U,
  U,
  B,
  { t: "tupleArray", items: [constraintFields] },
];

/** `(OutputParamFetcherType, bytes)`, the fields of an `OutputParam`. */
export const outputParamFields: readonly SolValue[] = [U, B];

/**
 * `(bytes4, InputParam[], OutputParam[])`, the fields of a `ComposableExecution`.
 *
 * `functionSig` is declared `bytes32` rather than `bytes4`. Both are static and left-aligned in one
 * 32-byte word, so the encoding is byte-identical, and `abiParity.test.ts` proves that against
 * `cast abi-encode` rather than asking the reader to take it on trust. `padSelector` and
 * `unpadSelector` keep the width honest at the boundary.
 */
export const executionFields: readonly SolValue[] = [
  { t: "bytesN", v: `0x${"00".repeat(32)}`, n: 32 },
  { t: "tupleArray", items: [inputParamFields] },
  { t: "tupleArray", items: [outputParamFields] },
];

/** `ComposableExecution[]`. */
export const executionArraySol: SolValue = { t: "tupleArray", items: [executionFields] };

/**
 * `Constraint[]`, the encoding of an `OR` constraint's `referenceData`.
 *
 * Prefixed with the usual offset word, because Solidity writes `abi.encode(constraints)` and the
 * argument is dynamic: the encoding is `[0x20][len][offsets][elements]`. Omitting that word shifts
 * every field by 32 bytes, and the value is still 32-byte aligned, so nothing rejects it.
 */
export const constraintArraySol: SolValue = {
  t: "tuple",
  fields: [{ t: "tupleArray", items: [constraintFields] }],
};

/**
 * Widen a 4-byte selector into the 32-byte word the ABI declares.
 *
 * The zeros go *after* the selector. A fixed-width value is left-aligned, so `bytes4(0xdeadbeef)`
 * occupies the leading four bytes of the word. Prepending the zeros puts the selector in the
 * trailing four instead, where the engine reads zeroes: the batch validates, encodes, and resolves
 * with `functionSig == 0x00000000`, so every entry looks like a predicate and calls nothing.
 */
export function padSelector(sig: Hex): Hex {
  if (sig.length !== 10) {
    throw new RangeError(`a selector is 4 bytes, got ${(sig.length - 2) / 2}: ${sig}`);
  }
  return `0x${sig.slice(2).padEnd(64, "0")}` as Hex;
}

/**
 * Recover the 4-byte selector from a 32-byte word.
 *
 * Fixed-width bytes are left-aligned, so the selector occupies the *leading* four bytes. Reading the
 * trailing four instead yields zero, which is how a batch decodes into `functionSig == 0x00000000` and
 * every entry looks like a predicate.
 */
export function unpadSelector(w: Hex): Hex {
  return `0x${w.slice(2, 10)}` as Hex;
}

// ---------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------

/**
 * Encode an `OR` constraint's `referenceData`.
 *
 * Wrapped in a tuple so the leading offset word Solidity writes is included: `abi.encode(dynamic)`
 * is `[0x20][content]`, and the module decodes the `Constraint[]` behind that pointer.
 */
export function encodeConstraintArray(cs: readonly { constraintType: number; referenceData: Hex }[]): Hex {
  return encode(
    tupleOf([
      {
        t: "tupleArray",
        items: cs.map(
          (c) =>
            [
              { t: "uint", v: BigInt(c.constraintType) },
              { t: "bytes", v: c.referenceData },
            ] as SolValue[],
        ),
      },
    ]),
  );
}

/** Decode a `Constraint[]` from an `OR` constraint's `referenceData`. */
export function decodeConstraintArray(data: Hex): { constraintType: number; referenceData: Hex }[] {
  // The template is a tuple wrapping the array, so the leading offset word is consumed for us.
  return asItems(asTuple(decodeBare(data, constraintArraySol))[0]!).map((f) => {
    const [constraintType, referenceData] = f;
    return { constraintType: Number(asUint(constraintType!)), referenceData: asBytes(referenceData!) };
  });
}

export function encodeExecutions(entries: readonly ComposableExecution[]): Hex {
  return encode({
    t: "tupleArray",
    items: entries.map((e) => [
      { t: "bytesN", v: padSelector(e.functionSig), n: 32 },
      {
        t: "tupleArray",
        items: e.inputParams.map((p) => [
          { t: "uint", v: BigInt(p.paramType) },
          { t: "uint", v: BigInt(p.fetcherType) },
          { t: "bytes", v: p.paramData },
          {
            t: "tupleArray",
            items: p.constraints.map((c) => [
              { t: "uint", v: BigInt(c.constraintType) },
              { t: "bytes", v: c.referenceData },
            ] as SolValue[]),
          },
        ] as SolValue[]),
      },
      {
        t: "tupleArray",
        items: e.outputParams.map((o) => [
          { t: "uint", v: BigInt(o.fetcherType) },
          { t: "bytes", v: o.paramData },
        ] as SolValue[]),
      },
    ] as SolValue[]),
  });
}

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

export const asBytes = (v: SolValue): Hex => (v as { v: Hex }).v;
export const asTuple = (v: SolValue): readonly SolValue[] => (v as { fields: readonly SolValue[] }).fields;
export const asUint = (v: SolValue): bigint => (v as { v: bigint }).v;
const asItems = (v: SolValue): readonly (readonly SolValue[])[] =>
  (v as { items: readonly (readonly SolValue[])[] }).items;

/**
 * Decode a `ComposableExecution[]` back out of ABI data.
 *
 * A malformed buffer raises rather than returning a partial batch. A decoder that yields "most of a
 * batch" is worse than one that fails, because the missing entry is the one nobody reviews.
 */
export function decodeExecutions(data: Hex): ComposableExecution[] {
  const decoded = decodeBare(data, executionArraySol);
  return asItems(decoded).map((fields) => {
    const [functionSig, inputParams, outputParams] = fields;
    return {
      functionSig: unpadSelector(asBytes(functionSig!)),
      inputParams: asItems(inputParams!).map((f) => {
        const [paramType, fetcherType, paramData, constraints] = f;
        return {
          paramType: Number(asUint(paramType!)) as ComposableExecution["inputParams"][number]["paramType"],
          fetcherType: Number(
            asUint(fetcherType!),
          ) as ComposableExecution["inputParams"][number]["fetcherType"],
          paramData: asBytes(paramData!),
          constraints: asItems(constraints!).map((cf) => {
            const [constraintType, referenceData] = cf;
            return {
              constraintType: Number(
                asUint(constraintType!),
              ) as ComposableExecution["inputParams"][number]["constraints"][number]["constraintType"],
              referenceData: asBytes(referenceData!),
            };
          }),
        };
      }),
      outputParams: asItems(outputParams!).map((f) => {
        const [fetcherType, paramData] = f;
        return {
          fetcherType: Number(
            asUint(fetcherType!),
          ) as ComposableExecution["outputParams"][number]["fetcherType"],
          paramData: asBytes(paramData!),
        };
      }),
    };
  });
}

/**
 * The slot a captured word is written to: `keccak256(abi.encodePacked(storageSlot, index))`.
 *
 * The index is packed as a full word, not as a minimal integer, and that is load-bearing. Encoding
 * index 0 as a single byte yields a different slot, and a reader using the correct derivation would
 * never find the captured value. The failure is silent: the write succeeds and the read returns zero.
 */
export function deriveValueSlot(storageSlot: Hex, index: number): Hex {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`capture index must be a non-negative integer, got ${index}`);
  }
  return keccak256(`${storageSlot}${word(BigInt(index)).slice(2)}` as Hex);
}

/** A `bytes4` selector from a human-readable signature, as the module would compute it. */
export function selectorOf(signature: string): Hex {
  return keccak256(toHex(signature)).slice(0, 10) as Hex;
}

/** Re-exported so callers need not know which module the reader lives in. */
export { Reader };

/** Silence the unused-import warning for the type-only export above. */
export type { SolValue };