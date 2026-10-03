import { Button, Chip, Eyebrow, Panel } from "@/components/ui";
import { BatchPreview } from "@/features/decoder";
import { IntentBuilder } from "@/features/builder";
import { ConnectWallet, SimulationPanel } from "@/features/wallet";
import { ExecutionTracker, SignButton } from "@/features/execute";
import { DemoPanel } from "@/features/demo";
import { useApp, useDispatch } from "@/app/AppProvider";
import { buildDemoBatch } from "@latch/client";
import { DEPLOYMENT, isConfigured } from "@/core/addresses";
import { parseAmount } from "@/core/format";
import "./shell.css";

/**
 * Composition root.
 *
 * Wave 1, seat A owns this file, `shell.css` and `src/app/sections/`. It is deliberately thin:
 * layout, the header rule, and wiring feature components to shared state. Feature components never
 * import each other — they meet here.
 *
 * Until the builder is wired to a real wallet, "Build batch" decodes the committed demo batch so
 * the decoder can be reviewed on day one. `feedGuard` is pinned configuration, not discovery; an
 * unconfigured deployment yields the zero address, which the plan renders as an unnamed target
 * rather than inventing a name for it.
 */
export function AppShell() {
  const state = useApp();
  const dispatch = useDispatch();

  const build = () => {
    const account = state.account ?? "0x0000000000000000000000000000000000000001";
    const feedGuard = isConfigured(DEPLOYMENT.feedGuard) ? DEPLOYMENT.feedGuard : account;

    // The floor is parsed, never defaulted. A minimum output nobody chose is the exact failure the
    // batch exists to prevent, so an unreadable bound stops the build with a message instead.
    const minAmountOut = parseAmount(state.bounds.minOutput, 18);
    if (minAmountOut === null) {
      dispatch({
        type: "error/set",
        error: {
          code: "BAD_MIN_OUTPUT",
          message: `Minimum output "${state.bounds.minOutput}" is not a number. Set it before building.`,
        },
      });
      return;
    }

    dispatch({
      type: "build/ready",
      calls: buildDemoBatch({ account, feedGuard, minAmountOut }),
    });
  };

  return (
    <>
      <header className="app-header">
        <div className="page app-header__inner">
          <a className="app-brand" href="/">
            <span className="app-mark" aria-hidden="true">
              L
            </span>
            <span className="app-wordmark">LATCH</span>
          </a>
          <span className="app-tagline">sign a plan, not a guess</span>
          <div className="row">
            <Chip tone="sunken">Base Sepolia · 84532</Chip>
            <Chip tone="acid">{state.phase}</Chip>
          </div>
        </div>
      </header>

      <main className="page app-main">
        <section className="app-hero">
          <Eyebrow tone="latch">Predicate-gated execution · ERC-8211</Eyebrow>
          <h1>
            Sign a plan.
            <br />
            Not a guess.
          </h1>
          <p className="app-lead">
            Every resolved value is gated by an inline constraint. Every oracle-derived value is
            gated by a freshness check enforced inside the same atomic batch. If any gate fails,
            nothing in the list executes.
          </p>
        </section>

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
              onBuild={build}
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
      </main>

      <footer className="app-footer">
        <div className="page app-footer__inner">
          <span className="ui-mono">LATCH · TEAM CHICKEN ROLL · Open Innovation</span>
          <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "error/clear" })}>
            Clear notices
          </Button>
        </div>
      </footer>
    </>
  );
}
