import { useState } from "react";
import { Alert, Button, Eyebrow, MonoValue } from "@/components/ui";
import { Policy } from "@/app/state";

export interface PolicyToggleProps {
  readonly policy: readonly Policy[];
  readonly onChange: (index: number, policy: Policy) => void;
}

/**
 * D6. One control per segment. `REVERT_BATCH` is the default everywhere and is never changed
 * silently; `SKIP_CALL` is opt-in and only lands after an inline confirmation (never
 * `window.confirm`) that names what will be skipped and what breaking the provenance invariant
 * costs. See docs/05, "The provenance invariant".
 */
export function PolicyToggle({ policy, onChange }: PolicyToggleProps) {
  const [pending, setPending] = useState<number | null>(null);

  if (policy.length === 0) {
    return (
      <Alert tone="info" title="No segments yet">
        Failure policy is set per segment once a batch exists. Every segment starts at REVERT_BATCH.
      </Alert>
    );
  }

  return (
    <div className="b-policy">
      {policy.map((value, index) => {
        const segment = index + 1;
        const reverting = value === Policy.RevertBatch;
        const confirming = pending === index;

        return (
          <div
            key={index}
            className={reverting ? "b-policy__row" : "b-policy__row b-policy__row--skip"}
          >
            <div className="b-policy__head">
              <span className="b-policy__seg">
                <Eyebrow tone="muted">Segment</Eyebrow>
                <MonoValue value={String(segment)} />
              </span>
              <span className="b-policy__buttons">
                <Button
                  size="sm"
                  variant={reverting ? "ink" : "ghost"}
                  aria-pressed={reverting}
                  onClick={() => {
                    setPending(null);
                    onChange(index, Policy.RevertBatch);
                  }}
                >
                  <span className="ui-mono">REVERT_BATCH</span>
                </Button>
                <Button
                  size="sm"
                  variant={reverting ? "ghost" : "danger"}
                  aria-pressed={!reverting}
                  onClick={() => setPending(confirming ? null : index)}
                >
                  <span className="ui-mono">SKIP_CALL</span>
                </Button>
              </span>
            </div>

            {confirming && (
              <Alert tone="block" title={`Skip segment ${segment}?`}>
                <p>
                  What gets skipped: if segment {segment} fails, its calls do not run. The failure is
                  swallowed, those calls are dropped, and the batch moves on to the next segment.
                  The failed call still burns its gas — skipping saves value, not gas.
                </p>
                <p>
                  This breaks the provenance invariant. Later steps may observe state that an earlier
                  step failed to write: every slot segment {segment} would have written is poisoned,
                  and a later segment that reads one reverts the whole batch. The failure stays
                  loud, but the batch is no longer atomic.
                </p>
                <p>
                  Use SKIP_CALL only for optional steps such as cleanup. Predicates and safety gates
                  must stay on REVERT_BATCH — a skippable safety assertion is a safety assertion that
                  can be skipped.
                </p>
                <span className="b-policy__confirm">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setPending(null);
                      onChange(index, Policy.SkipCall);
                    }}
                  >
                    Confirm SKIP_CALL
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                </span>
              </Alert>
            )}

            {!reverting && !confirming && (
              <p className="b-policy__state ui-mono">
                segment {segment} is opted out of atomicity. Moving it back to REVERT_BATCH is the
                safe direction and needs no confirmation.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
