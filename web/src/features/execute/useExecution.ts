import { useCallback, useMemo, useRef } from "react";
import { createWalletClient, custom, type Hex, type TransactionReceipt } from "viem";
import type { ComposableExecution } from "@latch/client";
import { useApp, useDispatch } from "@/app/AppProvider";
import { Phase } from "@/app/state";
import { CHAIN_NAME, COMPOSABILITY_MODULE } from "@/core/addresses";
import { EXPECTED_CHAIN_ID, LATCH_CHAIN, writeClient } from "@/core/chain";
import { hashBatch, signIntent, type IntentSigner } from "@/core/intent";
import { getInjectedProvider } from "@/features/wallet";
import { ExecutionError, mapWalletError } from "./errors";
import { setExecutionRecord, useExecutionRecord, type ExecutionRecord } from "./executionStore";
import { activePath, type ExecutionPath } from "./paths";

/**
 * The signature step's effects: EIP-712 intent, then submission, then the receipt.
 *
 * `SignButton` renders; this hook decides. Every dispatch here is a legal move of the frozen state
 * machine, and the two failure surfaces are deliberately different because they are different
 * facts:
 *
 * - **Before a transaction exists**, a refusal or a wallet error comes back as `sign/rejected`.
 *   The machine has no `awaitingSignature → failed` edge (there is nothing to have failed — no
 *   transaction was sent), so the honest landing is `building` with a sentence the user can act on.
 * - **After `submit/start`**, anything that goes wrong is a `fail`, and the receipt wait that timed
 *   out says *unknown* rather than *reverted*: D9 forbids resending a write whose fate is not known.
 *
 * The receipt is awaited on `writeClient` — one pinned provider, no fallback rotation — and is
 * never retried. The transaction itself is a single `eth_sendTransaction` on the injected wallet;
 * there is no code path here that can broadcast twice.
 */

/** How long an intent stays valid. Long enough to read the plan, short enough to matter. */
const DEFAULT_TTL_SECONDS = 15 * 60;

/** Receipt wait. On expiry the outcome is `unknown`, never `reverted`. */
const RECEIPT_TIMEOUT_MS = 120_000;
const RECEIPT_POLL_MS = 4_000;

export interface UseExecutionOptions {
  /** Overrides "now" when the intent's expiry is computed. Used by tests and rehearsed demos. */
  readonly nowSeconds?: number;
}

export interface ExecutionControl {
  readonly path: ExecutionPath;
  /** Why signing is not offered. Empty means every gate has been answered. */
  readonly blockers: readonly string[];
  readonly ready: boolean;
  /** True while the wallet or the receipt is being waited on. */
  readonly busy: boolean;
  readonly record: ExecutionRecord;
  /** The expiry the next signature would carry. */
  readonly validUntil: number;
  /** `keccak256(abi.encode(calls))` of the batch on screen, or null if it does not encode. */
  readonly batchHash: Hex | null;
  readonly run: () => Promise<void>;
}

export function safeBatchHash(calls: readonly ComposableExecution[]): Hex | null {
  if (calls.length === 0) return null;
  try {
    return hashBatch(calls);
  } catch {
    return null;
  }
}

