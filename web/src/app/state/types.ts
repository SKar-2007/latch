import type { ComposableExecution, Hex } from "@latch/client";

/**
 * The UI state machine, transcribed from the mermaid diagram in docs/06-frontend-blueprint.md.
 *
 * Phases are ordered. An action that would move the machine outside `TRANSITIONS` is rejected by
 * the reducer rather than silently applied, because every one of these steps corresponds to
 * something the user was told happened. The reducer is pure; effects (RPC, wallet, bundler) live
 * in the feature hooks and dispatch back into it.
 */

export const Phase = {
  Disconnected: "disconnected",
  Connected: "connected",
  ModuleMissing: "moduleMissing",
  Building: "building",
  Previewing: "previewing",
  Simulating: "simulating",
  AwaitingSignature: "awaitingSignature",
  Submitting: "submitting",
  Confirmed: "confirmed",
  Failed: "failed",
} as const;

export type Phase = (typeof Phase)[keyof typeof Phase];

/**
 * Legal moves. Anything not listed is a bug in the caller, not a state the app can be in.
 *
 * `previewing -> building` exists because editing a previewed batch must invalidate its
 * simulation: a stale simulation is indistinguishable from a passing one in the UI.
 */
export const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  [Phase.Disconnected]: [Phase.Connected],
  [Phase.Connected]: [
    Phase.Disconnected,
    Phase.ModuleMissing,
    Phase.Building,
    Phase.Previewing,
  ],
  [Phase.ModuleMissing]: [Phase.Connected, Phase.Disconnected],
  [Phase.Building]: [Phase.Previewing, Phase.Connected, Phase.Disconnected],
  [Phase.Previewing]: [
    Phase.Building,
    Phase.Simulating,
    Phase.AwaitingSignature,
    Phase.Connected,
    Phase.Disconnected,
  ],
  [Phase.Simulating]: [
    Phase.Previewing,
    Phase.AwaitingSignature,
    Phase.Disconnected,
  ],
  [Phase.AwaitingSignature]: [
    Phase.Submitting,
    Phase.Building,
    Phase.Previewing,
    Phase.Disconnected,
  ],
  [Phase.Submitting]: [Phase.Confirmed, Phase.Failed, Phase.Disconnected],
  [Phase.Confirmed]: [Phase.Building, Phase.Connected],
  [Phase.Failed]: [Phase.Building, Phase.Previewing, Phase.Connected],
};

/** Failure policy per entry. `REVERT_BATCH` is the default on every segment; see docs/05. */
export const Policy = {
  RevertBatch: "REVERT_BATCH",
  SkipCall: "SKIP_CALL",
} as const;

export type Policy = (typeof Policy)[keyof typeof Policy];

/** Bounds the user sets before signing. All values are the raw strings a form produces. */
export interface Bounds {
  /** Minimum output in human units, rendered next to the slippage preset that produced it. */
  readonly minOutput: string;
  /** Slippage in basis points. Presets only — see docs/06, `<SlippageControl>`. */
  readonly slippageBps: number;
  /** Oracle freshness window in seconds. */
  readonly maxStalenessSec: number;
  /** Price band in basis points around the observed rate. */
  readonly priceBandBps: number;
}

export const DEFAULT_BOUNDS: Bounds = {
  /**
   * Demo pre-fill: 0.001 WETH, the floor the client's own demo fixture uses.
   *
   * A production value comes from a quote at signing time. `QuoterGuard` cannot supply one yet —
   * V-23 is open, the documented Base Sepolia QuoterV2 address does not implement `IQuoterV2` —
   * so the field is user-entered and labelled as such rather than presented as quoted.
   */
  minOutput: "0.001",
  slippageBps: 50,
  maxStalenessSec: 1200,
  priceBandBps: 100,
};

/**
 * The result of an `eth_call` simulation.
 *
 * `message` is the mapped, actionable sentence. `revertReason` is the raw selector or decoded
 * string and is shown only as detail underneath it: a bare `ConstraintNotMet` is not an error
 * message (docs/06, UI state machine).
 */
export interface SimulationResult {
  readonly ok: boolean;
  readonly gasUsed?: bigint;
  readonly revertReason?: string;
  readonly message?: string;
  readonly at: number;
}

export interface AppError {
  readonly code: string;
  readonly message: string;
}

export interface AppState {
  readonly phase: Phase;
  /** Checksummed account address, or null when no wallet is connected. */
  readonly account: `0x${string}` | null;
  readonly chainId: number;
  /** null until the check has run. Never optimistically true. */
  readonly moduleInstalled: boolean | null;
  /** The batch under review. Empty until a build succeeds. */
  readonly calls: readonly ComposableExecution[];
  readonly bounds: Bounds;
  readonly policy: readonly Policy[];
  readonly simulation: SimulationResult | null;
  readonly txHash: Hex | null;
  readonly receiptStatus: "success" | "reverted" | null;
  readonly error: AppError | null;
}

export const INITIAL_STATE: AppState = {
  phase: Phase.Disconnected,
  account: null,
  chainId: 84532,
  moduleInstalled: null,
  calls: [],
  bounds: DEFAULT_BOUNDS,
  policy: [],
  simulation: null,
  txHash: null,
  receiptStatus: null,
  error: null,
};

export type AppAction =
  | { readonly type: "wallet/connected"; readonly account: `0x${string}`; readonly chainId: number }
  | { readonly type: "wallet/disconnected" }
  | { readonly type: "wallet/chainChanged"; readonly chainId: number }
  | { readonly type: "module/status"; readonly installed: boolean }
  | { readonly type: "module/installed" }
  | {
      readonly type: "build/ready";
      readonly calls: readonly ComposableExecution[];
      readonly policy?: readonly Policy[];
    }
  | { readonly type: "build/reset" }
  | { readonly type: "bounds/set"; readonly bounds: Bounds }
  | { readonly type: "policy/set"; readonly index: number; readonly policy: Policy }
  | { readonly type: "simulate/start" }
  | { readonly type: "simulate/done"; readonly result: SimulationResult }
  | { readonly type: "sign/start" }
  | { readonly type: "sign/rejected"; readonly message: string }
  | { readonly type: "submit/start"; readonly txHash: Hex | null }
  | { readonly type: "submit/receipt"; readonly status: "success" | "reverted" }
  | { readonly type: "fail"; readonly error: AppError }
  /** Attach a message without moving the machine. Validation and configuration errors land here. */
  | { readonly type: "error/set"; readonly error: AppError }
  | { readonly type: "error/clear" };

/** True when the machine may move from `from` to `to`. Exported so tests can assert the table. */
export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from].includes(to);
}
