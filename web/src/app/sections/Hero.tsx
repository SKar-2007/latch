import { Button, Eyebrow } from "@/components/ui";

/**
 * Move the reader to the workbench and put the keyboard on it. `#workbench` carries
 * `tabIndex={-1}` for exactly this: the scroll and the focus land together, so a keyboard user
 * is not left hunting for the section they were just shown.
 */
function focusWorkbench() {
  const target = document.getElementById("workbench");
  if (target === null) return;
  if (typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  target.focus();
}

/**
 * The landing page's claim, stated once: the plan is readable before it is signed.
 *
 * Both actions are honest about what they do — one moves you to the batch you can actually run,
 * the other moves you to the explanation. Both are in-page anchors: the browser's own navigation,
 * no client router, and nothing that can 404 because it pointed outside the served root.
 */
export function Hero() {
  return (
    <section className="app-hero" aria-labelledby="hero-title">
      <div className="page">
        <div className="app-hero__copy">
          <Eyebrow tone="latch">Predicate-gated execution · ERC-8211</Eyebrow>
          <h1 id="hero-title">
            Sign a plan.
            <br />
            Not a guess.
          </h1>
          <p className="app-lead">
            Every resolved value is gated by an inline constraint. Every oracle-derived value is
            gated by a freshness check enforced inside the same atomic batch. If any gate fails,
            nothing in the list executes.
          </p>
          <div className="row app-actions">
            <Button variant="acid" size="lg" onClick={focusWorkbench}>
              Build the demo batch
            </Button>
            {/*
              An anchor wearing the frozen button classes rather than a `<Button>`: it navigates,
              so it must be a link — middle-click and the status bar both matter here. Same visual
              primitive, correct semantics, in-page target only. `#how` is rendered by
              `HowItWorks`, which the shell test asserts exists, so the link cannot dangle.
            */}
            <a className="ui-btn ui-btn--lg" href="#how">
              How it works
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
