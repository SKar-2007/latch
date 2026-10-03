import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { getAddress } from "viem";
import { useApp, useDispatch } from "@/app/AppProvider";
import { CHAIN_NAME } from "@/core/addresses";
import { EXPECTED_CHAIN_ID } from "@/core/chain";
import { moduleStatus } from "./moduleStatus";

/**
 * The smallest slice of EIP-1193 this app uses, declared here because nothing outside this folder
 * may add a global. `window.ethereum` is looked up, never assumed: an environment without a wallet
 * has to render "no wallet detected" rather than throw on a missing object.
 */
export interface Eip1193Provider {
  request(args: { readonly method: string; readonly params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (payload: unknown) => void): void;
  removeListener?(event: string, listener: (payload: unknown) => void): void;
}

export interface WalletController {
  /** False when nothing injected `window.ethereum`. No connect button is rendered in that case. */
  readonly hasWallet: boolean;
  readonly connecting: boolean;
  /** Wallet-facing errors only. Kept out of `AppState.error`, which is for app-level failures. */
  readonly error: string | null;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
  readonly switchChain: () => Promise<void>;
  readonly dismissError: () => void;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return injected ?? null;
}

function firstAccount(payload: unknown): Address | null {
  if (!Array.isArray(payload)) return null;
  const candidate = payload[0];
  if (typeof candidate !== "string" || !ADDRESS_RE.test(candidate)) return null;
  return getAddress(candidate);
}

/** Never guesses: an unreadable chain id is `null` so the caller can refuse to claim a chain. */
function parseChainId(payload: unknown): number | null {
  const raw =
    typeof payload === "number"
      ? payload
      : typeof payload === "string"
        ? Number.parseInt(payload, payload.trim().startsWith("0x") ? 16 : 10)
        : Number.NaN;
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

function errorCode(cause: unknown): number | null {
  let cursor: unknown = cause;
  for (let depth = 0; depth < 4 && cursor !== null && typeof cursor === "object"; depth += 1) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === "number") return code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return null;
}

function errorMessage(cause: unknown): string | null {
  let cursor: unknown = cause;
  for (let depth = 0; depth < 4 && cursor !== null && typeof cursor === "object"; depth += 1) {
    const record = cursor as { shortMessage?: unknown; message?: unknown };
    if (typeof record.shortMessage === "string" && record.shortMessage.length > 0) {
      return record.shortMessage;
    }
    if (typeof record.message === "string" && record.message.length > 0) return record.message;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return null;
}

function describeWalletError(cause: unknown): string {
  const code = errorCode(cause);
  if (code === 4001) return "The wallet rejected the request.";
  if (code === -32002) {
    return "The wallet already has a request waiting — answer it there, then try again.";
  }
  if (code === 4902) {
    return `Your wallet does not have ${CHAIN_NAME} (${EXPECTED_CHAIN_ID}) added. Add the network and try again.`;
  }
  return errorMessage(cause) ?? "The wallet returned an error.";
}

/**
 * Connection, listeners and the module pre-flight — everything with a side effect. `ConnectWallet`
 * only renders what this returns.
 *
 * The listeners are registered once per provider/chain and removed on unmount. An empty
 * `accountsChanged` is a disconnect (the wallet revoked access), not an error, and a chain change
 * invalidates the simulation along with it — the reducer clears `simulation` on `chainChanged`,
 * because a simulation belongs to the exact bytes and chain it was run against.
 */
export function useWallet(): WalletController {
  const { account, chainId } = useApp();
  const dispatch = useDispatch();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkedRef = useRef<string | null>(null);

  const hasWallet = getInjectedProvider() !== null;

  const connect = useCallback(async (): Promise<void> => {
    const provider = getInjectedProvider();
    if (provider === null) {
      setError("No wallet detected. Install a wallet to continue.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const next = firstAccount(accounts);
      if (next === null) {
        setError("The wallet returned no account to connect with.");
        return;
      }
      const reportedChain = parseChainId(await provider.request({ method: "eth_chainId" }));
      if (reportedChain === null) {
        setError("The wallet did not report a chain id, so no session was opened.");
        return;
      }
      dispatch({ type: "wallet/connected", account: next, chainId: reportedChain });
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setConnecting(false);
    }
  }, [dispatch]);

  const switchChain = useCallback(async (): Promise<void> => {
    const provider = getInjectedProvider();
    if (provider === null) {
      setError("No wallet detected. Install a wallet to continue.");
      return;
    }
    setError(null);
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${EXPECTED_CHAIN_ID.toString(16)}` }],
      });
    } catch (cause) {
      setError(describeWalletError(cause));
    }
  }, []);

  const disconnect = useCallback((): void => {
    setError(null);
    // Clears the session only. Revoking the wallet's access to this origin is the wallet's job;
    // pretending otherwise here would leave the user believing a permission they still hold is gone.
    dispatch({ type: "wallet/disconnected" });
  }, [dispatch]);

  const dismissError = useCallback((): void => setError(null), []);

  useEffect(() => {
    const provider = getInjectedProvider();
    if (provider === null || provider.on === undefined) return undefined;

    const onAccounts = (payload: unknown): void => {
      const next = firstAccount(payload);
      if (next === null) {
        dispatch({ type: "wallet/disconnected" });
        return;
      }
      dispatch({ type: "wallet/connected", account: next, chainId });
    };
    const onChain = (payload: unknown): void => {
      const next = parseChainId(payload);
      if (next === null) {
        setError("The wallet reported a chain this app could not read.");
        return;
      }
      dispatch({ type: "wallet/chainChanged", chainId: next });
    };

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [dispatch, chainId]);

  // The pre-flight runs once per account and reports only what the chain answered. `null` from
  // `moduleStatus` means unknown, and unknown is not dispatched at all: it stays `null` in state.
  useEffect(() => {
    if (account === null) {
      checkedRef.current = null;
      return undefined;
    }
    if (checkedRef.current === account) return undefined;
    checkedRef.current = account;

    let cancelled = false;
    void (async (): Promise<void> => {
      const status = await moduleStatus(account);
      if (cancelled || status === null) return;
      dispatch({ type: "module/status", installed: status });
    })();
    return (): void => {
      cancelled = true;
    };
  }, [account, dispatch]);

  return { hasWallet, connecting, error, connect, disconnect, switchChain, dismissError };
}
