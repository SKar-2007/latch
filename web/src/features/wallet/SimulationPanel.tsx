import { Alert, Panel } from "@/components/ui";
import { useApp } from "@/app/AppProvider";

/**
 * Wave 1, seat C owns this file.
 *
 * Stub: replace the body, keep the export name.
 *
 * Rules (docs/06, UI state machine):
 * - `Simulating` must surface the revert reason mapped to something the user can act on. A raw
 *   `ConstraintNotMet` selector is not an error message; "Output was below your 0.5% minimum —
 *   raise slippage or retry" is.
 * - A simulation result belongs to the exact bytes simulated. The reducer already clears it when
 *   the batch or its bounds change; do not cache a copy anywhere else.
 * - Gas is displayed as observed, never estimated and presented as observed.
 */
export function SimulationPanel() {
  const { phase, simulation } = useApp();

  return (
    <Panel title="Simulation" tone={simulation?.ok ? "acid" : "default"}>
      {simulation === null ? (
        <p>Not simulated yet. Run the simulation before signing.</p>
      ) : (
        <Alert tone={simulation.ok ? "pass" : "block"}>
          {simulation.message ?? (simulation.ok ? "Simulation succeeded." : "Simulation failed.")}
        </Alert>
      )}
      <p className="ui-mono" style={{ color: "var(--c-ink-muted)" }}>
        phase: {phase}
      </p>
    </Panel>
  );
}
