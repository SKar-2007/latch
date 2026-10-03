import { InputParamType, type ParamView } from "@latch/client";
import { MonoValue } from "@/components/ui";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const PARAM_TYPE_LABEL: Record<InputParamType, string> = {
  [InputParamType.TARGET]: "target",
  [InputParamType.VALUE]: "value",
  [InputParamType.CALL_DATA]: "calldata",
};

const SOURCE_TAG: Record<ParamView["source"]["kind"], string> = {
  literal: "literal",
  runtime: "runtime",
  balance: "balance",
  opaque: "opaque",
};

export interface ParamLineProps {
  readonly param: ParamView;
  /** Supplied by the caller, never inferred. An unknown address renders as literal hex. */
  readonly names?: Readonly<Record<string, string>> | undefined;
}

/**
 * One input parameter, and — critically — where its value comes from.
 *
 * Three rules live here (docs/06, `<BatchPreview>`; brief D3):
 *
 *   - `literal` is known at signing, so the value is shown.
 *   - `runtime` and `balance` do not exist until execution. What is shown is the call or mechanism
 *     that will produce them, never a number — not even when a simulation has already produced one.
 *     A simulation's value belongs to the simulation banner, which is labelled as simulated.
 *   - `opaque` shows the reason it could not be described, rather than pretending to a value.
 */
export function ParamLine({ param, names }: ParamLineProps) {
  const { source } = param;
  const tag = SOURCE_TAG[source.kind];
  const isDeferred = source.kind === "runtime" || source.kind === "balance";

  return (
    <li className={`dec-param dec-param--${source.kind}`}>
      <span className="dec-param__type">{PARAM_TYPE_LABEL[param.paramType]}</span>
      <span className={`dec-param__tag dec-param__tag--${source.kind}`}>{tag}</span>
      <span className="dec-param__body">
        {source.kind === "literal" && <LiteralValue label={source.label} names={names} />}
        {source.kind === "opaque" && <span className="dec-param__mechanism">{source.label}</span>}
        {isDeferred && <span className="dec-param__mechanism">{source.label}</span>}
        {isDeferred && (
          <span className="dec-param__note">
            resolved on-chain at execution — no value exists before then
          </span>
        )}
        {source.kind === "opaque" && (
          <span className="dec-param__note">{`not decodable: ${source.reason}`}</span>
        )}
      </span>
    </li>
  );
}

/** A value known at signing. An address is the one place a supplied name may replace the hex. */
function LiteralValue({
  label,
  names,
}: {
  readonly label: string;
  readonly names?: Readonly<Record<string, string>> | undefined;
}) {
  if (!ADDRESS_RE.test(label)) {
    return <span className="dec-param__value">{label}</span>;
  }

  const name = names?.[label.toLowerCase()] ?? names?.[label];
  if (name === undefined) {
    return (
      <span className="dec-param__value">
        <MonoValue value={label} />
      </span>
    );
  }

  return (
    <span className="dec-param__named">
      <span className="dec-param__name">{name}</span>
      <MonoValue value={label} muted />
    </span>
  );
}
