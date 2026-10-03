import { encodeFunctionData, type Hex } from "viem";
import { readClient } from "@/core/chain";
import { isConfigured } from "@/core/addresses";

/**
 * Beat 5's price driver: `MockOracle.setAnswer`, pushed from the panel.
 *
 * Two rules shape this file, and both come from the deployment state rather than from taste.
 *
 * 1. **`MockOracle` is not deployed.** `CHECKLIST.md` lists "MockOracle deployed with UI-driven
 *    setters" as not started and there is no oracle slot in `DEPLOYMENT`, so the address comes
 *    from `VITE_MOCK_ORACLE` and nothing else. An unset or malformed value is *not configured*
 *    — never a plausible address (rule D10). The panel renders that state and the button that
 *    would push stays disabled, so the demo cannot claim to have moved a price it never moved.
 *
 * 2. **A push that has not been mined has not happened.** The hash alone is not the price
 *    moving, so the caller only marks the beat done after a successful receipt. A timeout is
 *    reported as "go and look", never retried (rule D9: reads fall back, writes do not).
 *
 * Deploy command, kept next to the code that needs it:
 *
 *     forge create contracts/mocks/MockOracle.sol:MockOracle \
 *       --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast
 *
 * then set `VITE_MOCK_ORACLE=<printed address>` in `web/.env`.
 */

/** The two `MockOracle` entry points this panel touches. An ABI, never a guessed selector. */
const MOCK_ORACLE_ABI = [
  {
    type: "function",
    name: "setAnswer",
    stateMutability: "nonpayable",
    inputs: [{ name: "answer", type: "int256" }],
    outputs: [{ name: "roundId", type: "uint80" }],
  },
  {
    type: "function",
    name: "latestAnswer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "int256" }],
  },
] as const;

export interface OracleProbe {
  readonly configured: boolean;
  /** The configured address, or `null`. Never a substitute address. */
  readonly address: string | null;
  /** Why it is not configured. Empty when it is. */
  readonly reason: string;
}

/**
 * Read `VITE_MOCK_ORACLE` once per mount.
 *
 * Probed rather than imported from `core/addresses.ts` because there is deliberately no oracle
 * slot in `DEPLOYMENT`: adding one would imply a deployment that does not exist.
 */
export function probeMockOracle(): OracleProbe {
  const raw = import.meta.env["VITE_MOCK_ORACLE"];
  const value = typeof raw === "string" ? raw.trim() : "";

  if (value.length === 0) {
    return {
      configured: false,
      address: null,
      reason: "VITE_MOCK_ORACLE is unset, so this panel has no oracle address",
    };
  }
  if (!isConfigured(value)) {
    return {
      configured: false,
      address: null,
      reason: `VITE_MOCK_ORACLE is "${value}", which is not an address`,
    };
  }
  return { configured: true, address: value, reason: "" };
}

export type OraclePush =
  | { readonly ok: true; readonly hash: Hex }
  | { readonly ok: false; readonly message: string };

/**
 * Read the oracle's current answer, then push ten times it.
 *
 * The multiplier is not a price model — it is a value that is outside any band a demo would
 * sign, which is the whole point of the beat. The starting answer is read from the mock itself
 * so nothing is invented: a mock that has never had a round reports `0`, and `0` is refused
 * with an instruction rather than replaced with a number somebody made up.
 *
 * Exactly one transaction is sent. There is no retry path: a write that may have landed has to
 * be checked, not repeated (rule D9).
 */
export async function pushAnswerOutOfBand(options: {
  readonly oracle: string;
  readonly from: string;
}): Promise<OraclePush> {
  let current: bigint;
  try {
    current = await readClient.readContract({
      address: options.oracle as Hex,
      abi: MOCK_ORACLE_ABI,
      functionName: "latestAnswer",
    });
  } catch (cause) {
    return {
      ok: false,
      message:
        "Could not read the oracle's current answer, so nothing was pushed. " +
        `(${describe(cause)}) The price has not moved — do not narrate beat 5.`,
    };
  }

  if (current === 0n) {
    return {
      ok: false,
      message:
        "MockOracle has no round yet (latestAnswer is 0), so there is no price to move out of " +
        "band. Seed it from the deployer console first — this panel will not invent a starting price.",
    };
  }

  const pushed = current * 10n;
  const data = encodeFunctionData({
    abi: MOCK_ORACLE_ABI,
    functionName: "setAnswer",
    args: [pushed],
  });

  const provider = injectedProvider();
  if (provider === null) {
    return {
      ok: false,
      message: "No wallet is available to send the push. The price has not moved.",
    };
  }

  let hash: unknown;
  try {
    hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: options.from, to: options.oracle, data }],
    });
  } catch (cause) {
    return {
      ok: false,
      message:
        `The wallet refused the push, so the price has not moved. (${describe(cause)}) ` +
        "Check the wallet, then try again before moving on.",
    };
  }

  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return {
      ok: false,
      message:
        "The wallet did not return a transaction hash, so there is nothing to confirm against. " +
        "The price has not moved.",
    };
  }

  let receipt: { readonly status: string };
  try {
    receipt = await readClient.waitForTransactionReceipt({
      hash: hash as Hex,
      pollingInterval: 1_000,
      timeout: 30_000,
    });
  } catch (cause) {
    return {
      ok: false,
      message:
        `The push was sent (${hash}) but has not been mined in 30 seconds. (${describe(cause)}) ` +
        "Look it up in the explorer before claiming the price moved.",
    };
  }

  if (receipt.status !== "success") {
    return {
      ok: false,
      message: `The push transaction ${hash} was mined but reverted. The price has not moved.`,
    };
  }

  return { ok: true, hash: hash as Hex };
}

/** The smallest slice of EIP-1193 this panel needs. Looked up, never assumed. */
interface Eip1193Provider {
  request(args: { readonly method: string; readonly params?: readonly unknown[] }): Promise<unknown>;
}

function injectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
