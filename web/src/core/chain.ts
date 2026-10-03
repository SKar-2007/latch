import { createPublicClient, fallback, http, type Chain, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { CHAIN_ID } from "./addresses";

/**
 * Chain access for the app.
 *
 * Two cautions from docs/06 that are load-bearing here:
 *
 * - Fallback is per-call, not per-transaction. A write is never retried on timeout without first
 *   checking whether it landed, so writes go through `writeClient` (single provider) and only
 *   reads use the fallback list.
 * - Stale reads are worse than failed reads. Anything feeding a bound — a balance, a price, an
 *   oracle round — must come from the primary provider. The fallbacks exist for non-critical reads
 *   such as fetching a receipt that a timeout already told us exists.
 */

export const LATCH_CHAIN: Chain = {
  ...baseSepolia,
  id: CHAIN_ID,
};

const env = (key: string): string | undefined => {
  const value = import.meta.env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/**
 * RPC endpoints, primary first. Three slots are declared by docs/06; an unset slot is skipped
 * rather than substituted, so a missing key degrades to fewer providers instead of a broken URL.
 */
export const RPC_URLS: readonly string[] = [
  env("VITE_RPC_PRIMARY"),
  env("VITE_RPC_SECONDARY"),
  env("VITE_RPC_TERTIARY"),
].filter((u): u is string => u !== undefined);

const readTransport = () =>
  RPC_URLS.length > 1
    ? fallback(
        RPC_URLS.map((url) =>
          http(url, { batch: true, retryCount: 3, retryDelay: 300, timeout: 10_000 }),
        ),
      )
    : http(RPC_URLS[0] ?? "https://sepolia.base.org", {
        batch: true,
        retryCount: 3,
        retryDelay: 300,
        timeout: 10_000,
      });

/** Reads. Rotates providers on failure. */
export const readClient: PublicClient = createPublicClient({
  chain: LATCH_CHAIN,
  transport: readTransport(),
});

/**
 * Writes and anything where a duplicate submission would be harmful. One provider, no rotation.
 * A timeout here means "go and look", never "send it again".
 */
export const writeClient: PublicClient = createPublicClient({
  chain: LATCH_CHAIN,
  transport: http(RPC_URLS[0] ?? "https://sepolia.base.org", {
    retryCount: 1,
    timeout: 15_000,
  }),
});

export const EXPECTED_CHAIN_ID = CHAIN_ID;

export function isExpectedChain(chainId: number): boolean {
  return chainId === EXPECTED_CHAIN_ID;
}
