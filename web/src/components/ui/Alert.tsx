import type { HTMLAttributes, ReactNode } from "react";

export type AlertTone = "pass" | "block" | "warn" | "info";

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly tone?: AlertTone;
  readonly title?: ReactNode;
  readonly children: ReactNode;
}

const TONE_CLASS: Record<AlertTone, string> = {
  pass: "ui-alert--pass",
  block: "ui-alert--block",
  warn: "ui-alert--warn",
  info: "ui-alert--info",
};

/**
 * A block-level message. `pass` and `block` are outcomes, so they must come from a simulation or a
 * receipt — never from a decoder description.
 */
export function Alert({ tone = "info", title, className, children, ...rest }: AlertProps) {
  const classes = ["ui-alert", TONE_CLASS[tone], className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes} role={tone === "block" ? "alert" : "status"} {...rest}>
      {title !== undefined && (
        <strong style={{ display: "block", textTransform: "uppercase" }}>{title}</strong>
      )}
      {children}
    </div>
  );
}
