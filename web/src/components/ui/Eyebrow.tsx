import type { HTMLAttributes, ReactNode } from "react";

export type EyebrowTone = "muted" | "sky" | "acid" | "latch" | "ink";

export interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: EyebrowTone;
  readonly children: ReactNode;
}

const TONE_CLASS: Record<EyebrowTone, string> = {
  muted: "",
  sky: "ui-eyebrow--sky",
  acid: "ui-eyebrow--acid",
  latch: "ui-eyebrow--latch",
  ink: "ui-eyebrow--ink",
};

/** The small uppercase label above every section heading. Fixed three-row header: eyebrow,
 *  headline, content. Carried over from the source deck's layout rule. */
export function Eyebrow({ tone = "muted", className, children, ...rest }: EyebrowProps) {
  const classes = ["ui-eyebrow", TONE_CLASS[tone], className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
