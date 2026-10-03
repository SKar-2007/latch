import type { ComposableExecution } from "@latch/client";
import { Panel } from "@/components/ui";
import type { Policy, SimulationResult } from "@/app/state";

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

/**
 * Wave 1, seat B owns this file.
 *
 * This stub exists so the app compiles while the real decoder is being built. Replace the body,
 * keep the export name and the props above.
 *
 * Three rules are non-negotiable (docs/06, `<BatchPreview>`):
 *   1. `SKIP` renders as "not checked", never as a pass.
 *   2. The constraint's actual operator is shown. `GTE 1000` and `LTE 1000` are not a tick.
 *   3. A `STATIC_CALL` fetcher renders the call that will produce the value, never a value — even
 *      when a simulation has already produced one. Simulated values are labelled simulated.
 *
 * Green (`GateTone "pass"`) is reserved for an outcome the chain has already produced.
 */
export function BatchPreview({ calls }: BatchPreviewProps) {
  if (calls.length === 0) {
    return (
      <Panel title="The plan">
        <p>No batch built yet. Configure an intent and build it to see the decoded plan.</p>
      </Panel>
    );
  }

  return (
    <Panel title={`The plan — ${calls.length} steps`} tone="acid">
      <ol style={{ margin: 0, padding: "var(--s-4) var(--s-6)", listStyle: "decimal" }}>
        {calls.map((_, i) => (
          <li key={i}>
            <code>step {i + 1} — decoder not wired yet</code>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
