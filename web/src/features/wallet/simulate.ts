import { encodeBatch, type ComposableExecution } from "@latch/client";
import type { Address, Hex } from "viem";
import { toFunctionSelector } from "viem";
import type { SimulationResult } from "@/app/state";
import { ENTRYPOINT_V07, CHAIN_NAME } from "@/core/addresses";
import { readClient } from "@/core/chain";
import { mapRevertReason } from "./revertReasons";

/**
 * The `eth_call` the runbook calls for: "step 5 — `eth_call` `executeComposable` → success plus a
 * gas estimate" (docs/10, Layer D smoke test), and the verification row "Batch executes —
 * `eth_call` on `executeComposable` — no revert" (docs/03).
 *
 * `executeComposable(ComposableExecution[])` is not the canonical signature a selector is computed
 * from: Solidity expands the struct, so the selector is the hash of the tuple form below. That
 * expansion is `0x7eba07b8`, the selector docs/03 records as present on both the composability
 * module and the Nexus 1.3.1 account, so the two agree.
 */
export const EXECUTE_COMPOSABLE_SIGNATURE =
  "executeComposable((bytes4,(uint8,uint8,bytes,(uint8,bytes)[])[],(uint8,bytes)[])[])";
export const EXECUTE_COMPOSABLE_SELECTOR = toFunctionSelector(EXECUTE_COMPOSABLE_SIGNATURE);

/**
 * Who sends the call.
 *
 * `executeComposable` guards its caller with "EntryPoint, registered EntryPoint, or the account"
 * (docs/03, access control). The account-as-caller form is rejected by the deployed Nexus 1.3.1
 * build — measured: it reverts `AccountAccessUnauthorized()` — so the simulation sends the call
 * from the EntryPoint that will send it in production. Pinned address, never discovered.
 */
const SENDER = ENTRYPOINT_V07;

function unavailable(reason: string): SimulationResult {
  return {
    ok: false,
    message: `Simulation is unavailable in this configuration: ${reason}`,
    at: Date.now(),
  };
}

function failed(revertReason: string, message: string): SimulationResult {
  return { ok: false, message, revertReason, at: Date.now() };
}

/**
 * Pull revert data out of whatever the transport threw.
 *
 * viem wraps an `eth_call` revert in `CallExecutionError`; the hex payload sits on the JSON-RPC
 * error at the bottom of the `cause` chain, and a node that only answers with a reason string puts
 * it in the message instead. Both are searched, data first, because the bytes are authoritative.
 */
function extractRevert(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let cursor: unknown = err;
  let text: string | undefined;

  for (let depth = 0; depth < 12 && cursor !== null && typeof cursor === "object"; depth += 1) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const record = cursor as Record<string, unknown>;

    const data = record["data"];
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) return data;
    if (data !== null && typeof data === "object") {
      const inner = (data as Record<string, unknown>)["data"];
      if (typeof inner === "string" && inner.startsWith("0x") && inner.length >= 10) return inner;
    }
    const raw = record["raw"];
    if (typeof raw === "string" && raw.startsWith("0x") && raw.length >= 10) return raw;

    for (const key of ["message", "details", "shortMessage"]) {
      const value = record[key];
      if (text === undefined && typeof value === "string" && value.includes("execution reverted")) {
        text = value;
      }
    }
    cursor = record["cause"];
  }

  if (text !== undefined) {
    const match = /execution reverted:?\s*([\s\S]*)$/i.exec(text.trim());
    const reason = (match?.[1] ?? "").trim();
    return reason === "" ? "0x" : reason;
  }
  return undefined;
}

/**
 * Simulate the batch before anyone signs it.
 *
 * Three outcomes, and the difference between them is the whole point of the panel:
 *
 * - `ok: true` — the chain produced an outcome and it did not revert. Green is legal here (D4).
 * - `ok: false` with a mapped sentence — the chain produced a revert. D7 maps it to words.
 * - `ok: false` "unavailable" — nothing could be simulated, which is *not* a pass. The one case
 *   that must never look like success is an `eth_call` against an address with no code: it
 *   returns empty success without running anything. That case is checked before the call, not
 *   after.
 */
export async function simulate(
  calls: readonly ComposableExecution[],
  account: Address | null,
): Promise<SimulationResult> {
  if (account === null) {
    return unavailable("no account is connected.");
  }
  if (calls.length === 0) {
    return unavailable("the batch is empty, so there is nothing to run.");
  }

  let calldata: Hex;
  try {
    calldata = `${EXECUTE_COMPOSABLE_SELECTOR}${encodeBatch(calls).slice(2)}` as Hex;
  } catch (cause) {
    return unavailable(`the batch does not encode. ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  let code: Hex | undefined;
  try {
    code = await readClient.getBytecode({ address: account });
  } catch {
    return unavailable(`the RPC endpoint would not answer for ${account}.`);
  }
  if (code === undefined || code === "0x") {
    return unavailable(
      `${account} holds no code, so an \`eth_call\` would report success without executing anything. ` +
        "Connect a delegated or smart account before simulating.",
    );
  }

  try {
    await readClient.call({ account: SENDER, to: account, data: calldata });
  } catch (cause) {
    const raw = extractRevert(cause);
    if (raw === undefined) {
      return failed(
        "no revert data",
        "The simulation did not run: the RPC endpoint did not answer, so nothing was simulated.",
      );
    }
    const mapped = mapRevertReason(raw);
    return failed(mapped.revertReason, mapped.message);
  }

  // Gas is shown only when it was actually observed. The estimate is taken from the same node,
  // against the same call, after the call has already proven it succeeds; if the node declines to
  // estimate, no number is shown rather than an invented one.
  let gasUsed: bigint | undefined;
  try {
    gasUsed = await readClient.estimateGas({ account: SENDER, to: account, data: calldata });
  } catch {
    gasUsed = undefined;
  }

  const message = `Simulation succeeded: the batch executed against ${CHAIN_NAME} without reverting.`;
  const result: SimulationResult = { ok: true, message, at: Date.now() };
  return gasUsed === undefined ? result : { ...result, gasUsed };
}
