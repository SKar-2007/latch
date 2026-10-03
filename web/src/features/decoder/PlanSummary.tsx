import type { StepView } from "@latch/client";
import { Chip } from "@/components/ui";

export interface PlanSummaryProps {
  readonly steps: readonly StepView[];
}

/**
 * The row that answers "what am I about to sign?" in one line: how many entries, how many of them
 * assert without calling anything, how many dispatch, and how many gates stand over the batch.
 *
 * Counts come from the decoded steps rather than from the raw `calls`, so the summary and the rows
 * can never disagree.
 */
export function PlanSummary({ steps }: PlanSummaryProps) {
  const predicates = steps.filter((s) => s.isPredicate).length;
  const dispatched = steps.length - predicates;
  const gates = steps.reduce((total, s) => total + s.gates.length, 0);

  return (
    <div className="dec-summary">
      <Chip tone="sunken" className="dec-summary__count">
        {`${steps.length} entries`}
      </Chip>
      <Chip tone="ink">{`[assert] × ${predicates}`}</Chip>
      <Chip tone="acid">{`[call] × ${dispatched}`}</Chip>
      <Chip>{`${gates} gates`}</Chip>
    </div>
  );
}
