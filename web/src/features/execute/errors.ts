/**
 * Wallet and RPC errors, mapped to sentences (rule D7, mirrored from `features/wallet`).
 *
 * A wallet's numeric code is a protocol detail, not a message. `4001` means nothing to the person
 * who just clicked "reject", and an unknown code shown on its own is worse than silence, because it
 * looks like an answer. Every code therefore maps to a sentence the reader can act on, and the raw
 * code travels underneath as detail — never as the whole message.
 */

/** An error this feature raised itself, already carrying the sentence the user should read. */
export class ExecutionError extends Error {
  readonly code: string;
  /** True when the wallet's own refusal (EIP-1193 4001) caused it: nothing was attempted. */
  readonly rejection: boolean;

  constructor(code: string, message: string, rejection = false) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
    this.rejection = rejection;
  }
}

export interface MappedError {
  /** Detail, and the `AppError.code` it is shown under. Never the whole message. */
  readonly code: string;
  readonly message: string;
  /** True when the user declined in the wallet, so the correct response is to go back, not to retry. */
  readonly rejection: boolean;
}

const CODE_SENTENCES: Readonly<Record<number, { readonly message: string; readonly rejection: boolean }>> = {
  // docs/06 + the demo beat: a rejection is a decision, so the sentence says what did *not* happen.
  4001: { message: "Signature request rejected — the batch was not submitted.", rejection: true },
  // The wallet does not know Base Sepolia. Adding the network is the whole fix.
  4902: { message: "This network is not in your wallet. Add Base Sepolia and retry.", rejection: false },
  // EIP-1474 server range; geth-style nodes raise it for "insufficient funds for gas * price + value".
  "-32000": { message: "The wallet could not fund this transaction — check gas balance.", rejection: false },
  // A prompt from an earlier click is still open. Answering it *is* the fix.
  "-32002": {
    message: "The wallet already has a request waiting — answer it there, then try again.",
    rejection: false,
  },
};

function toCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return null;
}

/**
 * Walk the `cause` chain for the wallet's own code.
 *
 * viem wraps a provider error before it reaches us, and its generic wrapper reports `-1` — a
 * placeholder, not a code — while the real one sits on the cause. The first code found that is not
 * that placeholder is the answer; `-1` is skipped so an unknown wallet error is still reported with
 * the number the wallet actually returned.
 */
export function extractErrorCode(cause: unknown): number | null {
  let cursor: unknown = cause;
  for (let depth = 0; depth < 8 && cursor !== null && typeof cursor === "object"; depth += 1) {
    const record = cursor as { code?: unknown; cause?: unknown };
    const code = toCode(record.code);
    if (code !== null && code !== -1) return code;
    cursor = record.cause;
  }
  return null;
}

/** The most specific text the error chain carries, searched the way viem orders its own fields. */
function extractDetail(cause: unknown): string | null {
  let cursor: unknown = cause;
  for (let depth = 0; depth < 8 && cursor !== null && typeof cursor === "object"; depth += 1) {
    const record = cursor as { shortMessage?: unknown; details?: unknown; message?: unknown; cause?: unknown };
    for (const key of ["shortMessage", "details", "message"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
    cursor = record.cause;
  }
  return null;
}

/**
 * Turn whatever the wallet, the provider or this feature threw into a sentence plus a code.
 *
 * Unknown codes keep the number as detail inside a sentence — the raw code alone is never the
 * message (rule D7).
 */
export function mapWalletError(cause: unknown): MappedError {
  if (cause instanceof ExecutionError) {
    return { code: cause.code, message: cause.message, rejection: cause.rejection };
  }

  const code = extractErrorCode(cause);
  if (code !== null) {
    const known = CODE_SENTENCES[code];
    if (known !== undefined) {
      return { code: String(code), message: known.message, rejection: known.rejection };
    }
  }

  const detail = extractDetail(cause);
  const where = code === null ? "" : ` — the wallet returned code ${code}`;
  return {
    code: code === null ? "UNKNOWN" : String(code),
    message:
      `The wallet could not complete this request${where}. ` +
      `Nothing was submitted. ${detail ?? "It reported no detail."}`,
    rejection: false,
  };
}
