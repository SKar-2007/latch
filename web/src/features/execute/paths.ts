import { encodeBatch, type ComposableExecution } from "@latch/client";
import type { Address, Hex } from "viem";
import { EXECUTE_COMPOSABLE_SELECTOR, getInjectedProvider } from "@/features/wallet";
import { ExecutionError } from "./errors";

/**
 * Submission paths (docs/06, "Execution paths").
 *
 * | Path | Signed by | Wired here |
 * |---|---|---|
 * | `meeClient.getQuote` / `executeQuote` | MEE payload | **no** — stub |
 * | `meeClient.getFusionQuote` | Fusion payload | **no** — stub |
 * | Bundler UserOp | UserOp | **no** — no bundler configured |
 * | Raw `executeComposable` | the wallet's transaction signature | **yes** |
 *
 * Only the raw path can be wired honestly in this build: the other three need `@biconomy/abstractjs`
 * and a configured bundler or API key, neither of which may be added from here, and V-01 already
 * blocks the MEE deployment path. The stubs throw the reason rather than pretending to run, because
 * a path that silently falls back to the raw one would let a reader believe the batch was sponsored
 * when their own wallet paid for it. `sponsored` is therefore a fact the UI shows, not a hope.
 *
 * The raw path is the debugging and direct-verification path, and it is labelled as such everywhere
 * it appears. One caveat it inherits from the contracts: `executeComposable` accepts only the
 * account, the EntryPoint or the account calling itself (docs/02, note 4). This path sends from the
 * connected wallet, which is the account only in the delegated (EIP-7702) shape the demo uses —
 * elsewhere the node rejects it, and the receipt says so rather than the UI guessing.
 */

export type ExecutionPathId = "raw" | "mee" | "fusion";

export interface ExecutionRequest {
  /** The account the batch runs against, and — on the raw path — the sender. */
  readonly account: Address;
  readonly calls: readonly ComposableExecution[];
}

export interface ExecutionResult {
  readonly txHash: Hex;
}

export interface ExecutionPath {
  readonly id: ExecutionPathId;
  /** Shown in the UI next to the id. Never implies sponsorship the path does not have. */
  readonly label: string;
  /** False means the sender's wallet paid the gas. The UI must say so. */
  readonly sponsored: boolean;
  readonly description: string;
  /** Resolves with the transaction hash, or rejects with an `ExecutionError`. */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * The documented refusal for the two paths that need Biconomy's SDKs.
 *
 * One sentence for both, because both are `meeClient.*` calls (docs/06 lists `getQuote`/`executeQuote`
 * and `getFusionQuote` side by side) and the missing dependency is the same one. The path's own
 * `label` and `description` say which quote flow was asked for.
 */
export const NOT_WIRED_MESSAGE = "MEE path not wired — requires @biconomy/abstractjs";

/**
 * Raw `executeComposable`, sent from the injected wallet.
 *
 * Calldata is the selector docs/03 and the verification log record for the expanded struct form —
 * `0x7eba07b8`, computed from the same signature in `features/wallet/simulate.ts` — followed by the
 * ABI encoding of the exact `ComposableExecution[]` the intent hashes. One encoding, three uses:
 * simulated, signed over, submitted.
 *
 * The write goes through `eth_sendTransaction` on the injected provider and nowhere else: no
 * fallback provider, no retry, no second broadcast. The provider returns the hash the wallet itself
 * computed, which is the hash the receipt is later checked against (docs/07, idempotency).
 */
export const rawPath: ExecutionPath = {
  id: "raw",
  label: "raw executeComposable",
  sponsored: false,
  description:
    "Sent straight from your wallet to the account. Not sponsored — your wallet pays the gas, " +
    "and the signature that authorises it is the transaction signature.",
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const provider = getInjectedProvider();
    if (provider === null) {
      throw new ExecutionError("NO_WALLET", "No wallet was found in this browser, so nothing was submitted.");
    }

    let encoded: Hex;
    try {
      encoded = encodeBatch(request.calls);
    } catch (cause) {
      throw new ExecutionError(
        "BATCH_DOES_NOT_ENCODE",
        `The batch does not encode, so nothing was submitted. ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const data = `${EXECUTE_COMPOSABLE_SELECTOR}${encoded.slice(2)}` as Hex;
    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: request.account, to: request.account, data }],
    });

    if (typeof txHash !== "string" || !TX_HASH_RE.test(txHash)) {
      throw new ExecutionError(
        "NO_TX_HASH",
        "The wallet did not return a transaction hash, so this submission cannot be tracked. " +
          "Check the wallet's activity before sending anything else.",
      );
    }

    return { txHash: txHash as Hex };
  },
};

/**
 * MEE quote → execute. The primary path in docs/07, and the only one that can be sponsored — which
 * is exactly why it must not be faked. V-01 blocks the MEE deployment path until the account's
 * version question is settled; this stub says so instead of silently downgrading to a raw send.
 */
export const meePath: ExecutionPath = {
  id: "mee",
  label: "MEE quote",
  sponsored: true,
  description: "Quote through Biconomy's orchestrator, which can sponsor the gas. Not available in this build.",
  async execute(): Promise<ExecutionResult> {
    throw new ExecutionError("PATH_NOT_WIRED", NOT_WIRED_MESSAGE);
  },
};

/**
 * Fusion quote for an external wallet (MetaMask, Rabby). Same reason as `meePath`: the SDK is not a
 * dependency of this build, so the honest behaviour is a named refusal.
 */
export const fusionPath: ExecutionPath = {
  id: "fusion",
  label: "MEE fusion quote",
  sponsored: true,
  description: "Quote for an external wallet through Biconomy's fusion flow. Not available in this build.",
  async execute(): Promise<ExecutionResult> {
    throw new ExecutionError("PATH_NOT_WIRED", NOT_WIRED_MESSAGE);
  },
};

export const EXECUTION_PATHS: readonly ExecutionPath[] = [rawPath, meePath, fusionPath];

/**
 * The path this build actually uses. Exported as data — not read from a query string or a toggle —
 * so the UI can name it and a test can assert it without clicking anything.
 */
export const activePath: ExecutionPath = rawPath;
