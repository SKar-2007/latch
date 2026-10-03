import { keccak256, type Address, type Hex, type TypedDataDomain } from "viem";
import { encodeBatch, type ComposableExecution } from "@latch/client";
import { CHAIN_ID, COMPOSABILITY_MODULE } from "./addresses";

/**
 * The EIP-712 `DeclarativeIntent`, transcribed from docs/06 ("EIP-712 intent shape").
 *
 * ## What this signature authorises — and what it does not
 *
 * It authorises **presentation, expiry and replay scoping**, and nothing else:
 *
 *   - *presentation* — a wallet shows a readable typed-data payload instead of a hex blob, and two
 *     frontends for the same account cannot present different UI for the same batch (`name:
 *     "LATCH"` scopes it to this app);
 *   - *expiry* — `validUntil` lets an intent die while it sits in a queue;
 *   - *replay scoping* — `chainId` and `verifyingContract` (the account address) stop the same
 *     intent being replayed on another chain or against another account, and `nonce` lets a
 *     relayer refuse one it has already submitted.
 *
 * It does **not** authorise the batch. Nothing on-chain reads this signature. The trust root is the
 * signature the account itself produces over the transaction it will execute — the UserOp signature
 * in a bundled flow, or the wallet's transaction signature over `executeComposable` calldata in the
 * raw flow. That signature commits to the calldata, the calldata contains the batch, and the batch
 * contains every target and every constraint (docs/06, "Two signatures, and why they are not
 * interchangeable"; rule D8).
 *
 * **A relayer that accepts a submission on the EIP-712 signature alone is exploitable.** An attacker
 * who observes a valid intent can submit it: the UserOp they construct validates, because they can
 * sign it themselves or the account's validator accepts their own signature, and the EIP-712
 * signature was never checked by anything that matters (docs/06, central warning; docs/08, T-row
 * "EIP-712 intent"). The batch a relayer submits must be the batch derived from the signature the
 * *account* produced. If the intent and that batch disagree, the account's signature wins and the
 * intent is discarded — presentation never overrules authorisation.
 */

/** Pinned in the domain so a signature from another app or another version cannot be replayed here. */
export const INTENT_NAME = "LATCH";
export const INTENT_VERSION = "1";

/**
 * The typed-data types, in the order docs/06 lists them.
 *
 * `module` is part of the struct so an intent signed against one composability module version is
 * visibly not the same intent as one signed against another.
 */
export const INTENT_TYPES = {
  DeclarativeIntent: [
    { name: "account", type: "address" },
    { name: "batchHash", type: "bytes32" },
    { name: "module", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "validUntil", type: "uint256" },
  ],
} as const;

export type IntentPrimaryType = "DeclarativeIntent";

/**
 * The EIP-712 domain.
 *
 * `verifyingContract` is the account address, not a LATCH contract: there is no LATCH contract that
 * verifies this signature, so binding it to one would be decoration (docs/06, "Why the domain is
 * bound this way"). Chain and account are the two bindings that matter, and both are pinned
 * configuration rather than values read from the wallet at runtime.
 */
export interface IntentDomain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: Address;
}

export function buildDomain(account: Address): IntentDomain {
  return {
    name: INTENT_NAME,
    version: INTENT_VERSION,
    chainId: CHAIN_ID,
    verifyingContract: account,
  };
}

/** The message as it is hashed: `batchHash` over the exact bytes the execution layer receives. */
export interface IntentMessage {
  readonly account: Address;
  readonly batchHash: Hex;
  readonly module: Address;
  /** `uint256`, so bigint — the type viem hashes the field as. The domain's `chainId` stays a number. */
  readonly chainId: bigint;
  readonly nonce: bigint;
  readonly validUntil: bigint;
}

export interface IntentMessageInput {
  readonly account: Address;
  readonly calls: readonly ComposableExecution[];
  /** Defaults to the pinned composability module. Supplied so a different module is a deliberate act. */
  readonly module?: Address;
  /** Application-level replay scope. Defaults to 0; see `signIntent`. */
  readonly nonce?: bigint;
  /** Unix seconds. Required: an intent without an expiry is a standing order. */
  readonly validUntil: number | bigint;
}

/**
 * `keccak256(abi.encode(composableCalls))` over the exact `ComposableExecution[]` handed to the
 * execution layer.
 *
 * The bytes come from `encodeBatch` — the same encoder the calldata is built from — rather than a
 * hand-rolled summary of the batch, so the signed digest and the submitted bytes cannot diverge
 * (docs/06). Two batches that differ in any target, value, fetcher or constraint hash differently;
 * two batches that are byte-identical hash identically.
 */
export function hashBatch(calls: readonly ComposableExecution[]): Hex {
  return keccak256(encodeBatch(calls));
}

export function buildIntentMessage(input: IntentMessageInput): IntentMessage {
  return {
    account: input.account,
    batchHash: hashBatch(input.calls),
    module: input.module ?? COMPOSABILITY_MODULE,
    chainId: BigInt(CHAIN_ID),
    nonce: input.nonce ?? 0n,
    validUntil: BigInt(input.validUntil),
  };
}

/**
 * The subset of a viem wallet client this module uses.
 *
 * Declared structurally rather than as `WalletClient` so a test can pass a stub without importing an
 * account, a transport or a chain — and so the surface this file depends on is exactly one method.
 */
export interface IntentSigner {
  signTypedData(args: {
    readonly account: Address;
    readonly domain: IntentDomain | TypedDataDomain;
    readonly types: typeof INTENT_TYPES;
    readonly primaryType: IntentPrimaryType;
    readonly message: IntentMessage;
  }): Promise<Hex>;
}

export interface SignIntentOptions {
  readonly module?: Address;
  readonly nonce?: bigint;
  readonly validUntil: number | bigint;
}

/**
 * Collect the EIP-712 intent signature.
 *
 * `nonce` defaults to 0 and is application bookkeeping only: on-chain replay is stopped by the
 * account's own nonce advancing (docs/08, replay resistance), not by this field. A relayer that
 * keeps a set of submitted nonces supplies the next one through `opts`.
 *
 * The signature returned here must never be treated as authority to execute — see the file header.
 */
export async function signIntent(
  walletClient: IntentSigner,
  account: Address,
  calls: readonly ComposableExecution[],
  opts: SignIntentOptions,
): Promise<Hex> {
  const message = buildIntentMessage({
    account,
    calls,
    ...(opts.module !== undefined ? { module: opts.module } : {}),
    ...(opts.nonce !== undefined ? { nonce: opts.nonce } : {}),
    validUntil: opts.validUntil,
  });

  return walletClient.signTypedData({
    account,
    domain: buildDomain(account),
    types: INTENT_TYPES,
    primaryType: "DeclarativeIntent",
    message,
  });
}