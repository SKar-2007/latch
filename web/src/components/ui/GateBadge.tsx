import type { HTMLAttributes } from "react";

/**
 * The verdict vocabulary.
 *
 * `checked`, `not-checked`, `any-of` and `undecodable` are *descriptions of a comparison* and are
 * the only tones the decoder is allowed to produce — the batch has not run yet, so nothing has
 * passed. `pass` and `blocked` are *outcomes* and may only be rendered from a simulation result or
 * a receipt. Keeping them in one type with that distinction documented is the whole point: the
 * most damaging thing this component could do is render `not-checked` as a green tick.
 */
export type GateTone =
  | "checked"
  | "not-checked"
  | "any-of"
  | "undecodable"
  | "pass"
  | "blocked"
  | "info";

const SYMBOL: Record<GateTone, string> = {
  checked: "≠",
  "not-checked": "—",
  "any-of": "|",
  undecodable: "!",
  pass: "✓",
  blocked: "✕",
  info: "·",
};

const NAME: Record<GateTone, string> = {
  checked: "GATE",
  "not-checked": "NOT CHECKED",
  "any-of": "ANY OF",
  undecodable: "UNDECODABLE",
  pass: "PASS",
  blocked: "BLOCKED",
  info: "INFO",
};

export interface GateBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  readonly tone: GateTone;
  /** The comparison itself, e.g. `≥ 25000000`. Never omit it to make the badge fit. */
  readonly label?: string;
  /** Override the default word. Used when the label alone already carries the meaning. */
  readonly name?: string;
}

export function GateBadge({ tone, label, name, className, ...rest }: GateBadgeProps) {
  const classes = ["ui-gate", `ui-gate--${tone}`, className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...rest}>
      <span className="ui-gate__symbol" aria-hidden="true">
        {SYMBOL[tone]}
      </span>
      <span>{name ?? NAME[tone]}</span>
      {label !== undefined && <span aria-label="comparison">{label}</span>}
    </span>
  );
}
