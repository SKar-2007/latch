import type { GateView } from "@latch/client";
import { GateBadge, type GateTone } from "@/components/ui";

/**
 * The only tone map this component is allowed to use (docs/06, `<BatchPreview>` rule 3; brief D4).
 *
 * The batch has not executed, so nothing has passed and nothing has been blocked: the decoder
 * describes comparisons, and only a simulation or a receipt may produce an outcome. The record is
 * keyed by the verdict union, so `pass` or `blocked` here is a compile error, and `GATE_TONE` is
 * exported so a test can assert the same set at runtime.
 */
export const GATE_TONE: Record<GateView["verdict"]["kind"], GateTone> = {
  checked: "checked",
  "not-checked": "not-checked",
  "any-of": "any-of",
  undecodable: "undecodable",
};

export interface GateRowProps {
  readonly gate: GateView;
}

/**
 * One constraint over one word of one parameter.
 *
 * The verdict's `label` is passed through untouched: it carries the operator (`≥ 1000`, `≤ 1000`,
 * `= 1`, `within 0 … 9`), and collapsing two different comparisons into one tick is the failure this
 * screen exists to prevent (brief D2). A `SKIP` arrives as `not-checked` and is drawn by the
 * primitive as a dashed, grey NOT CHECKED badge — never as a pass (brief D1).
 */
export function GateRow({ gate }: GateRowProps) {
  const { verdict } = gate;
  const tone = GATE_TONE[verdict.kind];

  return (
    <li className={`dec-gate dec-gate--${verdict.kind}`}>
      <GateBadge tone={tone} label={verdict.label} />
      <span className="dec-gate__ref">{`param ${gate.paramIndex + 1} · word ${gate.wordIndex + 1}`}</span>

      {verdict.kind === "any-of" && (
        <div className="dec-gate__subs">
          <span className="dec-gate__label">alternatives</span>
          <ul className="dec-gate__subs-list">
            {verdict.subs.map((sub, i) => (
              <li key={`${i}-${sub}`}>{sub}</li>
            ))}
          </ul>
        </div>
      )}

      {verdict.kind === "undecodable" && <p className="dec-gate__reason">{verdict.reason}</p>}
    </li>
  );
}
