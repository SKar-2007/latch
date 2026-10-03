/**
 * The ERC-8211 wire format.
 *
 * Enum ordering is part of the encoding, not an implementation detail. If a version of this file
 * reorders a member, every previously signed batch decodes differently and every client silently
 * agrees with a different meaning. Tracked as V-10 in docs/appendix/verification-log.md.
 *
 * These values mirror `contracts/interfaces/IComposabilityTypes.sol`, which in turn mirrors
 * `ComposabilityDataTypes.sol` from bcnmy/erc8211-contracts.
 */

/** Ordinals must match the Solidity enum exactly. */
export const InputParamType = {
  TARGET: 0,
  VALUE: 1,
  CALL_DATA: 2,
} as const;
export type InputParamType = (typeof InputParamType)[keyof typeof InputParamType];

export const InputParamFetcherType = {
  RAW_BYTES: 0,
  STATIC_CALL: 1,
  BALANCE: 2,
} as const;
export type InputParamFetcherType =
  (typeof InputParamFetcherType)[keyof typeof InputParamFetcherType];

export const OutputParamFetcherType = {
  EXEC_RESULT: 0,
  STATIC_CALL: 1,
} as const;
export type OutputParamFetcherType =
  (typeof OutputParamFetcherType)[keyof typeof OutputParamFetcherType];

/**
 * The eight comparison operators plus `OR` and `SKIP`.
 *
 * `SKIP` is not a comparison. It is a placeholder that consumes a constraint slot without checking
 * anything, which is why the decoder must render it as "not checked" rather than as a pass.
 */
export const ConstraintType = {
  EQ: 0,
  GTE: 1,
  LTE: 2,
  IN: 3,
  GTE_SIGNED: 4,
  LTE_SIGNED: 5,
  OR: 6,
  SKIP: 7,
  IN_SIGNED: 8,
} as const;
export type ConstraintType = (typeof ConstraintType)[keyof typeof ConstraintType];

export interface Constraint {
  readonly constraintType: ConstraintType;
  readonly referenceData: Hex;
}

export interface InputParam {
  readonly paramType: InputParamType;
  readonly fetcherType: InputParamFetcherType;
  readonly paramData: Hex;
  readonly constraints: readonly Constraint[];
}

export interface OutputParam {
  readonly fetcherType: OutputParamFetcherType;
  readonly paramData: Hex;
}

export interface ComposableExecution {
  readonly functionSig: Hex;
  readonly inputParams: readonly InputParam[];
  readonly outputParams: readonly OutputParam[];
}

export type Hex = `0x${string}`;