export function useExecution(options: UseExecutionOptions = {}): ExecutionControl {
  const { phase, calls, account, chainId, moduleInstalled, simulation } = useApp();
  const dispatch = useDispatch();
  const record = useExecutionRecord();
  const inFlight = useRef(false);

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (phase !== Phase.Previewing) out.push("Build and preview a batch first.");
    if (simulation === null) {
      out.push("Run the simulation — it is the only place the gates are exercised.");
    } else if (!simulation.ok) {
      out.push("The last simulation failed. Fix the bound it named, then run it again.");
    }
    if (calls.length === 0) out.push("There is no batch to sign.");
    if (account === null) out.push("Connect a wallet.");
    if (chainId !== EXPECTED_CHAIN_ID) {
      out.push(`This wallet is on chain ${chainId}. Switch to ${CHAIN_NAME} (${EXPECTED_CHAIN_ID}).`);
    }
    if (moduleInstalled !== true) {
      out.push("The account's module status has not come back as installed, so the batch cannot run yet.");
    }
    return out;
  }, [phase, simulation, calls, account, chainId, moduleInstalled]);

  const validUntil = useMemo(
    () => (options.nowSeconds ?? Math.floor(Date.now() / 1000)) + DEFAULT_TTL_SECONDS,
    [options.nowSeconds],
  );

  const batchHash = useMemo(() => safeBatchHash(calls), [calls]);

  const busy = phase === Phase.AwaitingSignature || phase === Phase.Submitting;

  const run = useCallback(async (): Promise<void> => {
    if (inFlight.current || blockers.length > 0 || account === null) return;
    inFlight.current = true;

    const batch = calls;
    dispatch({ type: "sign/start" });
    setExecutionRecord({
      intentStatus: "awaiting",
      validUntil,
      batchHash: safeBatchHash(batch),
      signature: null,
      gasUsed: null,
    });

    let intentSigned = false;
    let submitted = false;

    try {
      const provider = getInjectedProvider();
      if (provider === null) {
        throw new ExecutionError(
          "NO_WALLET",
          "No wallet was found in this browser, so the intent was not signed and nothing was submitted.",
        );
      }

      // retryCount 0: a wallet prompt is a write. It is never replayed by the transport.
      const walletClient = createWalletClient({
        chain: LATCH_CHAIN,
        transport: custom(provider, { retryCount: 0 }),
      });

      const signer: IntentSigner = {
        signTypedData: (args) => walletClient.signTypedData(args),
      };

      await signIntent(signer, account, batch, {
        validUntil,
        nonce: 0n,
        module: COMPOSABILITY_MODULE,
      });
      intentSigned = true;
      setExecutionRecord({ intentStatus: "signed" });

      const { txHash } = await activePath.execute({ account, calls: batch });
      submitted = true;
      dispatch({ type: "submit/start", txHash });

      let receipt: TransactionReceipt;
      try {
        receipt = await writeClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: RECEIPT_TIMEOUT_MS,
          pollingInterval: RECEIPT_POLL_MS,
        });
      } catch {
        // D9. The transaction may be pending or may already be mined; either way the answer is to
        // look, never to send again. "Unknown" is reported as a failure of information, not of the
        // batch, and the message says what to do next.
        throw new ExecutionError(
          "RECEIPT_UNKNOWN",
          "No receipt arrived within two minutes, so this transaction's fate is unknown. It may still " +
            "be pending — look the hash up before sending anything again. A write is never retried " +
            "until it is known not to have landed.",
        );
      }

      // A receipt that carries no gas leaves the record at null rather than at `undefined`: the
      // field means "the chain told us this", and an absent fact must render as absent, not crash
      // the tracker that reports it.
      const observedGas = (receipt as { readonly gasUsed?: bigint }).gasUsed ?? null;
      setExecutionRecord({ gasUsed: observedGas });
      dispatch({ type: "submit/receipt", status: receipt.status === "success" ? "success" : "reverted" });
    } catch (cause) {
      const mapped = mapWalletError(cause);
      if (!submitted) {
        if (!intentSigned) setExecutionRecord({ intentStatus: "rejected" });
        dispatch({ type: "sign/rejected", message: mapped.message });
        // The rejection action owns the code for a refusal; any other pre-submission failure keeps
        // its own code so the notice above the grid names the real cause.
        if (!mapped.rejection) {
          dispatch({ type: "error/set", error: { code: mapped.code, message: mapped.message } });
        }
      } else {
        dispatch({ type: "fail", error: { code: mapped.code, message: mapped.message } });
      }
    } finally {
      inFlight.current = false;
    }
  }, [account, blockers.length, calls, dispatch, validUntil]);

  return { path: activePath, blockers, ready: blockers.length === 0, busy, record, validUntil, batchHash, run };
}
