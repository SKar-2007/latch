import { Button, Eyebrow, Panel } from "@/components/ui";
import { BatchPreview } from "@/features/decoder";
import { IntentBuilder } from "@/features/builder";
import { ConnectWallet, SimulationPanel } from "@/features/wallet";
import { ExecutionTracker, SignButton } from "@/features/execute";
import { DemoPanel } from "@/features/demo";
import { useApp, useDispatch } from "@/app/AppProvider";

export interface WorkbenchProps {
  /** Build the batch from the current intent. Supplied by the shell, which owns the dispatch. */
  readonly onBuild: () => void;
}

/**
 * The two-column work area, and the skip link's destination.
 *
 * Left column is the sequence a user walks: connect, author, simulate, sign, track. Right column
 * is what they read against it: the decoded plan, the guarantee that makes it worth signing, and
 * the demo driver. A stale or failed state is announced above the grid rather than buried in the
 * panel that produced it, because the notice has to be seen before anything below it is trusted.
 *
 * `tabIndex={-1}` makes the section focusable — the hero's action button and the skip link both
 * land here.
 */
export function Workbench({ onBuild }: WorkbenchProps) {
  const state = useApp();
  const dispatch = useDispatch();

  return (
    <section
      className="app-workbench"
      id="workbench"
      tabIndex={-1}
      aria-labelledby="workbench-title"
    >
      <div className="page">
        <div className="app-section__head">
          <Eyebrow tone="acid">Build · decode · simulate · sign</Eyebrow>
          <h2 id="workbench-title">The workbench</h2>
        </div>

        {state.error !== null && (
          <div className="app-notice" role="alert">
            <span className="ui-mono">{state.error.code}</span>
            <span>{state.error.message}</span>
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "error/clear" })}>
              Dismiss
            </Button>
          </div>
        )}

        <div className="app-grid">
          <div className="app-col stack">
            <ConnectWallet />
            <IntentBuilder
              bounds={state.bounds}
              policy={state.policy}
              onBoundsChange={(bounds) => dispatch({ type: "bounds/set", bounds })}
              onPolicyChange={(index, policy) => dispatch({ type: "policy/set", index, policy })}
              onBuild={onBuild}
            />
            <SimulationPanel />
            <SignButton />
            <ExecutionTracker />
          </div>

          <div className="app-col stack">
            <BatchPreview
              calls={state.calls}
              policy={state.policy}
              simulation={state.simulation}
            />
            <Panel title="The guarantee">
              <p>
                Atomic by default. <code>SKIP_CALL</code> is opt-in per segment, and selecting it
                names what will be skipped before you accept it.
              </p>
            </Panel>
            <DemoPanel />
          </div>
        </div>
      </div>
    </section>
  );
}
