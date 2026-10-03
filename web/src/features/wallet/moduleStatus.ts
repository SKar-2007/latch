import type { Address, Hex } from "viem";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { COMPOSABILITY_MODULE } from "@/core/addresses";
import { readClient } from "@/core/chain";

/**
 * The module pre-flight: is this account able to execute a composable batch?
 *
 * Returns `true`, `false`, or `null` for "the check has not produced an answer". `null` is rendered
 * as **unknown** and is never collapsed to either side of the question — reporting a module as
 * installed before the chain has said so is the one thing the state machine forbids
 * (`AppState.moduleInstalled`), and reporting it as missing on a transport error would block a
 * perfectly good account.
 *
 * Two probes, both taken from the docs:
 *
 * 1. `isInitialized(MODULE, account)` — docs/03 verification checklist ("Module installed →
 *    `isInitialized(MODULE, account)` → `true`") and docs/10 §6 verify. The calldata is built from
 *    the signature with viem rather than copied: the selector printed in docs/10 (`0x2d1d7e47`)
 *    reverts against the deployed module, while `isInitialized(address)` (`0xd60b347f`) answers
 *    `false` for an uninstalled account and is the signature the module source declares.
 * 2. A bytecode survey of the account itself — docs/10 §6 "confirm first which shape you are on",
 *    which reads the account's code for a known selector. Nexus 1.3.1 composes natively, has no
 *    module to install, and does expose `executeComposable`; docs/03 records the same fork in the
 *    row "isInitialized(MODULE, account) **or account state**".
 *
 * Everything runs against `readClient`, which is pinned to Base Sepolia: the module status is a
 * property of this deployment, not of whatever chain the wallet happens to be sitting on.
 */
const IS_INITIALIZED_ABI = parseAbi(["function isInitialized(address account) view returns (bool)"]);

/** `PUSH4 executeComposable` / `PUSH32 executeComposable`, the shapes solc emits for a selector. */
const EXECUTE_COMPOSABLE_PUSH4 = "637eba07b8";
const EXECUTE_COMPOSABLE_PUSH32 = "7c7eba07b8";

export async function moduleStatus(account: Address): Promise<boolean | null> {
  let code: Hex | undefined;
  try {
    code = await readClient.getBytecode({ address: account });
  } catch {
    return null;
  }

  if (code === undefined || code === "0x") {
    // No code at the address: nothing is installed and nothing could execute. This is an answer,
    // not a transport failure, so it is reported rather than left unknown.
    return false;
  }

  const lower = code.toLowerCase();
  if (lower.includes(EXECUTE_COMPOSABLE_PUSH4) || lower.includes(EXECUTE_COMPOSABLE_PUSH32)) {
    return true;
  }

  try {
    const response = await readClient.call({
      to: COMPOSABILITY_MODULE,
      data: encodeFunctionData({
        abi: IS_INITIALIZED_ABI,
        functionName: "isInitialized",
        args: [account],
      }),
    });
    if (response.data === undefined) return null;
    return decodeFunctionResult({
      abi: IS_INITIALIZED_ABI,
      functionName: "isInitialized",
      data: response.data,
    });
  } catch {
    return null;
  }
}
