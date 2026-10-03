import type { StepView } from "@latch/client";
import { Chip, MonoValue } from "@/components/ui";
import { Policy } from "@/app/state";
import { GateRow } from "./GateRow";
import { ParamLine } from "./ParamLine";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface StepRowProps {
  readonly step: StepView;
  /** Address-to-display-name table. Supplied, never inferred: unknown addresses stay hex. */
  readonly names?: Readonly<Record<string, string>> | undefined;
  /** This entry's failure policy. Absent means the caller did not declare one. */
  readonly policy?: Policy | undefined;
}

/**
 * One numbered step of the plan: kind, target, signature, parameters, gates, captures.
 *
 * A step is either an assertion (`[assert]` — a predicate that calls nothing) or a dispatch
 * (`[call]`). The distinction is drawn before anything else on the row, because "this step changes
 * state" and "this step only checks" are different claims and a reviewer must not have to infer
 * them from a function name.
 */
export function StepRow({ step, names, policy }: StepRowProps) {
  const number = step.index + 1;

  return (
    <li className="dec-step" data-step={number}>
      <div className="dec-step__rail">
        <span className="dec-step__num">{number}</span>
      </div>

      <div className="dec-step__body">
        <div className="dec-step__head">
          <Chip
            tone={step.isPredicate ? "sunken" : "ink"}
            className={step.isPredicate ? "dec-kind dec-kind--assert" : "dec-kind dec-kind--call"}
          >
            {step.isPredicate ? "[assert]" : "[call]"}
          </Chip>

          <Target step={step} />
          <FunctionSignature step={step} names={names} />
          {policy !== undefined && <PolicyChip policy={policy} />}
        </div>

        {step.params.length > 0 && (
          <div className="dec-block">
            <span className="dec-block__label">params</span>
            <ul className="dec-params">
              {step.params.map((param) => (
                <ParamLine key={param.index} param={param} names={names} />
              ))}
            </ul>
          </div>
        )}

        {step.gates.length > 0 && (
          <div className="dec-block">
            <span className="dec-block__label">gates</span>
            <ul className="dec-gates">
              {step.gates.map((gate, i) => (
                <GateRow key={`${gate.paramIndex}-${gate.wordIndex}-${i}`} gate={gate} />
              ))}
            </ul>
          </div>
        )}

        {step.captures.length > 0 && (
          <div className="dec-block">
            <span className="dec-block__label">captures</span>
            <ul className="dec-captures">
              {step.captures.map((capture, i) => (
                <li key={`${i}-${capture}`} className="dec-capture">
                  <span className="dec-capture__tag">writes</span>
                  <span className="ui-mono">{capture}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The destination. `decodeBatch` applies the caller's `names` table itself, so `step.target` is
 * either a supplied name or the literal address — this renders whichever it is and never invents
 * one.
 */
function Target({ step }: { readonly step: StepView }) {
  if (step.target === undefined) {
    return (
      <span className="dec-step__target dec-step__target--none">no target — nothing is called</span>
    );
  }

  if (ADDRESS_RE.test(step.target)) {
    return (
      <span className="dec-step__target">
        <MonoValue value={step.target} />
      </span>
    );
  }

  return <span className="dec-step__target">{step.target}</span>;
}

/**
 * What will be dispatched.
 *
 * The wire format carries a four-byte selector, and there is no signature preimage table in this
 * product: rendering `approve(address,uint256)` from a selector would be a guess dressed as a
 * decode, which is exactly the failure this screen exists to prevent. So the selector is shown as
 * it was signed — unless the caller supplied the signature under its selector key in `names`, in
 * which case the supplied text is used. A predicate calls nothing, and says so.
 */
function FunctionSignature({
  step,
  names,
}: {
  readonly step: StepView;
  readonly names?: Readonly<Record<string, string>> | undefined;
}) {
  const supplied = names?.[step.functionSig.toLowerCase()] ?? names?.[step.functionSig];

  if (supplied !== undefined) {
    return <span className="dec-step__fn ui-mono">{supplied}</span>;
  }

  if (step.isPredicate) {
    return <span className="dec-step__fn dec-step__fn--muted">predicate · nothing is called</span>;
  }

  return (
    <span className="dec-step__fn">
      <span className="dec-step__fn-tag">selector</span>
      <MonoValue value={step.functionSig} />
    </span>
  );
}

/**
 * Per-entry failure policy (brief D6, docs/05).
 *
 * `REVERT_BATCH` is the default and reads as neutral. `SKIP_CALL` opts the step out of atomicity —
 * the batch can succeed with this step never run — so it is drawn as a warning and says what the
 * choice means, in place, rather than as a second chip that looks like the first.
 */
function PolicyChip({ policy }: { readonly policy: Policy }) {
  if (policy === Policy.SkipCall) {
    return (
      <span className="dec-policy-wrap">
        <Chip className="dec-policy dec-policy--skip">SKIP_CALL</Chip>
        <span className="dec-policy__note">
          this step may be skipped — it opts out of atomicity
        </span>
      </span>
    );
  }

  return <Chip className="dec-policy dec-policy--revert">REVERT_BATCH</Chip>;
}
