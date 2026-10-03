import { type Dispatch, useEffect } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { AppProvider, useDispatch } from "@/app/AppProvider";
import { AppShell } from "@/app/AppShell";
import type { AppAction } from "@/app/state";
import { mapRevertReason } from "@/features/wallet";
import { simulate } from "@/features/wallet/simulate";

/**
 * Seat H: the whole machine, end to end.
 *
 * The unit seats test their own panels against fixtures. This file tests the wiring between them —
 * the path a user actually walks — so the assertions are on the markers a user sees: the phase chip
 * in the wallet panel, the numbered steps of the plan, the notices each panel raises, and the
 * receipt status at the end.
 *
 * Boundaries are mocked so the run proves nothing about connectivity:
 *
 *   - `window.ethereum` is a scripted EIP-1193 stub (chain 84532, one account).
 *   - `simulate` never issues an `eth_call`.
 *   - `moduleStatus` never reads bytecode.
 *   - `writeClient.waitForTransactionReceipt` never waits, so the real `ExecutionTracker` can walk
 *     its own confirmation path without a network.
 *
 * Two seams are exercised through a dispatch probe rather than through a button, because the
 * rejection itself has no producer a test can drive honestly:
 *
 *   - nothing dispatches `sign/rejected` from a test; the wallet refusal is injected at the
 *     dispatch boundary and the handling — the phase, the notice, the surviving plan — is what is
 *     under test. Seat F's `useExecution` is covered against the real rejection path in
 *     `test/execute.test.tsx`.
 *
 * The happy path no longer needs a seam for submission: seat F wired intent → send → receipt, so
 * the stub wallet answers `eth_signTypedData_v4` and `eth_sendTransaction` and the machine walks
 * itself to `submitting`. Only the receipt is gated, so the test can observe `submitting` before
 * the chain "produces" its outcome instead of watching both stages flash past in one act.
 */

/**
 * The receipt lookup is gated rather than resolved, so the test can assert `submitting` before the
 * chain "produces" its outcome instead of watching both stages flash past in one act.
 */
const receiptGate = vi.hoisted(() => ({ release: null as null | (() => void) }));

vi.mock("../src/features/wallet/simulate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/features/wallet/simulate")>();
  return { ...actual, simulate: vi.fn() };
});

vi.mock("@/features/wallet/moduleStatus", () => ({
  moduleStatus: vi.fn(async (): Promise<boolean | null> => true),
}));

vi.mock("@/core/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/chain")>();
  return {
    ...actual,
    writeClient: {
      ...actual.writeClient,
      waitForTransactionReceipt: vi.fn(
        (): Promise<{
          readonly status: "success" | "reverted";
          readonly gasUsed: bigint;
        }> =>
          new Promise((resolve) => {
            receiptGate.release = () => resolve({ status: "success", gasUsed: 21_000n });
          }),
      ),
    },
  };
});

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TRUNCATED = "0x1111…1111";
const EXPECTED_RPC_CHAIN = "0x14a34";
const TX_HASH =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
/** What a wallet would hand back for an EIP-712 intent. Shape only — nothing verifies it here. */
const INTENT_SIGNATURE =
  `0x${"ab".repeat(65)}` as const;
/** Live revert: `ConstraintNotMet` with ordinal 1 (`GTE`), padded to a word. */
const CONSTRAINT_NOT_MET = `0xa31844b0${(1).toString(16).padStart(64, "0")}`;
const REJECTED = "User rejected the request.";

/** The label seat F chose. Named once so a copy change fails in one obvious place. */
const SIGN_LABEL = "Sign intent and submit batch";

type User = ReturnType<typeof userEvent.setup>;

function installWallet() {
  const request = vi.fn(
    async (args: { readonly method: string; readonly params?: readonly unknown[] }) => {
      if (args.method === "eth_requestAccounts") return [ACCOUNT];
      if (args.method === "eth_chainId") return EXPECTED_RPC_CHAIN;
      if (args.method === "wallet_switchEthereumChain") return null;
      if (args.method === "eth_signTypedData_v4") return INTENT_SIGNATURE;
      if (args.method === "eth_sendTransaction") return TX_HASH;
      throw Object.assign(new Error(`unexpected method ${args.method}`), { code: -32601 });
    },
  );
  Object.defineProperty(window, "ethereum", { value: { request }, configurable: true });
  return { request };
}

interface Sink {
  current: Dispatch<AppAction> | null;
}

function DispatchProbe({ sink }: { readonly sink: Sink }) {
  sink.current = useDispatch();
  return null;
}

