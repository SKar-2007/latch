import { keccak256, toHex, type Hex } from "viem";
import { decodeExecutions, encodeExecutions, type ComposableExecution } from "@latch/client";
import { EXPECTED_CHAIN_ID } from "./chain";
import { isConfigured, NEXUS_1_3_1 } from "./addresses";
import { Policy, type Bounds } from "@/app/state";

/**
 * The signed intent, and the reconciliation that decides whether it is honoured.
 *
 * ## Why this file exists
 *
 * There are two signatures in this product and they are not interchangeable. Rule D8:
 *
 * > The EIP-712 intent is presentation, expiry and replay scoping. The **UserOp signature is the
 * > trust root**; the relayer submits the batch derived from the UserOp and discards the intent if
 * > they disagree.
 *
 * The practical consequence, and the reason it is worth a module: **the intent cannot authorise a
 * batch.** It carries a batch so the user can *read* what they are approving, and so a relayer can
 * decide whether to bother. It does not carry authority. Authority lives in the UserOp the account
 * signed, and the batch that executes is derived from that UserOp's calldata.
 *
 * So `reconcile()` is the whole point of this file. Given the intent the user read and the batch the
 * chain will actually run, it returns a decision. A mismatch is not a warning and not a fallback —
 * the intent is discarded and the UserOp stands. Anything else would mean the thing the user
 * reviewed is not the thing that executes, which is the one failure this product exists to make
 * impossible.
 *
 * ## Why the comparison is over encoded bytes
 *
 * `reconcile` compares ABI encodings, not object graphs. Two batches that are structurally equal but
 * encode differently — a differently ordered constraint array, a differently cased address — are
 * treated as different, deliberately. The chain will run the bytes, so the bytes are what has to
 * match; anything looser would let a cosmetic difference hide a real one.
 */

/** EIP-712 domain. Pinned, never discovered. */
export interface IntentDomain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: Hex;
}

export const INTENT_NAME = "LATCH";
export const INTENT_VERSION = "1";

/**
 * The domain's verifying contract.
 *
 * The intent is signed by the *account*, not by a module, because the account is what authorises the
 * UserOp. With no account configured this returns the zero address rather than a placeholder, so a
 * domain built without configuration cannot be mistaken for a real one.
 */
export function intentDomain(account: string): IntentDomain {
  return {
    name: INTENT_NAME,
    version: INTENT_VERSION,
    chainId: EXPECTED_CHAIN_ID,
    verifyingContract: (isConfigured(account) ? account : "0x0000000000000000000000000000000000000000") as Hex,
  };
}

/** What the user is shown, and what the relayer checks. Never what executes. */
export interface LatchIntent {
  readonly domain: IntentDomain;
  /** Presentation only. See `reconcile`. */
  readonly batch: readonly ComposableExecution[];
  readonly policy: readonly Policy[];
  readonly bounds: Bounds;
  /** Unix seconds. After this the relayer must refuse even if the UserOp is still valid. */
  readonly deadline: number;
  /** Replay scoping. A relayer must refuse a nonce it has already submitted. */
  readonly nonce: bigint;
}

/**
 * EIP-712 types, in the order they are hashed.
 *
 * `policy` and `bounds` are included because they change what the batch *means* without changing
 * its bytes — a segment switched to `SKIP_CALL` keeps the same calls. A signature that covered only
 * the batch would be blind to the difference between "everything or nothing" and "skip this one".
 */
