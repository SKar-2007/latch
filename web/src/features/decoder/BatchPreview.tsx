import { useMemo } from "react";
import {
  decodeBatch,
  encodeBatch,
  type ComposableExecution,
  type StepView,
} from "@latch/client";
import { Alert, Button, Panel } from "@/components/ui";
import type { Policy, SimulationResult } from "@/app/state";
import { PlanSummary } from "./PlanSummary";
import { StepRow } from "./StepRow";
import "./decoder.css";

export interface BatchPreviewProps {
  /** The batch under review. Rendered as a numbered plan, never as hex. */
  readonly calls: readonly ComposableExecution[];
  /** Address to display-name table. Supplied by the caller, never inferred. */
  readonly names?: Readonly<Record<string, string>>;
  /** Failure policy per entry, so the plan can show which steps are opted out of atomicity. */
  readonly policy?: readonly Policy[];
  /** Present only when a simulation has actually run for these exact bytes. */
  readonly simulation?: SimulationResult | null;
  readonly onEdit?: () => void;
}

type DecodeOutcome =
  | { readonly ok: true; readonly steps: readonly StepView[] }
  | { readonly ok: false; readonly reason: string };

/**
 * `decodeBatch` reads encoded calldata, so the entries are round-tripped through `encodeBatch` —
 * which validates them first. A batch the engine would reject at signing time is reported here as a
 * decode failure rather than thrown out of render.
 */
function decodeSteps(
  calls: readonly ComposableExecution[],
  names: Readonly<Record<string, string>> | undefined,
): DecodeOutcome {
  try {
    return { ok: true, steps: decodeBatch(encodeBatch(calls), names !== undefined ? { names } : {}) };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * The decoder. The reason this product exists: a user cannot review a hex blob, so the batch is
 * rendered as a numbered plan of what will be called, with what, under which gates, and what may
 * still change before execution.
 *
 * Three rules are non-negotiable (docs/06, `<BatchPreview>`; brief D1–D4):
 *
 *   1. `SKIP` renders as "not checked", never as a pass.
 *   2. The constraint's actual operator is shown. `≥ 1000` and `≤ 1000` are not a tick.
 *   3. A `STATIC_CALL` fetcher renders the call that will produce the value, never a value — even
 *      when a simulation has already produced one. Simulated values are labelled simulated.
 *   4. Only `checked | not-checked | any-of | undecodable` tones are emitted. Green (`pass`) belongs
 *      to an outcome the chain has already produced, and nothing here has run.
 */
export function BatchPreview({ calls, names, policy, simulation, onEdit }: BatchPreviewProps) {
  const decoded = useMemo(() => decodeSteps(calls, names), [calls, names]);

  if (calls.length === 0) {
    return (
      <Panel title="The plan">
        <p>No batch built yet. Configure an intent and build it to see the decoded plan.</p>
      </Panel>
    );
  }

  if (!decoded.ok) {
    return (
      <Panel title="The plan">
        <Alert tone="warn" title="this batch cannot be decoded">
          <p>
            The entries failed validation before they could be read back, so there is nothing honest
            to show. Nothing is hidden — the batch itself is the problem.
          </p>
          <p className="dec-error-reason">{decoded.reason}</p>
        </Alert>
      </Panel>
    );
  }

  const { steps } = decoded;

  return (
    <Panel
      title={`The plan — ${steps.length} steps`}
      tone="acid"
      aside={onEdit !== undefined ? <Button size="sm" onClick={onEdit}>Edit</Button> : undefined}
    >
      <div className="dec">
        {simulation != null && <SimulationBanner simulation={simulation} />}
        <PlanSummary steps={steps} />
        <ol className="dec-steps">
          {steps.map((step) => (
            <StepRow
              key={step.index}
              step={step}
              names={names}
              policy={policy?.[step.index]}
            />
          ))}
        </ol>
      </div>
    </Panel>
  );
}

/**
 * The banner above the plan.
 *
 * A simulation is an `eth_call` over these exact bytes: evidence about the batch, not something the
 * chain produced. It is deliberately `info` rather than any outcome tone, it never carries a green,
 * and it never leaks its numbers into a parameter line (docs/06, `<BatchPreview>` rule 3; brief D3).
 */
function SimulationBanner({ simulation }: { readonly simulation: SimulationResult }) {
  const at = new Date(simulation.at).toLocaleTimeString();

  return (
    <div className="dec-sim">
      <Alert tone="info" title="simulated — not guaranteed">
        <p>
          An <code>eth_call</code> over these exact bytes, run at <span className="ui-mono">{at}</span>.
          Nothing has executed: this is not a result the chain produced, and execution can still
          differ from it.
        </p>
        {simulation.message !== undefined && (
          <p className="dec-sim__message">{simulation.message}</p>
        )}
      </Alert>
    </div>
  );
}
