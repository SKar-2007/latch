import type { HTMLAttributes, ReactNode } from "react";

export type ChipTone = "default" | "acid" | "sky" | "ink" | "sunken";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: ChipTone;
  readonly children: ReactNode;
}

const TONE_CLASS: Record<ChipTone, string> = {
  default: "",
  acid: "ui-chip--acid",
  sky: "ui-chip--sky",
  ink: "ui-chip--ink",
  sunken: "ui-chip--sunken",
};

/** Monospace pill for addresses, chain ids, enum members and short labels. */
export function Chip({ tone = "default", className, children, ...rest }: ChipProps) {
  const classes = ["ui-chip", TONE_CLASS[tone], className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
