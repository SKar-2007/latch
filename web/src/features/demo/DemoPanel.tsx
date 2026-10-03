import { useState } from "react";
import { buildDemoBatch, buildFailingDemoBatch, type DemoBatchOptions } from "@latch/client";
import { Alert, Button, Chip, Eyebrow, MonoValue, Panel } from "@/components/ui";
import { useApp, useDispatch } from "@/app/AppProvider";
import { canTransition, Phase, type AppState } from "@/app/state";
import { CHAIN_ID, DEPLOYMENT, isConfigured } from "@/core/addresses";
import { parseAmount } from "@/core/format";
import { BEATS, DEFAULT_BEAT, isBeatDone, phaseSentence } from "./beats";
import { probeMockOracle, pushAnswerOutOfBand } from "./oracle";
import "./demo.css";

export interface DemoPanelProps {
  /** Called instead of the panel's own failing build. Optional seam; the shell supplies none. */
  readonly onFailingBatch?: () => void;
  /** Called instead of the panel's own `build/reset`. Optional seam; the shell supplies none. */
  readonly onReset?: () => void;
}

/**
 * The presenter's control surface for the three-minute run in docs/11-demo-script.md.
 *
 * It is self-sufficient: it reads `useApp()` and dispatches `useDispatch()` itself, so the shell
 * can render `<DemoPanel />` with no props and every beat of the script is reachable. The two
 * optional props are overrides, not requirements — when they are absent the panel does the work.
 *
 * Three rules are structural rather than cosmetic:
 *
 * 1. **Nothing changes silently.** Every control carries a sentence describing what it will do
 *    before it does it, because this panel runs in front of an audience and a button that
 *    quietly swaps the plan is a button that embarrasses the presenter.
 * 2. **The oracle is not deployed, and the panel says so.** `MockOracle` is *not started* in
 *    CHECKLIST's demo-readiness table and has no slot in `DEPLOYMENT`, so the driver reads
 *    `VITE_MOCK_ORACLE`, renders `not configured` when it is absent, and leaves the push button
 *    disabled (rule D10). It never invents an address and never claims a price moved (rule D4:
 *    nothing has an outcome before the chain produced one).
 * 3. **The checklist is derived, not asserted.** Six rows, each printing the condition that
 *    marks it done, so the panel is a stage prop the presenter can trust rather than a progress
 *    bar that is optimistic about its own progress.
 *
 * Demo-only facts live in `useState` (the selected beat, the confirmed push). Phase, batch and
 * receipt are never copied: there is one machine and this panel only reads it.
 */

/** Why the plan controls are unavailable, or null when they may run. */
function loadBlocker(state: AppState): string | null {
  if (state.account === null) {
    return "Connect the demo account first — the plan is built against its balances, not a placeholder.";
  }
  if (state.phase === Phase.ModuleMissing) {
    return "This account cannot run a batch: the composability module is missing.";
  }
  if (state.phase === Phase.Submitting) {
    return "A submission is in flight. Wait for the receipt before loading a new plan.";
  }
  if (!canTransition(state.phase, Phase.Building) && !canTransition(state.phase, Phase.Previewing)) {
    return `The app is in phase "${state.phase}", which has no path to a preview. Finish that step first.`;
  }
  return null;
}

