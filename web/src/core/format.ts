import { formatUnits, parseUnits } from "viem";

/**
 * Display formatting. Nothing here rounds silently: a value that cannot be shown exactly is shown
 * with its full precision and an explanation, because a preview that rounds differently from the
 * chain is a preview that lied.
 */

/** Group an integer with thin separators so a 6-decimal amount is scannable. */
export function groupDigits(value: string): string {
  const [whole = "0", fraction] = value.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${fraction}`;
}

/** Format raw units for display, trimming trailing zeros but never the significant digits. */export function formatAmount(raw: bigint, decimals: number, maxFraction = 6): string {
  const full = formatUnits(raw, decimals);
  const [whole = "0", fraction = ""] = full.split(".");
  const trimmed = fraction.replace(/0+$/, "").slice(0, maxFraction);
  return trimmed.length > 0 ? `${groupDigits(whole)}.${trimmed}` : groupDigits(whole);
}

/** `0x1234…abcd` for a hash. Head and tail are explicit so the caller decides what is safe. */
export function shortHex(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Seconds until an expiry, in the compact form a countdown needs. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "expired";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Basis points as a percentage string. 50 -> "0.50%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Parse a human-entered amount into base units.
 *
 * Returns null rather than throwing or silently coercing: a malformed bound must stop the build,
 * because `parseUnits("0.0.1")` succeeding is how a floor ends up set to something nobody chose.
 */
export function parseAmount(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return null;
  }
}

/** Basis points as a ratio string for a bound, e.g. 1200s freshness plus a 1% band. */
export function formatSeconds(seconds: number): string {
  if (seconds % 3600 === 0 && seconds >= 3600) return `${seconds / 3600}h`;
  if (seconds % 60 === 0 && seconds >= 60) return `${seconds / 60}m`;
  return `${seconds}s`;
}
