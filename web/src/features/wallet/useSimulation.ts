import { useCallback, useRef } from "react";
import type { ComposableExecution } from "@latch/client";
import type { Address } from "viem";
import { useApp, useDispatch } from "@/app/AppProvider";
import { Phase, type SimulationResult } from "@/app/state";
import { simulate } from "./simulate";

export interface SimulationControl {
  /** True while the machine is in `simulating`. The button shows its busy state from this. */
  readonly running: boolean;
  /** `previewing` with something to run: the only state where a simulation is meaningful. */
  readonly canRun: boolean;
  readonly run: () => Promise<void>;
}

/**
 * The async half of the panel: `simulate/start` → `simulate` → `simulate/done`.
 *
 * `start` and `done` are dispatched as a pair so the machine always comes back to `previewing`,
 * even if the call itself misbehaves: a phase stuck in `simulating` would disable the button for
 * the rest of the session and read as a hang. The batch is captured at the moment `run` is called,
 * so the bytes dispatched are the bytes simulated — the reducer clears the result the instant the
 * batch changes, and this must not race ahead of that.
 */
export function useSimulation(): SimulationControl {
  const { phase, calls, account } = useApp();
  const dispatch = useDispatch();
  const inFlight = useRef(false);

  const running = phase === Phase.Simulating;
  const canRun = phase === Phase.Previewing && calls.length > 0 && !running;

  const run = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    const batch: readonly ComposableExecution[] = calls;
    const sender: Address | null = account;
    if (phase !== Phase.Previewing || batch.length === 0) return;

    inFlight.current = true;
    dispatch({ type: "simulate/start" });
    try {
      const result = await simulate(batch, sender);
      dispatch({ type: "simulate/done", result });
    } catch (cause) {
      // Not a pass. The panel has to return to `previewing` with words the user can act on.
      const result: SimulationResult = {
        ok: false,
        message: `The simulation could not be run: ${cause instanceof Error ? cause.message : String(cause)}`,
        revertReason: "no revert data",
        at: Date.now(),
      };
      dispatch({ type: "simulate/done", result });
    } finally {
      inFlight.current = false;
    }
  }, [account, calls, dispatch, phase]);

  return { running, canRun, run };
}
