import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Chip, Eyebrow, MonoValue, Panel } from "@/components/ui";
import { useApp, useDispatch } from "@/app/AppProvider";
import { mapRevertReason } from "@/features/wallet";
import { writeClient } from "@/core/chain";
import type { Hex } from "@latch/client";
import "./execute.css";

/**
 * Submission and receipt. Seat F.
 *
 * Rule D9, and it is the rule this component is built around:
 *
 * > Never retry a **write** on timeout without first checking whether it landed. Reads fall back;
 * > writes do not.
 *
 * The reason is that a write and a read fail differently. A read that times out did not happen, so
 * retrying it is free. A write that times out may well have been mined — the response was simply
 * lost — so retrying it can spend the same nonce twice, or execute a batch the user believes they
 * cancelled. A UI that offers "retry" on a write timeout without looking first is offering to do
 * exactly that.
 *
 * So this component has three outcomes and never conflates them:
 *
 *   `unknown`  the submission's fate is not known. Look, do not retry.
 *   `landed`   a receipt was found.
 *   `reverted` a receipt was found and it failed. The batch unwound; nothing was committed.
 *
 * `unknown` is not an error state to be styled away. It is the honest answer, and it is the only one
 * of the three that warrants a "check again" button rather than a "try again" one.
 */

/** How long to keep asking before saying `unknown` rather than appearing to hang. */
const CONFIRMATION_ATTEMPTS = 6;
const CONFIRMATION_INTERVAL_MS = 2_500;

export interface ExecutionTrackerProps {
  /** Overridable so a build with a different transport can supply its own reader. */
  readonly confirm?: (hash: Hex) => Promise<"success" | "reverted" | "unknown">;
}

export function ExecutionTracker({ confirm = confirmByReceipt }: ExecutionTrackerProps = {}) {
  const { phase, txHash, receiptStatus, error, calls } = useApp();
  const dispatch = useDispatch();
  const [fate, setFate] = useState<"success" | "reverted" | "unknown">(
    receiptStatus ?? "unknown",
  );
  const [checking, setChecking] = useState(false);
  const [attempts, setAttempts] = useState(0);

  // A new hash restarts the search. Keyed on the hash so a receipt for a previous submission can
  // never be shown against the current one.
  useEffect(() => {
    if (txHash === null) return;
    let cancelled = false;
    setFate("unknown");
    setAttempts(0);

    const search = async () => {
      for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        setChecking(true);
        const result = await confirm(txHash);
        if (cancelled) return;
        setAttempts(attempt + 1);
        if (result !== "unknown") {
          setFate(result);
          setChecking(false);
          dispatch({ type: "submit/receipt", status: result });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_INTERVAL_MS));
      }
      if (!cancelled) {
        setChecking(false);
        // Still unknown after every attempt. Say so rather than implying it failed: it may be pending,
        // and a pending transaction has not been rejected.
        setFate("unknown");
      }
    };

    void search();
    return () => {
      cancelled = true;
    };
    // `confirm` is stable per mount by contract of the default parameter.
  }, [txHash, confirm, dispatch]);

  const recheck = useCallback(async () => {
    if (txHash === null) return;
    setChecking(true);
    const result = await confirm(txHash);
    setChecking(false);
    setFate(result);
    if (result !== "unknown") dispatch({ type: "submit/receipt", status: result });
  }, [txHash, confirm, dispatch]);

  if (txHash === null && error === null) return null;

  /**
   * The revert notice is scoped to a submission.
   *
   * Any `error` in state used to render here, including errors that have nothing to do with signing
   * — a wallet refusal, a missing configuration. That made the tracker claim to be reporting on a
   * transaction that was never sent, and it announced a second `role="alert"` alongside whatever the
   * real source of the error already announced. A submission report is scoped to a submission.
   */
  const mapped = txHash !== null && error !== null ? mapRevertReason(error.message) : null;

  return (
    <Panel
      title="Execution"
      tone={fate === "success" ? "acid" : "default"}
      aside={<FateChip fate={fate} />}
      className="f-panel"
    >
      <div className="f-exec">
        {txHash === null ? (
          <p className="f-note">Nothing has been submitted yet.</p>
        ) : (
          <div className="f-hash">
            <Eyebrow tone="muted">Transaction</Eyebrow>
            <MonoValue value={txHash} truncate={false} />
          </div>
        )}

        {fate === "unknown" && txHash !== null && (
          <Alert tone="warn" title="Not known whether this landed">
            The submission did not report a receipt after {attempts} {attempts === 1 ? "check" : "checks"}.
            That is not a failure: the transaction may be pending, or the node may simply not have it
            yet. <strong>Do not resubmit.</strong> Resubmitting a write that already landed can spend
            the same nonce twice. Check again, or look the hash up on the explorer.
          </Alert>
        )}

        {fate === "reverted" && (
          <Alert tone="block" title="Reverted">
            The transaction was mined and failed, so the whole batch unwound and nothing was committed.
            That is the atomicity guarantee holding, not breaking.
          </Alert>
        )}

        {fate === "success" && (
          <Alert tone="pass" title="Confirmed">
            The receipt reports success. Every gate the batch carried resolved on-chain.
          </Alert>
        )}

        {mapped !== null && (
          <div className="f-revert">
            <Alert tone="block" title="Submission reported a problem">
              {mapped.message}
            </Alert>
            <details className="f-detail">
              <summary>Raw detail</summary>
              <MonoValue value={mapped.revertReason} truncate={false} muted />
            </details>
          </div>
        )}

        <div className="f-row">
          <Chip tone="ink">{phase}</Chip>
          {calls.length > 0 && <Chip tone="sky">{calls.length} entries</Chip>}
          {fate === "unknown" && txHash !== null && (
            <Button variant="ghost" size="sm" onClick={() => void recheck()} disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </Button>
          )}
          {fate === "unknown" && txHash !== null && (
            <span className="f-note">Checking never resubmits.</span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function FateChip({ fate }: { readonly fate: "success" | "reverted" | "unknown" }) {
  if (fate === "success") return <Chip tone="acid">confirmed</Chip>;
  if (fate === "reverted") return <Chip tone="sunken">reverted</Chip>;
  return <Chip tone="sunken">unknown</Chip>;
}

/**
 * Look the hash up.
 *
 * Reads the receipt through `writeClient` rather than `readClient`, and that is deliberate rather than
 * an oversight. `core/chain.ts` splits the two so that reads can fail over between providers; a
 * receipt lookup after a write timeout is exactly the case where provider rotation is *not* safe,
 * because a fallback endpoint that has not yet seen the transaction would report "not found" and be
 * indistinguishable from a transaction that never landed. One provider, asked twice.
 */
async function confirmByReceipt(hash: Hex): Promise<"success" | "reverted" | "unknown"> {
  try {
    const receipt = await writeClient.waitForTransactionReceipt({ hash, timeout: 1, retryCount: 0 });
    return receipt.status === "success" ? "success" : "reverted";
  } catch {
    return "unknown";
  }
}
