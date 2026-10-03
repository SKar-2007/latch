import { Panel } from "@/components/ui";
import { useApp } from "@/app/AppProvider";

/**
 * Wave 2, seat G owns this file.
 *
 * Stub: replace the body, keep the export name.
 *
 * Shows submission, receipt and decoded events. A dropped or reverted submission moves the machine
 * to `failed` with a message the user can act on — never a bare status code.
 */
export function ExecutionTracker() {
  const { phase, txHash, receiptStatus, error } = useApp();

  if (txHash === null && error === null) return null;

  return (
    <Panel title="Execution" tone={receiptStatus === "success" ? "acid" : "default"}>
      <div className="stack">
        <span className="ui-mono">{txHash ?? "no transaction submitted"}</span>
        <span className="ui-mono" style={{ color: "var(--c-ink-muted)" }}>
          {phase}
          {receiptStatus !== null ? ` · ${receiptStatus}` : ""}
        </span>
        {error !== null && <span className="ui-mono">{error.message}</span>}
      </div>
    </Panel>
  );
}