export function DemoPanel({ onFailingBatch, onReset }: DemoPanelProps) {
  const state = useApp();
  const dispatch = useDispatch();

  const [oracle] = useState(() => probeMockOracle());
  const [oraclePush, setOraclePush] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [selectedBeat, setSelectedBeat] = useState(DEFAULT_BEAT.id);

  const blocker = loadBlocker(state);
  const floor = parseAmount(state.bounds.minOutput, 18);
  const feedGuardConfigured = isConfigured(DEPLOYMENT.feedGuard);
  const facts = {
    state,
    oraclePushed: oraclePush !== null,
    oracleConfigured: oracle.configured,
  };
  const selected = BEATS.find((beat) => beat.id === selectedBeat) ?? DEFAULT_BEAT;

  const loadPlan = (variant: "happy" | "failing"): void => {
    if (blocker !== null || state.account === null) return;

    // The floor is parsed, never defaulted: a minimum output nobody chose is the exact failure
    // this batch exists to prevent, so an unreadable bound stops here with a message instead.
    if (floor === null) {
      dispatch({
        type: "error/set",
        error: {
          code: "BAD_MIN_OUTPUT",
          message:
            `Minimum output "${state.bounds.minOutput}" is not a number. Set it in the intent ` +
            "bounds, then load the plan again.",
        },
      });
      return;
    }

    const options: DemoBatchOptions = {
      account: state.account,
      // An unconfigured FeedGuard falls back to the session account, exactly as the shell's own
      // build does, so the plan still decodes as an unnamed target rather than failing to encode.
      // The note under beat 1 says so out loud: a guard that is not deployed must not look deployed.
      feedGuard: feedGuardConfigured ? DEPLOYMENT.feedGuard : state.account,
      minAmountOut: floor,
    };
    const calls = variant === "failing" ? buildFailingDemoBatch(options) : buildDemoBatch(options);

    // A new plan invalidates the run that produced the last receipt. Clearing first is what keeps
    // the checklist honest: beats 3 and 4 describe the plan now in the decoder, not the one before it.
    dispatch({ type: "build/reset" });
    dispatch({ type: "build/ready", calls });
  };

  const handleFailing = (): void => {
    if (onFailingBatch !== undefined) {
      onFailingBatch();
      return;
    }
    loadPlan("failing");
  };

  const handleReset = (): void => {
    setSelectedBeat(DEFAULT_BEAT.id);
    setOraclePush(null);
    if (onReset !== undefined) {
      onReset();
      return;
    }
    dispatch({ type: "build/reset" });
  };

  const driveOracle = async (): Promise<void> => {
    // Disabled in the UI when unconfigured; returning first is what makes a forced click a
    // no-op rather than an accidental claim that a price moved.
    if (!oracle.configured || oracle.address === null || pushing) return;
    if (state.account === null) {
      dispatch({
        type: "error/set",
        error: {
          code: "DEMO_NO_ACCOUNT",
          message: "Connect the demo account first — the push is sent from it.",
        },
      });
      return;
    }
    if (state.chainId !== CHAIN_ID) {
      dispatch({
        type: "error/set",
        error: {
          code: "WRONG_CHAIN",
          message:
            `This wallet is on chain ${state.chainId}. Switch to Base Sepolia (${CHAIN_ID}) ` +
            "before driving the oracle.",
        },
      });
      return;
    }

    setPushing(true);
    try {
      const outcome = await pushAnswerOutOfBand({ oracle: oracle.address, from: state.account });
      if (!outcome.ok) {
        dispatch({
          type: "error/set",
          error: { code: "ORACLE_PUSH_FAILED", message: outcome.message },
        });
        return;
      }
      setOraclePush(outcome.hash);
    } finally {
      setPushing(false);
    }
  };

  return (
    <Panel
      title="Demo driver"
      tone="latch"
      className="d-panel"
      aside={<Chip tone="ink">{state.phase}</Chip>}
    >
      <div className="d-panel__body">
        <section className="d-block" aria-label="Beat checklist">
          <Eyebrow tone="muted">Beat checklist · docs/11</Eyebrow>
          <ul className="d-beats" aria-label="Beat checklist">
            {BEATS.map((beat) => {
              const done = isBeatDone(beat.id, facts);
              const isSelected = beat.id === selected.id;
              return (
                <li key={beat.id} className="d-beat">
                  <button
                    type="button"
                    className="d-beat__btn"
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => setSelectedBeat(beat.id)}
                  >
                    <span className="d-beat__num ui-mono">{beat.id}</span>
                    <span className="d-beat__title">{beat.title}</span>
                    <span className="d-beat__rule ui-mono">{beat.rule}</span>
                    <Chip tone={done ? "ink" : "sunken"}>{done ? "done" : "pending"}</Chip>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="d-cue">
            <Eyebrow tone="sky">
              Beat {selected.id} · {selected.title} · {selected.budget}
            </Eyebrow>
            <p className="d-cue__line">{selected.cue}</p>
          </div>
        </section>

        <section className="d-ctl" aria-label="Beat 1 · the plan">
          <Eyebrow tone="muted">Beat 1 · the plan</Eyebrow>
          <p className="d-ctl__does">
            Replaces the plan in the decoder with the six-entry demo batch, built against{" "}
            {state.account === null ? (
              "no account yet"
            ) : (
              <MonoValue value={state.account} truncate />
            )}{" "}
            with your floor of <MonoValue value={state.bounds.minOutput} /> WETH and a{" "}
            {state.bounds.maxStalenessSec}s freshness gate. Nothing is signed and nothing is sent.
          </p>
          {blocker !== null && <p className="d-note">{blocker}</p>}
          {!feedGuardConfigured && (
            <p className="d-note">
              FeedGuard is not configured (VITE_FEED_GUARD is unset), so step 1's freshness gate
              targets the session account and decodes as an unnamed target. Deploy FeedGuard before
              rehearsing beats 1 and 5.
            </p>
          )}
          <div className="row">
            <Button variant="acid" disabled={blocker !== null} onClick={() => loadPlan("happy")}>
              Load demo batch
            </Button>
            <Chip tone="sunken">{state.calls.length} entries in the plan</Chip>
          </div>
        </section>

        <section className="d-ctl" aria-label="Beat 2 · the signature">
          <Eyebrow tone="muted">Beat 2 · the signature</Eyebrow>
          <p className="d-ctl__does">
            SignButton owns this beat; this panel only reports where the flow is. Phase{" "}
            <Chip tone="ink">{state.phase}</Chip> — {phaseSentence(state.phase)}.
          </p>
        </section>

        <section className="d-ctl" aria-label="Beat 3 · the success">
          <Eyebrow tone="muted">Beat 3 · the success</Eyebrow>
          <p className="d-ctl__does">
            Loads the same six entries again, clearing the failing plan and the last receipt, so the
            decoder shows the batch that is meant to succeed. Same builder, same bounds — only this
            copy and the outcome differ from beat 1.
          </p>
          <div className="row">
            <Button variant="acid" disabled={blocker !== null} onClick={() => loadPlan("happy")}>
              Load happy batch
            </Button>
          </div>
        </section>

        <section className="d-ctl" aria-label="Beat 4 · the failure">
          <Eyebrow tone="muted">Beat 4 · the failure</Eyebrow>
          <p className="d-ctl__does">
            Loads the same six entries with the swap floor raised to 2^200 — a gate that cannot hold,
            so the batch refuses instead of usually refusing. It replaces the plan in the decoder;
            nothing is submitted from here.
          </p>
          <div className="row">
            <Button variant="danger" disabled={blocker !== null} onClick={handleFailing}>
              Load failing batch
            </Button>
          </div>
        </section>

        <section className="d-ctl" aria-label="Beat 5 · the freshness gate">
          <Eyebrow tone="muted">Beat 5 · the freshness gate</Eyebrow>
          <p className="d-ctl__does">
            Reads the oracle's current answer, then pushes ten times it through{" "}
            <code>setAnswer</code> — far outside any band this plan could have signed — so the gate
            refuses between signing and execution. One wallet prompt, one receipt; the beat is only
            marked done once that receipt is in.
          </p>

          {!oracle.configured ? (
            <Alert tone="warn" title="MockOracle not configured">
              <p>
                {oracle.reason}. This panel cannot move a price, so beat 5 stays where it is: narrate
                5b (staleness) instead, or say the push did not run. Nothing here reports a price it
                did not move.
              </p>
              <p className="d-mono">
                deploy first: forge create contracts/mocks/MockOracle.sol:MockOracle --rpc-url
                &quot;$RPC&quot; --private-key &quot;$DEPLOYER_KEY&quot; --broadcast
              </p>
            </Alert>
          ) : (
            <div className="d-oracle">
              <p className="d-ctl__does">
                Aggregator <MonoValue value={oracle.address ?? ""} truncate /> — testnet mock
                only. <code>FeedGuard</code> reads it as an ordinary aggregator.
              </p>
              <p className="d-note">
                {oraclePush === null ? (
                  "No push has been confirmed yet."
                ) : (
                  <>
                    Pushed and mined: <MonoValue value={oraclePush} truncate />
                  </>
                )}
              </p>
            </div>
          )}

          <div className="row">
            <Button
              variant="danger"
              disabled={!oracle.configured || pushing}
              onClick={() => void driveOracle()}
            >
              {pushing ? "Pushing…" : "Drive price out of band"}
            </Button>
          </div>
        </section>

        <section className="d-ctl" aria-label="Beat 6 · the honesty">
          <Eyebrow tone="muted">Beat 6 · the honesty</Eyebrow>
          <p className="d-ctl__does">
            Not demonstrated here: a fresh price that is inside the band but manipulated, parking a
            failed batch instead of reverting it, and audit status — the Honesty section carries the
            full list. Say it before the close, not after it.
          </p>
        </section>

        <section className="d-ctl d-ctl--last" aria-label="Reset">
          <Eyebrow tone="muted">Reset</Eyebrow>
          <p className="d-ctl__does">
            Clears the plan, the receipt and the marks this panel keeps, so the checklist starts
            over. The bounds you set stay exactly as they are.
          </p>
          <div className="row">
            <Button variant="ghost" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </section>
      </div>
    </Panel>
  );
}
