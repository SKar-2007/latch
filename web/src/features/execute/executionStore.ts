import { useSyncExternalStore } from "react";
import type { Hex } from "viem";

/**
 * The execution record the tracker shows but the state machine does not hold.
 *
 * `src/app/state` is frozen and carries only the phase, the batch, the simulation, the hash and the
 * receipt status. Three facts the tracker must report are not in it: whether the EIP-712 intent was
 * requested, signed or refused; the `validUntil` that signature carried; and the gas the receipt
 * actually observed. They are kept here rather than smuggled into `AppState` because the reducer is
 * the shared contract — a feature that needs a new move asks for it instead of inventing one.
 *
 * This store holds execution bookkeeping only. Phase, batch and simulation are never duplicated
 * here: those live in `AppState` and nowhere else.
 */

export type IntentStatus = "not-requested" | "awaiting" | "signed" | "rejected";

export interface ExecutionRecord {
  /** Did the wallet get asked for the intent signature, and what did it do? */
  readonly intentStatus: IntentStatus;
  /** Unix seconds from the signed payload, or null when no intent was built. */
  readonly validUntil: number | null;
  /** `keccak256(abi.encode(calls))` of the batch this record describes. */
  readonly batchHash: Hex | null;
  readonly signature: Hex | null;
  /** From the receipt. Null means no receipt has been seen — never an estimate. */
  readonly gasUsed: bigint | null;
}

const INITIAL_RECORD: ExecutionRecord = {
  intentStatus: "not-requested",
  validUntil: null,
  batchHash: null,
  signature: null,
  gasUsed: null,
};

let record: ExecutionRecord = INITIAL_RECORD;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function getExecutionRecord(): ExecutionRecord {
  return record;
}

export function setExecutionRecord(patch: Partial<ExecutionRecord>): void {
  const next = { ...record, ...patch };
  if (
    next.intentStatus === record.intentStatus &&
    next.validUntil === record.validUntil &&
    next.batchHash === record.batchHash &&
    next.signature === record.signature &&
    next.gasUsed === record.gasUsed
  ) {
    return;
  }
  record = next;
  notify();
}

/** Back to `not-requested`. A new batch must never be described by an old signature's record. */
export function resetExecutionRecord(): void {
  if (record === INITIAL_RECORD) return;
  record = INITIAL_RECORD;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useExecutionRecord(): ExecutionRecord {
  return useSyncExternalStore(subscribe, getExecutionRecord, getExecutionRecord);
}