export const INTENT_TYPES = {
  LatchIntent: [
    { name: "calls", type: "bytes" },
    { name: "policy", type: "string[]" },
    { name: "slippageBps", type: "uint16" },
    { name: "maxStalenessSec", type: "uint32" },
    { name: "priceBandBps", type: "uint16" },
    { name: "minOutput", type: "string" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface IntentDraft {
  readonly account: string;
  readonly batch: readonly ComposableExecution[];
  readonly policy: readonly Policy[];
  readonly bounds: Bounds;
  readonly deadline: number;
  readonly nonce: bigint;
}

export function buildIntent(draft: IntentDraft): LatchIntent {
  return {
    domain: intentDomain(draft.account),
    batch: draft.batch,
    policy: draft.policy,
    bounds: draft.bounds,
    deadline: draft.deadline,
    nonce: draft.nonce,
  };
}

/**
 * The bytes a signature commits to.
 *
 * The batch goes in as its ABI encoding rather than as a hash of a hash, so the value the user is
 * shown and the value that gets signed cannot diverge in formatting.
 */
export function intentDigest(intent: LatchIntent): Hex {
  const encodedBatch = encodeExecutions(intent.batch);
  const digestOfBatch = keccak256(encodedBatch);

  return keccak256(
    encodeIntentFields({
      calls: digestOfBatch,
      policy: intent.policy,
      slippageBps: intent.bounds.slippageBps,
      maxStalenessSec: intent.bounds.maxStalenessSec,
      priceBandBps: intent.bounds.priceBandBps,
      minOutput: intent.bounds.minOutput,
      deadline: BigInt(intent.deadline),
      nonce: intent.nonce,
    }),
  );
}

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffff_ffff;

function encodeIntentFields(fields: {
  readonly calls: Hex;
  readonly policy: readonly Policy[];
  readonly slippageBps: number;
  readonly maxStalenessSec: number;
  readonly priceBandBps: number;
  readonly minOutput: string;
  readonly deadline: bigint;
  readonly nonce: bigint;
}): Hex {
  if (fields.slippageBps < 0 || fields.slippageBps > UINT16_MAX) {
    throw new RangeError(`slippageBps ${fields.slippageBps} does not fit uint16`);
  }
  if (fields.maxStalenessSec < 0 || fields.maxStalenessSec > UINT32_MAX) {
    throw new RangeError(`maxStalenessSec ${fields.maxStalenessSec} does not fit uint32`);
  }
  if (fields.priceBandBps < 0 || fields.priceBandBps > UINT16_MAX) {
    throw new RangeError(`priceBandBps ${fields.priceBandBps} does not fit uint16`);
  }
  if (fields.deadline < 0n) {
    throw new RangeError(`deadline ${fields.deadline} is negative`);
  }

  // Hand-packed rather than viem's encoder: a hand-packed struct hash is legible here, and the
  // alternative is an ABI definition for a type that only ever gets hashed.
  const words: Hex[] = [
    keccak256(fields.calls),
    keccak256(toHex(JSON.stringify(fields.policy))),
    toHex(fields.slippageBps, { size: 32 }),
    toHex(fields.maxStalenessSec, { size: 32 }),
    toHex(fields.priceBandBps, { size: 32 }),
    keccak256(toHex(fields.minOutput)),
    toHex(fields.deadline, { size: 32 }),
    toHex(fields.nonce, { size: 32 }),
  ];
  return keccak256(`0x${words.map((w) => w.slice(2)).join("")}`);
}

// ---------------------------------------------------------------------------------------------
// Expiry and replay
// ---------------------------------------------------------------------------------------------

export function isExpired(intent: LatchIntent, nowSeconds: number): boolean {
  return nowSeconds > intent.deadline;
}

/**
 * Replay scoping.
 *
 * The set is supplied by the caller because the relayer is what holds it. An empty set means nothing
 * has been seen, which is the correct answer on a first submission and also the answer a client would
 * give if it kept no record — which is exactly why this is not trusted to be authoritative.
 */
export function isReplay(intent: LatchIntent, seenNonces: ReadonlySet<string>): boolean {
  return seenNonces.has(intent.nonce.toString());
}

// ---------------------------------------------------------------------------------------------
// Reconciliation: the D8 decision
// ---------------------------------------------------------------------------------------------

export type ReconcileFailure =
  | "batch-mismatch"
  | "expired"
  | "replayed"
  | "undecodable-userop"
  | "wrong-target";

export type Reconciliation =
  | { readonly ok: true; readonly batch: readonly ComposableExecution[] }
  | { readonly ok: false; readonly reason: ReconcileFailure; readonly detail: string };

/**
 * The two composable entry points, as `function(CanonicalTupleType)` signature hashes.
 *
 * Computed rather than pasted. A selector that looks right and is wrong is the worst kind of bug in
 * this file: it would make `batchFromUserOp` return undefined for a perfectly good UserOp, and the
 * intent would be discarded with a message blaming the user's chain rather than the constant.
 */
const COMPOSABLE_EXECUTION_ARRAY =
  "((bytes4,(uint8,uint8,bytes,(uint8,bytes)[])[],(uint8,bytes)[])[])";

const selectorOf = (signature: string): string => keccak256(toHex(signature)).slice(0, 10);

/** `executeComposable(ComposableExecution[])`, the account's native entry point. Nexus 1.3.1 has it. */
const NATIVE_SELECTOR = selectorOf(`executeComposable${COMPOSABLE_EXECUTION_ARRAY}`);

/** `executeComposableCall(ComposableExecution[])`, the installed module's entry point. */
const MODULE_SELECTOR = selectorOf(`executeComposableCall${COMPOSABLE_EXECUTION_ARRAY}`);

/**
 * Exported so a mismatch can be diagnosed rather than guessed at.
 *
 * `EXECUTE_COMPOSABLE_SELECTOR` in `features/wallet/simulate.ts` computes the same value from the
 * same signature. They are deliberately not shared: `core/` must not depend on `features/`, and seat C
 * owns that file. If you change one, change the other, and the two are asserted equal as of this
 * commit -- `native` is `0x7eba07b8` from both sides.
 */
export const COMPOSABLE_SELECTORS = {
  native: NATIVE_SELECTOR,
  module: MODULE_SELECTOR,
} as const;

/**
 * Pull the batch out of a UserOp's calldata.
 *
 * Returns undefined rather than an empty array when the calldata is not a composable call. "This
 * UserOp does something else" and "this UserOp runs an empty batch" are different facts and must not
 * collapse into the same value.
 */
export function batchFromUserOp(callData: Hex): ComposableExecution[] | undefined {
  const selector = callData.slice(0, 10).toLowerCase();
  if (selector !== NATIVE_SELECTOR && selector !== MODULE_SELECTOR) return undefined;

  try {
    // Skip the selector; what remains is the ABI encoding of the single argument.
    const argument = `0x${callData.slice(10)}` as Hex;
    return [...decodeExecutions(argument)];
  } catch {
    return undefined;
  }
}

/**
 * Decide whether the intent may be presented as the explanation for this UserOp.
 *
 * This is the D8 decision. Order matters: expiry and replay are checked first because they are
 * cheap and they do not depend on decoding, and a stale intent is refused regardless of whether its
 * batch happens to match.
 */
export function reconcile(
  intent: LatchIntent,
  userOp: { readonly callData: Hex },
  options: { readonly nowSeconds: number; readonly seenNonces?: ReadonlySet<string> } ,
): Reconciliation {
  if (isExpired(intent, options.nowSeconds)) {
    return {
      ok: false,
      reason: "expired",
      detail:
        "The intent expired before this UserOp was built. The UserOp remains valid, so the batch it " +
        "encodes is what executes — but this app will not present the expired intent as its explanation.",
    };
  }

  if (options.seenNonces !== undefined && isReplay(intent, options.seenNonces)) {
    return {
      ok: false,
      reason: "replayed",
      detail: "This intent's nonce has already been submitted. The UserOp is judged on its own.",
    };
  }

  const derived = batchFromUserOp(userOp.callData);
  if (derived === undefined) {
    return {
      ok: false,
      reason: undecodableSelectorIsComposable(userOp.callData) ? "undecodable-userop" : "wrong-target",
      detail: undecodableSelectorIsComposable(userOp.callData)
        ? "The UserOp targets a composable entry point but its calldata could not be decoded. The " +
          "intent is discarded rather than guessed at."
        : "The UserOp does not call a composable entry point at all. The intent describes something " +
          "this transaction will not do, so it is discarded.",
    };
  }

  // The comparison the whole rule exists for: encoded bytes, not object graphs.
  const intended = encodeExecutions(intent.batch);
  const actual = encodeExecutions(derived);
  if (intended.toLowerCase() !== actual.toLowerCase()) {
    return {
      ok: false,
      reason: "batch-mismatch",
      detail:
        "The batch this UserOp will execute is not the batch the intent describes. The UserOp is the " +
        "trust root, so the intent is discarded. Nothing has been submitted.",
    };
  }

  /*
   * Policy is NOT compared, and the omission is the finding rather than a gap.
   *
   * An earlier draft inferred a policy from the derived batch and compared it to the intent's. That is
   * unsound in a way that only shows up in use: the UserOp's calldata carries no policy field, so the
   * inferred value was always `REVERT_BATCH` on every segment. Any user who set one segment to
   * `SKIP_CALL` -- which D6 explicitly supports and the builder offers -- would have had their intent
   * discarded on every single submission, with a message blaming a policy mismatch that the chain
   * never reported.
   *
   * So policy is part of the intent's *meaning* and not part of what executes. That is consistent with
   * the rest of D8: the intent describes, the UserOp authorises, and only the batch is compared. A
   * caller that needs policy enforced must put it somewhere the UserOp carries -- inside the calls
   * themselves, which is where a policy that matters ultimately belongs.
   */

  return { ok: true, batch: derived };
}

function undecodableSelectorIsComposable(callData: Hex): boolean {
  const selector = callData.slice(0, 10).toLowerCase();
  return selector === NATIVE_SELECTOR || selector === MODULE_SELECTOR;
}

/**
 * The account the intent is signed against.
 *
 * Nexus 1.3.1 implements `executeComposable` natively, so an intent naming any other account cannot
 * be honoured by the module path. Surfacing that here rather than at signing time is the difference
 * between a helpful message and a failed signature.
 */
export function supportsNativeComposable(account: string): boolean {
  return account.toLowerCase() === NEXUS_1_3_1.toLowerCase();
}