/**
 * `<App />` with a dispatch seam. Same tree as `App` (`AppProvider` + `AppShell`) plus one component
 * that hands the test the reducer, because two seams in this flow have no button to press.
 */
function renderApp() {
  const sink: Sink = { current: null };
  const view = render(
    <AppProvider>
      <DispatchProbe sink={sink} />
      <AppShell />
    </AppProvider>,
  );
  return {
    ...view,
    async dispatch(action: AppAction) {
      const send = sink.current;
      if (send === null) throw new Error("the app did not mount");
      await act(async () => {
        send(action);
      });
    },
  };
}

/**
 * The wallet panel, found by its header title rather than by any text it happens to contain: the
 * account, the phase and the module chip are all rendered elsewhere on the page too.
 */
function walletPanel(): HTMLElement {
  const panel = [...document.querySelectorAll<HTMLElement>(".ui-panel")].find(
    (candidate) => candidate.querySelector(".ui-panel__header > span")?.textContent === "Wallet",
  );
  if (panel === undefined) throw new Error("the wallet panel did not render");
  return panel;
}

/** The phase chip in that panel's header — the app's own answer to "where am I?". */
function phase(): string | null {
  return walletPanel().querySelector(".ui-chip")?.textContent ?? null;
}

const planSteps = (): number => document.querySelectorAll(".dec-step").length;
const EMPTY_PLAN =
  "No batch built yet. Configure an intent and build it to see the decoded plan.";

async function connect(user: User) {
  await user.click(screen.getByRole("button", { name: "Connect wallet" }));
  await waitFor(() =>
    expect(within(walletPanel()).getByText(TRUNCATED)).toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(within(walletPanel()).getByText("module: installed")).toBeInTheDocument(),
  );
  expect(phase()).toBe("connected");
}

async function build(user: User) {
  await user.click(screen.getByRole("button", { name: "Build batch" }));
  await waitFor(() => expect(planSteps()).toBe(6));
  expect(screen.getByText("The plan — 6 steps")).toBeInTheDocument();
  expect(phase()).toBe("previewing");
}

async function simulateOk(user: User) {
  vi.mocked(simulate).mockResolvedValue({ ok: true, gasUsed: 42_000n, at: Date.now() });
  await user.click(screen.getByRole("button", { name: "Run simulation" }));
  await screen.findByText("Simulation succeeded.");
}

beforeEach(() => {
  vi.clearAllMocks();
  receiptGate.release = null;
});

afterEach(() => {
  Reflect.deleteProperty(window, "ethereum");
});

describe("happy path: connect → build → simulate → sign → receipt", () => {
  it("walks the whole machine and marks every stage", async () => {
    const user = userEvent.setup();
    installWallet();
    renderApp();

    expect(phase()).toBe("disconnected");
    expect(planSteps()).toBe(0);
    expect(screen.getByText(EMPTY_PLAN)).toBeInTheDocument();

    await connect(user);
    expect(planSteps()).toBe(0);

    await build(user);
    expect(planSteps()).toBe(6);

    await simulateOk(user);
    expect(phase()).toBe("previewing");
    // A successful simulation is a chain-produced outcome, so green is legal here (D4).
    expect(document.querySelector(".ui-alert--pass")).not.toBeNull();

    // Sign. The button is offered only from a preview that just passed, and seat F's hook takes it
    // from there: intent signature, then `eth_sendTransaction`, then `submit/start`.
    await user.click(screen.getByRole("button", { name: SIGN_LABEL }));
    await waitFor(() => expect(phase()).toBe("submitting"));
    expect(planSteps()).toBe(6);
    expect(screen.getByText(TX_HASH)).toBeInTheDocument();

    // The receipt lands only when the chain says so: nothing is confirmed before then.
    await waitFor(() => expect(receiptGate.release).not.toBeNull());
    await act(async () => {
      receiptGate.release?.();
      receiptGate.release = null;
    });

    await screen.findByText("Confirmed");
    await waitFor(() => expect(phase()).toBe("confirmed"));
    expect(screen.getByText(TX_HASH)).toBeInTheDocument();
    expect(planSteps()).toBe(6);
  });

  it("renders no outcome tone before the chain has produced one", async () => {
    const user = userEvent.setup();
    installWallet();
    renderApp();

    await connect(user);
    await build(user);

    expect(document.querySelector(".ui-gate--pass")).toBeNull();
    expect(document.querySelector(".ui-gate--blocked")).toBeNull();
    expect(document.querySelector(".ui-alert--pass")).toBeNull();
    expect(document.querySelector(".ui-alert--block")).toBeNull();
    expect(document.body.innerHTML).not.toContain("ui-gate--pass");
    expect(screen.getByText(/Not simulated yet/i)).toBeInTheDocument();
  });
});

