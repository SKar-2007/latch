import { useApp } from "@/app/AppProvider";
import { Alert, Button, Chip, Panel } from "@/components/ui";
import { CHAIN_NAME } from "@/core/addresses";
import { Phase } from "@/app/state";
import { useSimulation } from "./useSimulation";
import "./wallet.css";

/**
 * The panel that runs the batch before anyone signs it (docs/06, `<SimulationPanel>`).
 *
 * Three rules, each of which is a way to lie if broken:
 *
 * - **D7.** A revert reason is mapped to an actionable sentence; the raw selector or reason is
 *   shown underneath as detail and never in place of the sentence.
 * - **D4.** Green (`Alert tone="pass"`) appears only after the chain has produced an outcome, so
 *   nothing is green while the panel is idle or while the call is in flight.
 * - **Gas is observed or absent.** A number appears only because a node returned one for this call;
 *   an estimate that could not be taken leaves the line off rather than filled in.
 */
export function SimulationPanel() {
  const { phase, calls, simulation } = useApp();
  const { running, canRun, run } = useSimulation();

  const hint =
    calls.length === 0
      ? "There is no batch to simulate yet."
      : phase !== Phase.Previewing
        ? "Simulation runs from the preview. Build the batch first."
        : null;

  return (
    <Panel
      title="Simulation"
      tone={simulation?.ok === true ? "acid" : "default"}
      aside={<Chip>{phase}</Chip>}
    >
      <div className="stack">
        <div className="row w-controls">
          <Button
            variant="acid"
            onClick={() => void run()}
            disabled={!canRun}
            aria-busy={running}
            data-testid="run-simulation"
          >
            {running ? "Simulating…" : "Run simulation"}
          </Button>
          {running && (
            <span className="w-busy" role="status">
              Asking {CHAIN_NAME} to run the batch…
            </span>
          )}
        </div>

        {hint !== null && !running && <p className="w-hint">{hint}</p>}

        {simulation === null ? (
          !running && <p className="w-hint">Not simulated yet. Run it before signing.</p>
        ) : (
          <>
            <Alert tone={simulation.ok ? "pass" : "block"}>
              {simulation.message ?? (simulation.ok ? "Simulation succeeded." : "Simulation failed.")}
            </Alert>

            {!simulation.ok && simulation.revertReason !== undefined && (
              <p className="w-detail">
                raw reason: <span className="ui-mono">{simulation.revertReason}</span>
              </p>
            )}

            {simulation.gasUsed !== undefined && (
              <p className="w-detail">
                gas observed:{" "}
                <span className="ui-mono">{simulation.gasUsed.toString()}</span> (eth_estimateGas)
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
