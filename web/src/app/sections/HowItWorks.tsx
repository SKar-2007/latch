import type { ReactNode } from "react";
import { Eyebrow, Panel } from "@/components/ui";

interface Step {
  readonly n: string;
  readonly title: string;
  readonly body: ReactNode;
}

/**
 * The four moves, drawn from docs/11 beat 1 (the plan the user reads) and docs/06 (what the
 * components do). This band is where the grid is meant to be loudest: four hard-edged panels,
 * big numerals, no decoration that is not load-bearing.
 */
const STEPS: readonly Step[] = [
  {
    n: "01",
    title: "Author the intent",
    body: (
      <>
        Set the floor, the slippage preset, the price band and the freshness window. Every segment
        defaults to <code>REVERT_BATCH</code>; <code>SKIP_CALL</code> is opt-in and names what it
        skips before you accept it.
      </>
    ),
  },
  {
    n: "02",
    title: "Review the decoded plan",
    body: (
      <>
        The batch renders as a numbered list, not a hex blob: decoded target and function, which
        parameters are literals and which resolve at execution, and the constraint that gates each
        one.
      </>
    ),
  },
  {
    n: "03",
    title: "One signature",
    body: (
      <>
        The UserOp signature commits to the call data, the batch and every constraint. The EIP-712
        intent adds legibility, expiry and replay scoping — it is not the authorisation.
      </>
    ),
  },
  {
    n: "04",
    title: "Every value gated on-chain",
    body: (
      <>
        Freshness, band and bounds are asserted inside the same atomic call frame as the calls they
        gate. If one gate fails, nothing in the list executes.
      </>
    ),
  },
];

export function HowItWorks() {
  return (
    <section className="app-how" id="how" aria-labelledby="how-title">
      <div className="page">
        <div className="app-section__head">
          <Eyebrow tone="sky">Four steps · one signature</Eyebrow>
          <h2 id="how-title">How it works</h2>
        </div>

        <ol className="app-steps">
          {STEPS.map((step) => (
            <li key={step.n} className="app-step">
              <Panel className="app-step__panel">
                <span className="app-step__num" aria-hidden="true">
                  {step.n}
                </span>
                <Eyebrow tone="latch">Step {step.n}</Eyebrow>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </Panel>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
