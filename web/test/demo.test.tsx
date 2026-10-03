import { useEffect } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { buildFailingDemoBatch } from "@latch/client";
import { AppProvider, useApp, useDispatch } from "@/app/AppProvider";
import { DEFAULT_BOUNDS, type AppAction, type AppState } from "@/app/state";
import { DEPLOYMENT, isConfigured } from "@/core/addresses";
import { formatShort } from "@/components/ui";
import { DemoPanel } from "@/features/demo";

/**
 * Seat G: the demo driver.
 *
 * Nothing is mocked. `buildFailingDemoBatch` is pure, so the assertion is against what the pure
 * builder produces rather than against a spy, and the machine is the real reducer behind the real
 * provider — a dispatch the transition table rejects would show up as state that never moved.
 *
 * The observation point is a probe reading `useApp()`: state that changed is state that was
 * dispatched *and accepted*, which is what turns "dispatches nothing" into an assertion rather
 * than a hope. Demo-only UI state (the selected beat, the confirmed push) is invisible to it by
 * design, because it lives in the panel's own `useState`.
 */

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 84532;
const TX: `0x${string}` = "0x1111111111111111111111111111111111111111111111111111111111111111";
/** `DEFAULT_BOUNDS.minOutput` ("0.001" WETH) in 18 decimals. */
const FLOOR = 10n ** 15n;
/** A well-formed address for the configured-oracle case only. Never deployed, never called. */
const ORACLE_ADDRESS = "0x2222222222222222222222222222222222222222";

type Observed = Pick<AppState, "phase" | "calls" | "receiptStatus" | "error">;

const observed: { snapshots: Observed[] } = { snapshots: [] };

function Probe() {
  const state = useApp();
  observed.snapshots.push({
    phase: state.phase,
    calls: state.calls,
    receiptStatus: state.receiptStatus,
    error: state.error,
  });
  return (
    <>
      <output data-testid="calls">{state.calls.length}</output>
      <output data-testid="phase">{state.phase}</output>
      <output data-testid="error">
        {state.error === null ? "" : `${state.error.code}: ${state.error.message}`}
      </output>
    </>
  );
}

const CONNECTED: readonly AppAction[] = [
  { type: "wallet/connected", account: ACCOUNT, chainId: CHAIN_ID },
];

/** A full session up to a receipt, built from real actions so every hop is a legal transition. */
function session(receipt: "success" | "reverted"): readonly AppAction[] {
  return [
    ...CONNECTED,
    { type: "build/ready", calls: [] },
    { type: "sign/start" },
    { type: "submit/start", txHash: TX },
    { type: "submit/receipt", status: receipt },
  ];
}

/** Applies setup actions once on mount, the way a real session reaches the phase under test. */
function Driver({ actions }: { readonly actions: readonly AppAction[] }) {
  const dispatch = useDispatch();
  useEffect(() => {
    for (const action of actions) dispatch(action);
  }, [actions, dispatch]);
  return null;
}

function renderPanel(setup: readonly AppAction[] = []) {
  return render(
    <AppProvider>
      <Driver actions={setup} />
      <Probe />
      <DemoPanel />
    </AppProvider>,
  );
}

function rowAt(list: HTMLElement, index: number): HTMLElement {
  const row = within(list).getAllByRole("listitem")[index];
  if (row === undefined) throw new Error(`no checklist row at index ${index}`);
  return row;
}

const checklist = (): HTMLElement => screen.getByRole("list", { name: "Beat checklist" });

const lastSnapshot = (): Observed | undefined => observed.snapshots.at(-1);

beforeEach(() => {
  observed.snapshots = [];
  // The repo ships no `web/.env`, so this is already unset. Assigning keeps the precondition
  // explicit instead of assumed — a stray local `.env` must not make the suite lie.
  (import.meta.env as Record<string, unknown>).VITE_MOCK_ORACLE = "";
});

