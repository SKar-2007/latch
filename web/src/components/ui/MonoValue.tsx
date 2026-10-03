import type { HTMLAttributes } from "react";

export interface MonoValueProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  readonly value: string;
  /** Shorten to `0x1234…abcd`. Off by default: truncating an address by accident is a bug. */
  readonly truncate?: boolean;
  readonly muted?: boolean;
  readonly large?: boolean;
}

/** Format an address for display without ever hiding characters the reader did not ask to hide. */
export function formatShort(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * Every address, hash, selector, amount and enum member renders through this so the data face is
 * consistent. Tabular numerals keep columns of numbers aligned down a table.
 */
export function MonoValue({
  value,
  truncate = false,
  muted = false,
  large = false,
  className,
  ...rest
}: MonoValueProps) {
  const classes = [
    "ui-mono",
    truncate ? "ui-mono--truncate" : "",
    muted ? "ui-mono--muted" : "",
    large ? "ui-mono--lg" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const text = truncate ? formatShort(value) : value;
  return (
    <span className={classes} {...rest}>
      {text}
    </span>
  );
}
