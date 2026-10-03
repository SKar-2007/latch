/**
 * Pinned addresses.
 *
 * Every address the app can call is configuration, never discovery. Nothing here is read from the
 * chain at runtime: a selector collision or an address swap has to be caught in review, not by
 * whatever the network returns that afternoon (docs/06, Environment).
 *
 * The "Verified" rows reproduce README's verified-constants table, checked on Base Sepolia on
 * 2026-10-02 against three independent providers. The LATCH-owned helpers are deployment outputs
 * and are supplied through the environment, because they are not deployed yet.
 */

export const CHAIN_ID = 84532;
export const CHAIN_NAME = "Base Sepolia";

/** Bytes. Composability module, verified on chain. `isModuleType` true for 2 and 3 only. */
export const COMPOSABILITY_MODULE = "0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7" as const;
/** Verified on chain. 575 bytes. */
export const COMPOSABLE_STORAGE = "0x00008211dea1Aca67ac55fc44AE3bF88CF41281d" as const;
/** Verified on chain via `getEntryPoint`. */
export const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

/**
 * Nexus 1.3.1. `accountId()` is `biconomy.nexus.1.3.1`; it has native `executeComposable`, so no
 * module installation is needed. Assert `accountId()` before trusting any configuration.
 */
export const NEXUS_1_3_1 = "0x0000000020fe2F30453074aD916eDeB653eC7E9D" as const;

/**
 * Documented but the wrong build. No `executeComposable`. Kept only so the UI can name it when it
 * sees one, which is exactly the failure the verification log records.
 */
export const NEXUS_1_2_0_WRONG = "0x000000004F43C49e93C970E84001853a70923B03" as const;

/** Chainlink ETH/USD on Base Sepolia. 8 decimals, 1200s heartbeat. */
export const ETH_USD_FEED = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1" as const;
export const ETH_USD_DECIMALS = 8;
export const ETH_USD_HEARTBEAT_SEC = 1200;

/** Live Base Sepolia addresses used by the demo batch. Verified; see verification-log V-06, V-07. */
export const DEMO_TARGETS = {
  router: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  weth: "0x4200000000000000000000000000000000000006",
  aavePool: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
} as const;

/**
 * A LATCH-owned address that has not been supplied. The UI renders these as `not configured`
 * rather than substituting a plausible address: a guard that is not deployed must look like it is
 * not deployed.
 */
export const UNCONFIGURED = "" as const;

const env = (key: string): string => {
  const value = import.meta.env[key];
  return typeof value === "string" && value.length > 0 ? value : UNCONFIGURED;
};

export interface LatchDeployment {
  readonly feedGuard: string;
  readonly quoterGuard: string;
  readonly failSafe: string;
}

/** Deployment addresses from `VITE_*`. Empty string means not configured, never a guess. */
export const DEPLOYMENT: LatchDeployment = {
  feedGuard: env("VITE_FEED_GUARD"),
  quoterGuard: env("VITE_QUOTER_GUARD"),
  failSafe: env("VITE_FAILSAFE"),
};

export function isConfigured(address: string): boolean {
  return address.length === 42 && address.startsWith("0x");
}

/**
 * A human-readable name for an address, or undefined.
 *
 * Supplied as a table, never inferred from a partial match — an unknown address renders as literal
 * hex, because a review screen must not assert a name the chain never gave it.
 */
export const ADDRESS_NAMES: Readonly<Record<string, string>> = {
  [COMPOSABILITY_MODULE.toLowerCase()]: "composability module",
  [COMPOSABLE_STORAGE.toLowerCase()]: "composable storage",
  [ENTRYPOINT_V07.toLowerCase()]: "EntryPoint v0.7",
  [NEXUS_1_3_1.toLowerCase()]: "Nexus 1.3.1",
  [ETH_USD_FEED.toLowerCase()]: "Chainlink ETH/USD",
  [DEMO_TARGETS.router.toLowerCase()]: "SwapRouter02",
  [DEMO_TARGETS.usdc.toLowerCase()]: "USDC",
  [DEMO_TARGETS.weth.toLowerCase()]: "WETH",
  [DEMO_TARGETS.aavePool.toLowerCase()]: "Aave V3 Pool",
};