describe("beat 5 — the oracle is not deployed", () => {
  it("renders not configured, disables the driver, and dispatches nothing", () => {
    renderPanel(CONNECTED);
    expect((import.meta.env.VITE_MOCK_ORACLE ?? "") as string).toBe("");

    expect(screen.getByText("MockOracle not configured")).toBeInTheDocument();
    expect(screen.getByText(/VITE_MOCK_ORACLE is unset/)).toBeInTheDocument();

    const drive = screen.getByRole("button", { name: "Drive price out of band" });
    expect(drive).toBeDisabled();

    // A click on a disabled control reaches no handler (React skips it for disabled form
    // elements), so the machine cannot move: no build, no error, nothing to narrate later.
    const before = observed.snapshots.length;
    fireEvent.click(drive);

    expect(observed.snapshots.length).toBe(before);
    expect(screen.getByTestId("calls")).toHaveTextContent("0");
    expect(screen.getByTestId("phase")).toHaveTextContent("connected");
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("carries the deploy command and never invents an address", () => {
    renderPanel(CONNECTED);

    expect(screen.getByText(/forge create contracts\/mocks\/MockOracle\.sol/)).toBeInTheDocument();
    expect(screen.queryByText(/^0x[0-9a-fA-F]{40}$/)).toBeNull();
  });

  it("enables the driver and names the address only when VITE_MOCK_ORACLE is set", () => {
    (import.meta.env as Record<string, unknown>).VITE_MOCK_ORACLE = ORACLE_ADDRESS;
    renderPanel(CONNECTED);

    expect(screen.queryByText("MockOracle not configured")).toBeNull();
    expect(screen.getByRole("button", { name: "Drive price out of band" })).toBeEnabled();
    expect(screen.getByText(formatShort(ORACLE_ADDRESS))).toBeInTheDocument();
  });
});

describe("beats 1, 3 and 4 — the plans", () => {
  it("loads the failing batch through build/ready with six entries", async () => {
    const user = userEvent.setup();
    renderPanel(CONNECTED);

    await user.click(screen.getByRole("button", { name: "Load failing batch" }));

    await waitFor(() => expect(screen.getByTestId("calls")).toHaveTextContent("6"));

    const feedGuard = isConfigured(DEPLOYMENT.feedGuard) ? DEPLOYMENT.feedGuard : ACCOUNT;
    const after = lastSnapshot();
    expect(after?.calls).toHaveLength(6);
    expect(after?.calls).toEqual(
      buildFailingDemoBatch({ account: ACCOUNT, feedGuard, minAmountOut: FLOOR }),
    );
    expect(after?.phase).toBe("previewing");
  });

  it("refuses to build when the minimum output will not parse, and says why", async () => {
    const user = userEvent.setup();
    renderPanel([
      ...CONNECTED,
      { type: "bounds/set", bounds: { ...DEFAULT_BOUNDS, minOutput: "0.0.1" } },
    ]);

    await user.click(screen.getByRole("button", { name: "Load demo batch" }));

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("BAD_MIN_OUTPUT"));
    expect(screen.getByTestId("error")).toHaveTextContent("not a number");
    expect(screen.getByTestId("calls")).toHaveTextContent("0");
  });

  it("does not offer the plan controls before an account is connected", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Load demo batch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Load failing batch" })).toBeDisabled();
    expect(screen.getByText(/Connect the demo account first/)).toBeInTheDocument();
  });
});

describe("the beat checklist", () => {
  it("renders six rows and flips beat 1 from pending to done once a plan loads", async () => {
    const user = userEvent.setup();
    renderPanel(CONNECTED);

    const list = checklist();
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);

    expect(rowAt(list, 0)).toHaveTextContent("The plan");
    expect(rowAt(list, 0)).toHaveTextContent("calls.length > 0");
    expect(within(rowAt(list, 0)).getByText("pending")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load demo batch" }));

    await waitFor(() =>
      expect(within(rowAt(checklist(), 0)).getByText("done")).toBeInTheDocument(),
    );
    expect(within(rowAt(checklist(), 0)).queryByText("pending")).toBeNull();
  });

  it("marks the success from a success receipt", () => {
    renderPanel(session("success"));
    expect(within(rowAt(checklist(), 3)).getByText("pending")).toBeInTheDocument();
    expect(within(rowAt(checklist(), 2)).getByText("done")).toBeInTheDocument();
    expect(within(rowAt(checklist(), 1)).getByText("done")).toBeInTheDocument();
  });

  it("marks the failure from a reverted receipt, and the success back to pending", () => {
    renderPanel(session("reverted"));
    expect(within(rowAt(checklist(), 3)).getByText("done")).toBeInTheDocument();
    expect(within(rowAt(checklist(), 2)).getByText("pending")).toBeInTheDocument();
  });
});

describe("beats 2 and 6 — the read-only notes", () => {
  it("reports where the flow is, with no control of its own", () => {
    renderPanel(CONNECTED);

    const signature = screen.getByRole("region", { name: "Beat 2 · the signature" });
    expect(signature).toHaveTextContent("account connected, no plan loaded");
    expect(within(signature).queryByRole("button")).toBeNull();

    const honesty = screen.getByRole("region", { name: "Beat 6 · the honesty" });
    expect(honesty).toHaveTextContent(/Not demonstrated here/);
    expect(within(honesty).queryByRole("button")).toBeNull();
  });
});

describe("reset", () => {
  it("dispatches build/reset: the plan and the marks clear, the bounds stay", async () => {
    const user = userEvent.setup();
    renderPanel(CONNECTED);

    await user.click(screen.getByRole("button", { name: "Load demo batch" }));
    await waitFor(() => expect(screen.getByTestId("calls")).toHaveTextContent("6"));
    expect(screen.getByTestId("phase")).toHaveTextContent("previewing");

    await user.click(screen.getByRole("button", { name: "Reset" }));

    // `build/reset` is the action that both empties the plan and moves the machine to
    // `building`; an empty build would land back in `previewing`.
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("building"));
    expect(screen.getByTestId("calls")).toHaveTextContent("0");
    expect(within(rowAt(checklist(), 0)).getByText("pending")).toBeInTheDocument();
    expect(DEFAULT_BOUNDS.minOutput).toBe("0.001");
  });
});
