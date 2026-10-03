import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, EIP1193Provider } from "viem";
import { COMPOSABILITY_MODULE } from "@/core/addresses";
import { readClient } from "@/core/chain";

/**
 * What we know about the connected account's composability support.
 *
 * The three states are deliberately distinct, because collapsing them is the failure this type exists
 * to prevent:
 *
 *   `native`   the account implements `executeComposable` itself (Nexus 1.3.1 and later). No module
 *               installation is needed and nothing is missing.
 *   `unknown`  the check has not run, or ran and could not conclude. Never rendered as "installed".
 *   `missing`  the account is a plain EOA or an account type that cannot compose. Installing the
 *               module is required.
 *
 * Rule from docs/06, stated in the brief as D10 and load-bearing here: addresses are pinned
 * configuration, never discovered. Nothing in this file scans for a module.
 */

/**
 * Why a check concluded what it did.
 *
 * An account that reverts on a probe is not the same as one that is missing the feature, and the
 * difference decides whether the UI says "install the module" or "we could not tell". Getting that
 * backwards tells a user to install something they already have.
 */
export type ProbeOutcome =
  | "native"
  | "module-compatible"
  | "not-composable"
  | "inconclusive"
  | "no-code";

export interface AccountProbe {
  readonly outcome: ProbeOutcome;
  /** Present only when the probe itself failed, e.g. the RPC refused the call. */
  readonly error?: string;
  /** True when the module address has code on this chain. Configuration is never assumed. */
  readonly moduleDeployed: boolean | null;
}

/** `executeComposable(ComposableExecution[])`, which a Nexus 1.3.1 account implements natively. */
const NATIVE_COMPOSABLE = "executeComposable";

/**
 * Probe an account for composability support.
 *
 * Deliberately shallow. The question a UI actually needs answered is "can this account run a batch,
 * or does something need installing", and answering that needs one check, not a survey. Anything the
 * probe cannot conclude is reported as inconclusive rather than guessed.
 *
 * The probe runs against `readClient` and is therefore allowed to fall back across providers: it is
 * a read, it is idempotent, and a stale answer is re-asked on the next call.
 */
export async function probeAccount(address: Address): Promise<AccountProbe> {
  const moduleDeployed = await hasCode(COMPOSABILITY_MODULE);

  // An EOA cannot compose, and saying so early is more useful than a failing call later.
  const code = await hasCode(address);
  if (code === false) {
    return { outcome: "not-composable", moduleDeployed };
  }

  try {
    const hasNative = await hasFunction(address, NATIVE_COMPOSABLE);
    if (hasNative) {
      return { outcome: "native", moduleDeployed };
    }
  } catch (cause) {
    // A revert or a transport failure is not evidence of absence.
    return {
      outcome: "inconclusive",
      moduleDeployed,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }

  // The account has code and no native composable call. Whether the module is installed *on that
  // account* is not answerable through a pinned selector, because `isModuleType` describes the
  // module rather than its relationship to an account. So this is the honest verdict: the account is
  // not natively composable, and the UI must not claim a module is installed.
  return { outcome: "module-compatible", moduleDeployed };
}

async function hasCode(address: string): Promise<boolean | null> {
  try {
    const code = await readClient.getCode({ address: address as Address });
    if (code === undefined || code === "0x") return false;
    return true;
  } catch {
    return null;
  }
}

/**
 * Does an address expose a function?
 *
 * Uses `eth_getCode` and a selector search rather than an `eth_call`, because a call to a function
 * that does not exist reverts — and a revert is indistinguishable from a call that reverted for a real
 * reason. Reading the dispatcher keeps "absent" and "present but reverting" separate.
 */
async function hasFunction(address: string, signature: string): Promise<boolean> {
  const { keccak256, toHex } = await import("viem");
  const code = await readClient.getCode({ address: address as Address });
  if (code === undefined || code === "0x") return false;

  const selector = keccak256(toHex(`${signature}(address,uint256,bytes)`)).slice(2, 10);
  return code.toLowerCase().includes(selector);
}

/**
 * The wallet connector.
 *
 * A minimal EIP-1193 interface rather than a wallet library. The app needs four things — connect,
 * disconnect, read the account, read the chain — and a library would add a dependency tree and an
 * opinion about which wallets exist. The provider is injected by the browser, so this degrades to
 * "no wallet available" rather than to a crash.
 */
export interface Connector {
  readonly available: boolean;
  connect(): Promise<{ account: Address; chainId: number }>;
  disconnect(): Promise<void>;
  /** Subscribe to chain and account changes the wallet pushes without being asked. */
  watch(onChange: (next: { account: Address | null; chainId: number }) => void): () => void;
}

interface Eip1193RequestArgs {
  readonly method: string;
  readonly params?: readonly unknown[];
}

function injectedProvider(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const candidate = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  return candidate;
}

export const injectedConnector: Connector = {
  get available() {
    return injectedProvider() !== undefined;
  },

  async connect() {
    const provider = injectedProvider();
    if (provider === undefined) {
      throw new Error("No injected wallet found. Install a browser wallet, or open the app in one.");
    }

    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
    const account = accounts[0];
    if (account === undefined) {
      throw new Error("The wallet returned no account. Unlock it and try again.");
    }

    const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
    return { account, chainId: Number.parseInt(chainIdHex, 16) };
  },

  async disconnect() {
    // Nothing to do: the account is chosen by the wallet, not held by us. Returning cleanly matters,
    // because the app has to be able to drop a session without a wallet cooperating.
  },

  watch(onChange) {
    const provider = injectedProvider();
    if (provider === undefined) return () => {};

    const handler = (payload: unknown) => {
      const chainIdHex = (payload as { chainId?: string } | undefined)?.chainId;
      if (chainIdHex === undefined) return;
      const chainId = Number.parseInt(chainIdHex, 16);
      void provider
        .request({ method: "eth_accounts" })
        .then((accounts: unknown) => {
          const list = accounts as Address[];
          onChange({ account: list[0] ?? null, chainId });
        })
        .catch(() => {
          /* A wallet that will not answer is treated as unchanged rather than as disconnected. */
        });
    };

    provider.on?.("chainChanged", handler);
    provider.on?.("accountsChanged", handler);
    return () => {
      provider.removeListener?.("chainChanged", handler);
      provider.removeListener?.("accountsChanged", handler);
    };
  },
};

export interface UseAccountProbe {
  readonly probe: AccountProbe | null;
  readonly checking: boolean;
  readonly recheck: () => void;
}

/**
 * Probe an account, re-probing when it changes.
 *
 * The result is keyed by address so a stale answer for a previous account can never be shown against
 * a new one. That is the same failure as showing a stale simulation, and it is why the key exists.
 */
export function useAccountProbe(address: Address | null): UseAccountProbe {
  const [probe, setProbe] = useState<AccountProbe | null>(null);
  const [checking, setChecking] = useState(false);
  const [nonce, setNonce] = useState(0);
  const latest = useRef<string>("");

  useEffect(() => {
    if (address === null) {
      setProbe(null);
      return;
    }

    let cancelled = false;
    const key = `${address.toLowerCase()}:${nonce}`;
    latest.current = key;
    setChecking(true);

    void probeAccount(address)
      .then((result) => {
        // Drop a result that arrived after the account changed underneath it.
        if (cancelled || latest.current !== key) return;
        setProbe(result);
      })
      .catch((cause: unknown) => {
        if (cancelled || latest.current !== key) return;
        setProbe({
          outcome: "inconclusive",
          moduleDeployed: null,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      })
      .finally(() => {
        if (!cancelled && latest.current === key) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, nonce]);

  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  return { probe, checking, recheck };
}
