/**
 * Public entry point for `@latch/client`.
 *
 * The barrel exists so a consumer (the `web/` app, a script, a test harness) has one import path
 * and never reaches into `src/*.ts` directly. Everything re-exported here is covered by the test
 * suites in `client/test/`; nothing here adds behaviour.
 *
 * `selectorOf` is defined in `abi.ts` and aliased in `builder.ts`. Re-exporting both through
 * `export *` would be an ambiguous star export, so the builder's surface is named explicitly.
 */

export * from "./types";
export * from "./constants";
export * from "./errors";
export * from "./abi";
export * from "./decoder";
export * from "./demoBatch";

export {
  WORD,
  word,
  toTwosComplement,
  tupleOf,
  encode,
  decodeAt,
  decodeBare,
} from "./abiCodec";
export type { SolValue } from "./abiCodec";

export {
  target,
  value,
  callData,
  staticCall,
  balance,
  eq,
  gte,
  lte,
  inRange,
  gteSigned,
  lteSigned,
  inRangeSigned,
  or,
  skip,
  captureExecResult,
  entry,
  isPredicate,
  validateEntry,
  encodeBatch,
} from "./builder";
export type { CaptureSpec, EncodeOptions, EntrySpec } from "./builder";
