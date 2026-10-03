/**
 * Seat C barrel.
 *
 * The wallet seat was taken over mid-session and rebuilt around a different split: the components are
 * presentational and every side effect lives in a hook. This barrel follows that structure rather
 * than the one it replaced, because the split is the better one — `ConnectWallet` rendering state
 * that `useWallet` produced is easier to reason about than a component that both prompts for a
 * signature and renders the result of it.
 *
 * `useAccountProbe` was removed from this barrel. Its account-probing job is now `moduleStatus`, and
 * its connector job is `useWallet`, so it was dead weight with two jobs already covered.
 */

export { ConnectWallet } from "./ConnectWallet";
export { SimulationPanel } from "./SimulationPanel";

export { mapRevertReason } from "./revertReasons";
export type { MappedRevert } from "./revertReasons";

export { moduleStatus } from "./moduleStatus";

export { simulate, EXECUTE_COMPOSABLE_SELECTOR, EXECUTE_COMPOSABLE_SIGNATURE } from "./simulate";

export { useSimulation } from "./useSimulation";
export type { SimulationControl } from "./useSimulation";

export { getInjectedProvider, useWallet } from "./useWallet";
export type { Eip1193Provider, WalletController } from "./useWallet";