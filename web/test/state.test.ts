import { describe, expect, it } from "vitest";
import {
  canTransition,
  INITIAL_STATE,
  Phase,
  Policy,
  reducer,
  TRANSITIONS,
  type AppAction,
  type AppState,
} from "@/app/state";
import { buildDemoBatch } from "@latch/client";

const ACCOUNT = "0x00000000000000000000000000000000000000aa" as const;

function apply(actions: readonly AppAction[], from: AppState = INITIAL_STATE): AppState {
  return actions.reduce(reducer, from);
}

const connected = () =>
  reducer(INITIAL_STATE, { type: "wallet/connected", account: ACCOUNT, chainId: 84532 });

const built = () => {
  const calls = buildDemoBatch({ account: ACCOUNT, feedGuard: ACCOUNT, minAmountOut: 10n ** 15n });
  return reducer(connected(), { type: "build/ready", calls });
};

describe("phase table", () => {
  it("gives every phase at least one way forward", () => {
    for (const next of Object.values(TRANSITIONS)) {
      expect(next.length).toBeGreaterThan(0);
    }
  });

  it("declares only phases that exist", () => {
    const known = new Set(Object.values(Phase));
    for (const next of Object.values(TRANSITIONS).flat()) {
      expect(known.has(next)).toBe(true);
    }
  });

  it("keeps signing behind a simulation", () => {
    expect(canTransition(Phase.Previewing, Phase.Submitting)).toBe(false);
    expect(canTransition(Phase.Simulating, Phase.Submitting)).toBe(false);
    expect(canTransition(Phase.AwaitingSignature, Phase.Submitting)).toBe(true);
  });

  it("rejects an illegal transition rather than applying it", () => {
    const state = connected();
    const next = reducer(state, { type: "submit/start", txHash: null });
    expect(next).toBe(state);
    expect(next.phase).toBe(Phase.Connected);
  });
});

describe("wallet", () => {
  it("clears the module status on connect rather than assuming it", () => {
    expect(connected().moduleInstalled).toBeNull();
  });

  it("enters moduleMissing only when the check reports it missing", () => {
    const missing = reducer(connected(), { type: "module/status", installed: false });
    expect(missing.phase).toBe(Phase.ModuleMissing);
    expect(missing.moduleInstalled).toBe(false);
  });

  it("disconnects from any live phase", () => {
    for (const start of [built(), reducer(built(), { type: "simulate/start" })]) {
      const next = reducer(start, { type: "wallet/disconnected" });
      expect(next.phase).toBe(Phase.Disconnected);
      expect(next.calls).toHaveLength(0);
    }
  });
});

describe("build and invalidate", () => {
  it("defaults every segment to REVERT_BATCH", () => {
    const state = built();
    expect(state.calls.length).toBeGreaterThan(0);
    expect(state.policy).toEqual(state.calls.map(() => Policy.RevertBatch));
  });

  it("clears the simulation when the batch changes", () => {
    const simulated = apply(
      [
        { type: "simulate/start" },
        { type: "simulate/done", result: { ok: true, at: 1 } },
      ],
      built(),
    );
    expect(simulated.simulation?.ok).toBe(true);

    const changed = reducer(simulated, {
      type: "bounds/set",
      bounds: { ...simulated.bounds, slippageBps: 100 },
    });
    expect(changed.simulation).toBeNull();
  });

  it("clears the simulation when a policy changes", () => {
    const simulated = apply(
      [
        { type: "simulate/start" },
        { type: "simulate/done", result: { ok: true, at: 1 } },
      ],
      built(),
    );
    const changed = reducer(simulated, {
      type: "policy/set",
      index: 0,
      policy: Policy.SkipCall,
    });
    expect(changed.policy[0]).toBe(Policy.SkipCall);
    expect(changed.simulation).toBeNull();
  });
});

describe("outcome phases", () => {
  it("returns to the preview with the reason attached when a simulation fails", () => {
    const state = apply(
      [
        { type: "simulate/start" },
        {
          type: "simulate/done",
          result: { ok: false, revertReason: "ConstraintNotMet", at: 1 },
        },
      ],
      built(),
    );
    expect(state.phase).toBe(Phase.Previewing);
    expect(state.simulation?.ok).toBe(false);
    expect(state.simulation?.revertReason).toBe("ConstraintNotMet");
  });

  it("moves to failed on a reverted receipt and to confirmed on success", () => {
    const submitting = apply(
      [
        { type: "simulate/start" },
        { type: "simulate/done", result: { ok: true, at: 1 } },
        { type: "sign/start" },
        { type: "submit/start", txHash: "0xabc" },
      ],
      built(),
    );
    expect(submitting.phase).toBe(Phase.Submitting);

    expect(reducer(submitting, { type: "submit/receipt", status: "success" }).phase).toBe(
      Phase.Confirmed,
    );
    expect(reducer(submitting, { type: "submit/receipt", status: "reverted" }).phase).toBe(
      Phase.Failed,
    );
  });
});