describe("unhappy path: the signature is rejected", () => {
  it("lands back in building with an actionable notice, and the plan survives", async () => {
    const user = userEvent.setup();
    installWallet();
    const app = renderApp();

    await connect(user);
    await build(user);
    await simulateOk(user);
    expect(phase()).toBe("previewing");

    // `sign/start` is what the Sign button dispatches; the rejection itself has no producer in the
    // app yet, so it is injected at the seam the brief allows.
    await app.dispatch({ type: "sign/start" });
    await app.dispatch({ type: "sign/rejected", message: REJECTED });

    await waitFor(() => expect(phase()).toBe("building"));

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("SIGNATURE_REJECTED");
    expect(notice).toHaveTextContent(REJECTED);
    // Actionable: it can be cleared without reloading, and clearing it leaves the machine alone.
    await user.click(within(notice).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(phase()).toBe("building");

    // The plan is untouched by a rejected signature: the user can fix the intent and try again.
    expect(planSteps()).toBe(6);
    expect(screen.getByText("The plan — 6 steps")).toBeInTheDocument();
    // The simulation is gone with it, so nothing green survives a rejected signature.
    expect(document.querySelector(".ui-alert--pass")).toBeNull();
    expect(document.querySelector(".dec-sim")).toBeNull();
    expect(screen.getByText(/Not simulated yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Not ready to sign/i)).toBeInTheDocument();
  });
});

describe("unhappy path: the simulation fails", () => {
  it("returns to previewing with a mapped sentence and never renders a green gate", async () => {
    const user = userEvent.setup();
    installWallet();
    const mapped = mapRevertReason(CONSTRAINT_NOT_MET);
    vi.mocked(simulate).mockResolvedValue({ ok: false, ...mapped, at: Date.now() });
    renderApp();

    await connect(user);
    await build(user);

    await user.click(screen.getByRole("button", { name: "Run simulation" }));

    const notice = await screen.findByRole("alert");
    // D7: a sentence, not a selector. The raw selector stays underneath as detail.
    expect(notice).toHaveTextContent(/bound you set was violated/i);
    expect(notice).not.toHaveTextContent("0xa31844b0");
    expect(screen.getByText(/0xa31844b0/)).toBeInTheDocument();

    await waitFor(() => expect(phase()).toBe("previewing"));
    expect(planSteps()).toBe(6);

    // D4: a failed simulation produced an outcome, but not a passing one.
    expect(document.querySelector(".ui-alert--pass")).toBeNull();
    expect(document.querySelector(".ui-gate--pass")).toBeNull();
    expect(document.querySelector(".ui-gate--blocked")).toBeNull();
    expect(document.body.innerHTML).not.toContain("ui-gate--pass");
    expect(screen.queryByText(/Sign intent and build UserOp/)).toBeNull();
    expect(screen.getByRole("button", { name: SIGN_LABEL })).toBeDisabled();
    expect(screen.getByText(/Not ready to sign/i)).toBeInTheDocument();
  });
});

describe("unhappy path: the batch is edited after a simulation", () => {
  it("clears the simulation the moment a bound changes", async () => {
    const user = userEvent.setup();
    installWallet();
    renderApp();

    await connect(user);
    await build(user);
    await simulateOk(user);

    expect(document.querySelector(".dec-sim")).not.toBeNull();
    expect(document.querySelector(".ui-alert--pass")).not.toBeNull();
    expect(screen.queryByText(/Not simulated yet/i)).toBeNull();

    // The builder exposes the bound directly: a preset radio, not a free-text field (D5).
    await user.click(screen.getByLabelText("Volatile to volatile, long bridge"));

    await waitFor(() => expect(phase()).toBe("building"));
    expect(document.querySelector(".dec-sim")).toBeNull();
    expect(document.querySelector(".ui-alert--pass")).toBeNull();
    expect(screen.getByText(/Not simulated yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Simulation runs from the preview/i)).toBeInTheDocument();
    expect(screen.getByText(/Not ready to sign/i)).toBeInTheDocument();

    // The batch itself was not edited, so the plan stays on screen — only its evidence is gone.
    expect(planSteps()).toBe(6);
    expect(screen.getByText("The plan — 6 steps")).toBeInTheDocument();
  });
});
