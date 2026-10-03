import { Alert, Chip, Eyebrow, MonoValue, Panel } from "@/components/ui";
import { useApp } from "@/app/AppProvider";
import { formatDuration } from "@/core/format";
import { activePath } from "./paths";
import { safeBatchHash } from "./useExecution";
import { useExecutionRecord, type IntentStatus } from "./executionStore";
import "./execute.css";

/**
 * Submission, receipt and the intent trail. Seat F.
 *
 * The panel reads state; it performs no I/O. The receipt is awaited once, in `useExecution`, on the
 * pinned write provider — this component never polls, never retries and never dispatches a
 * submission of its own, because two components racing to report the same receipt is how a state
 * machine ends up in a phase nobody put it in.
 *
 * Two rules shape what it renders:
 *
 * - **D9 / docs/07.** A write whose receipt never arrived is *unknown*, not failed, and the message
 *   says to look before sending anything again. There is no "try again" button here: resending a
 *   transaction that may already have landed is the double-submit hazard.
 * - **D4.** Green is only legal after the chain produced an outcome, so the pass alert and the acid
 *   chip appear on a receipt status and nothing else.
 *
 * The EIP-712 intent is reported as presentation and bookkeeping — signed, rejected or not
 * requested, with the `validUntil` it carried — and never as the thing that authorised anything.
 */

export interface ExecutionTrackerProps {
  /** Merged into the panel's class list. The tracker takes no other inputs. */
  readonly className?: string;
}

const INTENT_LABEL: Record<IntentStatus, string> = {
  "not-requested": "not requested",
  awaiting: "awaiting signature",
  signed: "signed",
  rejected: "rejected",
};

function explorerBase(): string | null {
  const raw: unknown = import.meta.env.VITE_EXPLORER_URL;
  return typeof raw === "string" && /^https?:\/\//.test(raw) ? raw.replace(/\/+$/, "") : null;
}

export function ExecutionTracker({ className }: ExecutionTrackerProps = {}) {
  const { phase, txHash, receiptStatus, error, calls, simulation } = useApp();
  const record = useExecutionRecord();
  const path = activePath;

  // A signature describes one batch. If the batch on screen is not that batch, the record is not
  // evidence of anything the user is looking at, and it is reported as not requested rather than
  // quietly carried over.
  const currentHash = safeBatchHash(calls);
  const forThisBatch = record.batchHash !== null && currentHash !== null && record.batchHash === currentHash;
  const intentStatus: IntentStatus = forThisBatch ? record.intentStatus : "not-requested";
  const superseded = record.intentStatus !== "not-requested" && !forThisBatch;

  const happened = whatHappened(phase, receiptStatus, error, txHash);
  const explorer = explorerBase();

  return (
    <Panel
      title="Execution"
      tone={receiptStatus === "success" ? "acid" : "default"}
      aside={<Chip tone={receiptStatus === "success" ? "acid" : "sunken"}>{receiptStatus ?? phase}</Chip>}
      className={["f-panel", className ?? ""].filter(Boolean).join(" ")}
      data-testid="execution-tracker"
    >
      <div className="f-exec">
        <section className="f-block">
          <Eyebrow tone="muted">Execution path</Eyebrow>
          <div className="f-row">
            <Chip tone="ink">{path.id}</Chip>
            <span className="f-path__label">{path.label}</span>
            <Chip tone={path.sponsored ? "sky" : "sunken"}>
              {path.sponsored ? "sponsored" : "not sponsored"}
            </Chip>
          </div>
          <p className="f-note">{path.description}</p>
        </section>

        <section className="f-block">
          <Eyebrow tone="muted">EIP-712 intent</Eyebrow>
          <div className="f-row">
            <Chip tone={intentStatus === "signed" ? "ink" : "sunken"}>{INTENT_LABEL[intentStatus]}</Chip>
            {record.validUntil !== null && forThisBatch && (
              <Chip tone="ink">
                validUntil {record.validUntil} · {formatDuration(record.validUntil - Math.floor(Date.now() / 1000))} left
              </Chip>
            )}
          </div>
          {superseded && (
            <p className="f-note">
              A signature exists for an earlier version of this batch. It does not describe what is on
              screen, so it is not offered as one.
            </p>
          )}
          <p className="f-note">
            Presentation, expiry and replay scoping only. Nothing on-chain reads this signature; the
            transaction signature is the trust root.
          </p>
        </section>

        <section className="f-block">
          <Eyebrow tone="muted">Transaction</Eyebrow>
          {txHash === null ? (
            <p className="f-note">Nothing has been submitted yet.</p>
          ) : (
            <>
              <MonoValue value={txHash} truncate={false} />
              {explorer === null ? (
                <p className="f-note">
                  Block explorer link unavailable — no explorer base URL is configured. Paste the hash
                  into an explorer by hand if you need to.
                </p>
              ) : (
                <a className="f-link" href={`${explorer}/tx/${txHash}`}>
                  View on explorer
                </a>
              )}
            </>
          )}
        </section>

        <section className="f-block">
          <Eyebrow tone="muted">Receipt</Eyebrow>
          <div className="f-row">
            <Chip tone={receiptStatus === "success" ? "acid" : "sunken"}>
              {receiptStatus ?? "no receipt yet"}
            </Chip>
            {record.gasUsed != null && (
              <Chip tone="ink">
                gas used <span className="ui-mono">{record.gasUsed.toString()}</span>
              </Chip>
            )}
            {simulation?.gasUsed != null && record.gasUsed != null && (
              <Chip tone="sunken">
                simulated <span className="ui-mono">{simulation.gasUsed.toString()}</span>
              </Chip>
            )}
          </div>
          {record.gasUsed == null && (
            <p className="f-note">
              No gas observed yet. A number appears only once a receipt reports one — never as an
              estimate dressed up as a result.
            </p>
          )}
        </section>

        {receiptStatus === "success" && (
          <Alert tone="pass" title="Confirmed">
            The receipt reports success: every gate the batch carried was evaluated on-chain, and the
            batch executed in one call frame.
          </Alert>
        )}

        {receiptStatus === "reverted" && (
          <Alert tone="block" title="Reverted">
            The transaction was mined and failed, so the whole batch unwound and nothing was
            committed — no approval, no transfer, no partial outcome. Run the simulation again to see
            which bound refused.
          </Alert>
        )}

        <section className="f-block">
          <Eyebrow tone="muted">What happened</Eyebrow>
          <p className="f-happened">{happened}</p>
        </section>
      </div>
    </Panel>
  );
}

/**
 * One sentence, driven by the receipt first and the error second.
 *
 * A receipt is a fact the chain produced; an error is a fact this client observed. When both exist
 * the receipt wins, because the whole point of the tracker is to report what the chain did.
 */
function whatHappened(
  phase: string,
  receiptStatus: "success" | "reverted" | null,
  error: { readonly code: string; readonly message: string } | null,
  txHash: `0x${string}` | null,
): string {
  if (receiptStatus === "success") {
    return "The batch was mined successfully. Every value the plan left open was resolved on-chain, and every gate either passed or the batch would have reverted.";
  }
  if (receiptStatus === "reverted") {
    return "The batch was mined and reverted, so it committed nothing. The bounds on screen are the bounds that refused it.";
  }
  if (error !== null) return error.message;
  if (receiptStatus === null && txHash !== null) {
    return "Submitted. The receipt is being awaited on the pinned write provider; it is checked, never resent.";
  }
  if (phase === "awaitingSignature") return "Waiting for the wallet to answer the signature request.";
  if (phase === "simulating") return "Simulating. Signing opens when the chain has answered.";
  return "Nothing has been submitted yet.";
}
