import {
  canTransition,
  DEFAULT_BOUNDS,
  INITIAL_STATE,
  Phase,
  type AppAction,
  type AppState,
} from "./types";

/**
 * Pure reducer for the UI state machine.
 *
 * Two rules it enforces, both of which exist because getting them wrong tells the user something
 * the chain did not say:
 *
 * 1. An illegal phase transition is ignored. The machine only moves along `TRANSITIONS`.
 * 2. Any change to the batch, its bounds or its policy clears the simulation. A simulation result
 *    belongs to the exact bytes that were simulated; reusing it after an edit is indistinguishable
 *    in the UI from a fresh pass.
 */

function move(state: AppState, to: Phase, patch: Partial<AppState>): AppState {
  if (!canTransition(state.phase, to)) {
    if (import.meta.env.DEV) {
      console.error(`[latch] rejected transition ${state.phase} -> ${to}`);
    }
    return state;
  }
  return { ...state, ...patch, phase: to };
}

/**
 * For actions where the payload matters more than the phase: the patch is always applied, and the
 * phase only moves when the machine allows it. Editing a bound while already in `building` must
 * still take effect even though `building -> building` is not a transition.
 */
function retarget(state: AppState, to: Phase, patch: Partial<AppState>): AppState {
  const merged = { ...state, ...patch };
  return canTransition(state.phase, to) ? { ...merged, phase: to } : merged;
}

/** Every path that edits the batch. The simulation is stale the moment any of them runs. */
function invalidateSimulation(state: AppState): Partial<AppState> {
  return state.simulation === null ? {} : { simulation: null };
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "wallet/connected":
      return move(state, Phase.Connected, {
        account: action.account,
        chainId: action.chainId,
        moduleInstalled: null,
        error: null,
      });

    case "wallet/disconnected":
      // Disconnecting is legal from every live phase: the wallet can be revoked at any moment.
      return {
        ...INITIAL_STATE,
        chainId: state.chainId,
        bounds: state.bounds,
      };

    case "wallet/chainChanged": {
      const chainId = action.chainId;
      return { ...state, chainId, simulation: null, error: null };
    }

    case "module/status":
      if (state.phase === Phase.Connected && !action.installed) {
        return move(state, Phase.ModuleMissing, { moduleInstalled: false });
      }
      if (state.phase === Phase.ModuleMissing && action.installed) {
        return move(state, Phase.Connected, { moduleInstalled: true });
      }
      return { ...state, moduleInstalled: action.installed };

    case "module/installed":
      return move(state, Phase.Connected, { moduleInstalled: true, error: null });

    case "build/ready": {
      // Calls built means the batch is reviewable, so the machine lands in `previewing`
      // (docs/06: Building -> Previewing, "calls built"). A rebuild from `confirmed` has to pass
      // through `building` first, which is why a fresh intent is a separate step.
      const patch: Partial<AppState> = {
        calls: action.calls,
        policy: action.policy ?? action.calls.map(() => "REVERT_BATCH" as const),
        error: null,
        ...invalidateSimulation(state),
      };
      return move(state, Phase.Previewing, patch);
    }

    case "build/reset":
      return retarget(state, Phase.Building, {
        calls: [],
        policy: [],
        simulation: null,
        txHash: null,
        receiptStatus: null,
        error: null,
      });

    // Editing the intent invalidates the preview: a simulation belongs to the exact bytes that
    // were simulated, so the user has to build again before signing.
    case "bounds/set":
      return retarget(state, Phase.Building, {
        bounds: action.bounds,
        ...invalidateSimulation(state),
      });

    case "policy/set": {
      if (action.index < 0 || action.index >= state.policy.length) return state;
      const policy = state.policy.slice();
      policy[action.index] = action.policy;
      return retarget(state, Phase.Building, { policy, ...invalidateSimulation(state) });
    }

    case "simulate/start":
      return move(state, Phase.Simulating, { simulation: null, error: null });

    case "simulate/done": {
      // A successful simulation unlocks the signature step; a failed one returns the user to the
      // preview with the reason attached, which is where they can actually fix it.
      return move(state, Phase.Previewing, { simulation: action.result });
    }

    case "sign/start":
      return move(state, Phase.AwaitingSignature, { error: null });

    case "sign/rejected":
      return move(state, Phase.Building, {
        error: { code: "SIGNATURE_REJECTED", message: action.message },
        simulation: null,
      });

    case "submit/start":
      return move(state, Phase.Submitting, {
        txHash: action.txHash,
        receiptStatus: null,
        error: null,
      });

    case "submit/receipt": {
      const to = action.status === "success" ? Phase.Confirmed : Phase.Failed;
      return move(state, to, { receiptStatus: action.status });
    }

    case "fail":
      return move(state, Phase.Failed, { error: action.error });

    case "error/set":
      return { ...state, error: action.error };

    case "error/clear":
      return { ...state, error: null };

    default: {
      // Exhaustiveness: a new action without a branch fails to compile rather than silently
      // doing nothing at runtime.
      const never: never = action;
      return never;
    }
  }
}

export { INITIAL_STATE, DEFAULT_BOUNDS };
