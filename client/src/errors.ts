/**
 * The builder's error taxonomy.
 *
 * Every code except `BatchTooLarge` is the name of an error the deployed composability module would
 * itself revert with. That is the whole design goal: if the builder rejects a batch, the engine
 * would have rejected it too, and the user finds out before signing rather than after.
 *
 * The alternative, rejecting less than the engine does, produces a batch that is accepted by the
 * client and rejected on-chain, which is the worst outcome available: the user signs, waits, and
 * learns nothing from a revert they cannot interpret.
 */
export const BuilderErrorCode = {
  /** Upstream `InvalidParameterEncoding`. Wrong paramType/fetcherType pairing or bad paramData. */
  InvalidParameterEncoding: "InvalidParameterEncoding",
  /** Upstream `InvalidSetOfInputParams`. Duplicate TARGET or VALUE, or too many BALANCE constraints. */
  InvalidSetOfInputParams: "InvalidSetOfInputParams",
  /** Upstream `InvalidReferenceDataLength`. A constraint whose referenceData is the wrong size. */
  InvalidReferenceDataLength: "InvalidReferenceDataLength",
  /** Upstream `InvalidConstraintRange`. An `IN` or `IN_SIGNED` whose lower bound exceeds its upper. */
  InvalidConstraintRange: "InvalidConstraintRange",
  /** Upstream `InvalidConstraintType`. An ordinal outside the enum, or an `OR` nested inside an `OR`. */
  InvalidConstraintType: "InvalidConstraintType",
  /** Upstream `EmptyOrSubConstraints`. An `OR` with no sub-constraints, which can never be satisfied. */
  EmptyOrSubConstraints: "EmptyOrSubConstraints",
  /** Client-only. The batch has more entries than `MAX_ENTRIES`. */
  BatchTooLarge: "BatchTooLarge",
  /** Client-only. A value could not be ABI-encoded at all, e.g. a malformed address. */
  EncodingFailed: "EncodingFailed",
} as const;

export type BuilderErrorCode =
  (typeof BuilderErrorCode)[keyof typeof BuilderErrorCode];

export class BuilderError extends Error {
  readonly code: BuilderErrorCode;
  /** Where the problem is, e.g. `entry[2].inputParams[0].paramData`. */
  readonly path: string | undefined;

  constructor(code: BuilderErrorCode, message: string, path?: string) {
    super(path ? `${code}: ${message} (at ${path})` : `${code}: ${message}`);
    this.name = "BuilderError";
    this.code = code;
    this.path = path;
  }
}

export function fail(
  code: BuilderErrorCode,
  message: string,
  path?: string,
): never {
  throw new BuilderError(code, message, path);
}