import { Alert, Chip, Eyebrow, MonoValue, Panel } from "@/components/ui";
import { useApp } from "@/app/AppProvider";
import type { ComposableExecution, Constraint } from "@latch/client";
import { formatSeconds } from "@/core/format";
import { explainRevert, isActionable, type RevertExplanation } from "./revertReasons";
import "./wallet.css";

/**
 * Simulation panel. Seat C.
 *
 * Three rules, and none of them is stylistic.
 *
 * **D7 — a revert reason is mapped to an actionable sentence.** The mapping lives in
 * `revertReasons.ts`. What arrives here is a sentence and, underneath it, the raw selector.
 *
 * **Gas is displayed as observed.** `eth_estimateGas` is a guess and `eth_call` does not report gas
 * at all, so a number that appears next to a simulation is one the chain actually charged. There is
 * no estimated figure anywhere in this panel, because an estimate next to a result reads as a result.
 *
 * **D3 — nothing here is presented as final.** A simulation is a rehearsal against current state. It
 * is labelled, the moment it was taken is shown, and the raw revert data is kept, because a
 * simulation that succeeded says nothing about what will happen when it is signed.
 */
export function SimulationPanel() {
  const { phase, simulation, calls, bounds } = useApp();

  if (simulation === null) {
    return (
      <Panel title="Simulation" tone="sunken">
        <p className="w-note">
          Not simulated. Run the simulation before signing — it is the only place the gates are
          exercised without committing anything.
        </p>
      </Panel>
    );
  }

  const gates = collectGates(calls);
  const explanation = simulation.ok ? null : explain(simulation.revertReason, gates, bounds.slippageBps);

  return (
    <Panel
      title="Simulation"
      tone={simulation.ok ? "acid" : "default"}
      aside={<Chip tone={simulation.ok ? "acid" : "sunken"}>{simulation.ok ? "passed" : "failed"}</Chip>}
      className="w-panel"
    >
      <div className="w-sim">
        {simulation.ok ? (
          <Alert tone="pass" title="Rehearsed successfully">
            Every gate resolved and the batch completed against current chain state. Nothing was
            committed — this is what signing will attempt, not a receipt.
          </Alert>
        ) : (
          explanation !== null && <RevertNotice explanation={explanation} />
        )}

        <div className="w-row">
          <Chip tone="ink">simulated {new Date(simulation.at).toLocaleTimeString()}</Chip>
          <Chip tone="ink">{phase}</Chip>
          {gates.length > 0 && <Chip tone="sky">{gates.length} gates exercised</Chip>}
        </div>

        {simulation.gasUsed !== undefined && <GasRow gasUsed={simulation.gasUsed} />}

        <p className="w-note">
          A simulation reflects chain state at the moment it ran. The bounds you signed
          (freshness {formatSeconds(bounds.maxStalenessSec)}) are what protect you between then and
          execution.
        </p>
      </div>
    </Panel>
  );
}

/**
 * Gas, as observed.
 *
 * The label says where the number came from, because a gas figure without a provenance reads as a
 * promise about the transaction that has not happened yet.
 */
function GasRow({ gasUsed }: { readonly gasUsed: bigint }) {
  return (
    <div className="w-gas">
      <Eyebrow tone="muted">Gas · observed</Eyebrow>
      <MonoValue value={gasUsed.toLocaleString()} large />
    </div>
  );
}

function RevertNotice({ explanation }: { readonly explanation: RevertExplanation }) {
  return (
    <div className="w-revert">
      <Alert tone={isActionable(explanation) ? "block" : "warn"} title={explanation.title}>
        {explanation.detail}
      </Alert>
      {explanation.gate !== undefined && (
        <p className="w-note ui-mono">gate: {explanation.gate}</p>
      )}
      <details className="w-detail">
        <summary>Raw revert data</summary>
        <MonoValue value={explanation.raw} truncate={false} muted />
      </details>
    </div>
  );
}

function explain(
  revertReason: string | undefined,
  gates: readonly Constraint[],
  slippageBps: number,
): RevertExplanation {
  return explainRevert(revertReason ?? "0x", {
    ...(gates.length === 0 ? {} : { gates }),
    slippageBps,
  });
}

/**
 * Every gate in the batch, as constraints.
 *
 * `calls` is already the decoded `ComposableExecution[]` the reducer holds, so the gates are read
 * straight off it. Re-encoding the batch only to decode it again would be wasted work and would add a
 * place for the two representations to drift.
 */
function collectGates(calls: readonly ComposableExecution[]): readonly Constraint[] {
  return calls.flatMap((call) => call.inputParams.flatMap((param) => param.constraints));
}
