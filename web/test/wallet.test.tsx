import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeErrorResult } from "viem";
import type { ComposableExecution } from "@latch/client";
import { AppProvider, useDispatch } from "@/app/AppProvider";
import type { AppAction } from "@/app/state";
import { ConnectWallet, SimulationPanel, mapRevertReason } from "@/features/wallet";
import { moduleStatus } from "@/features/wallet/moduleStatus";
import { simulate } from "@/features/wallet/simulate";

/**
 * Seat C: the wallet session and the simulation panel.
 *
 * Two of the rules this seat exists to enforce are tested against fixtures that came off the
 * deployed contracts rather than off somebody's imagination:
 *
 * - `0xa31844b0` + an `EQ`/`GTE` ordinal is what `executeComposable` actually returned when a
 *   predicate batch asked for more than the bound allowed (measured against Base Sepolia).
 * - The `Error(string)` blob is what the deployed USDC returned for an over-balance transfer.
 *
 * Nothing here talks to a network. The two modules that could (`moduleStatus`, `simulate`) are
 * mocked for every test, so a passing run proves nothing about connectivity — only about the
 * mapping and the rendering.
 */

vi.mock("@/features/wallet/moduleStatus", () => ({
  moduleStatus: vi.fn(async (): Promise<boolean | null> => null),
}));

vi.mock("@/features/wallet/simulate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/wallet/simulate")>();
  return { ...actual, simulate: vi.fn() };
});

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const EXPECTED_RPC_CHAIN = "0x14a34";
const EXPECTED_CHAIN_ID = 84532;

/** Live revert: `ConstraintNotMet` with ordinal 1 (`GTE`), padded to a word. */
const CONSTRAINT_NOT_MET = `0xa31844b0${(1).toString(16).padStart(64, "0")}`;

/** Byte-identical to the reason the deployed USDC returns for an over-balance transfer. */
const USDC_REASON = "ERC20: transfer amount exceeds balance";
const USDC_REVERT = encodeErrorResult({
  abi: [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }],
  errorName: "Error",
  args: [USDC_REASON],
});

const CALL: ComposableExecution = {
  functionSig: "0xa9059cbb",
  inputParams: [],
  outputParams: [],
};

/** Module-level so the driver's effect runs once per mount rather than once per render. */
const CONNECTED: readonly AppAction[] = [
  { type: "wallet/connected", account: ACCOUNT, chainId: EXPECTED_CHAIN_ID },
];
const PREVIEWING: readonly AppAction[] = [
  ...CONNECTED,
  { type: "build/ready", calls: [CALL] },
];
/** Preview state with nothing in it: the button's disabled state is the batch, not the phase. */
const PREVIEWING_EMPTY: readonly AppAction[] = [
  ...CONNECTED,
  { type: "build/ready", calls: [] },
];

function Driver({ actions }: { readonly actions: readonly AppAction[] }) {
  const dispatch = useDispatch();
  useEffect(() => {
    for (const action of actions) dispatch(action);
  }, [actions, dispatch]);
  return null;
}

function renderPanels(actions: readonly AppAction[] = []) {
  return render(
    <AppProvider>
      <Driver actions={actions} />
      <ConnectWallet />
      <SimulationPanel />
    </AppProvider>,
  );
}

function installWallet(options: { readonly chainId?: string } = {}) {
  const request = vi.fn(
    async (args: { readonly method: string; readonly params?: readonly unknown[] }) => {
      if (args.method === "eth_requestAccounts") return [ACCOUNT];
      if (args.method === "eth_chainId") return options.chainId ?? EXPECTED_RPC_CHAIN;
      if (args.method === "wallet_switchEthereumChain") return null;
      throw Object.assign(new Error(`unexpected method ${args.method}`), { code: -32601 });
    },
  );
  Object.defineProperty(window, "ethereum", { value: { request }, configurable: true });
  return { request };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  Reflect.deleteProperty(window, "ethereum");
});

describe("D7 — a revert reason is a sentence, not a selector", () => {
  it("maps ConstraintNotMet to full words and keeps the selector underneath as detail", () => {
    const mapped = mapRevertReason(CONSTRAINT_NOT_MET);

    expect(mapped.message).toMatch(/bound you set was violated/i);
    expect(mapped.message).toMatch(/nothing was executed/i);
    expect(mapped.message).not.toMatch(/0x/);

    expect(mapped.revertReason).toContain("0xa31844b0");
    expect(mapped.revertReason).toContain("ConstraintNotMet(GTE)");
  });

  it("maps a string reason the chain returned, keeping the raw text in the detail", () => {
    const mapped = mapRevertReason(USDC_REVERT);

    expect(mapped.message).toMatch(/does not hold enough/i);
    expect(mapped.message).not.toContain(USDC_REASON);

    expect(mapped.revertReason).toContain(USDC_REASON);
    expect(mapped.revertReason).toContain("0x08c379a0");
  });

  it("never returns an empty sentence for revert data it does not recognise", () => {
    const mapped = mapRevertReason("0xdeadbeef");
    expect(mapped.message.length).toBeGreaterThan(0);
    expect(mapped.message).toMatch(/unrecognised/i);
    expect(mapped.revertReason).toContain("0xdeadbeef");
  });
});

describe("ConnectWallet", () => {
  it("renders the no wallet detected state when window.ethereum is absent", () => {
    renderPanels();

    expect(screen.getByText("No wallet detected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect/i })).toBeNull();
  });

  it("connects through the injected provider and shows the truncated account", async () => {
    const user = userEvent.setup();
    const { request } = installWallet();

    renderPanels();
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));

    expect(request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(await screen.findByText("0x1111…1111")).toBeInTheDocument();
    expect(screen.queryByText("not connected")).toBeNull();
    expect(screen.queryByText(/wrong network/i)).toBeNull();
  });

  it("renders the module status as unknown while the check has no answer", async () => {
    const user = userEvent.setup();
    installWallet();

    renderPanels();
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));

    expect(await screen.findByText("module: unknown")).toBeInTheDocument();
    expect(screen.queryByText("module: installed")).toBeNull();
    expect(screen.queryByText("module: not installed")).toBeNull();
    expect(vi.mocked(moduleStatus)).toHaveBeenCalledWith(ACCOUNT);
  });

  it("names the wrong chain and switches to Base Sepolia on request", async () => {
    const user = userEvent.setup();
    const { request } = installWallet({ chainId: "0x1" });

    renderPanels();
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));

    expect(await screen.findByText("Wrong network")).toBeInTheDocument();
    expect(screen.getByText("chain 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to Base Sepolia" }));

    expect(request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: EXPECTED_RPC_CHAIN }],
    });
  });
});

describe("SimulationPanel", () => {
  it("keeps Run simulation disabled while the batch is empty", () => {
    renderPanels(PREVIEWING_EMPTY);
    expect(screen.getByRole("button", { name: "Run simulation" })).toBeDisabled();
    expect(screen.getByText(/no batch to simulate yet/i)).toBeInTheDocument();
  });

  it("runs the batch and renders the sentence with the raw reason underneath", async () => {
    const user = userEvent.setup();
    vi.mocked(simulate).mockResolvedValue({
      ok: false,
      ...mapRevertReason(CONSTRAINT_NOT_MET),
      at: 1_700_000_000_000,
    });

    renderPanels(PREVIEWING);
    const button = screen.getByRole("button", { name: "Run simulation" });
    expect(button).toBeEnabled();

    await user.click(button);

    expect(vi.mocked(simulate)).toHaveBeenCalledWith([CALL], ACCOUNT);
    const announced = await screen.findByRole("alert");
    expect(announced).toHaveTextContent(/bound you set was violated/i);
    expect(announced).not.toHaveTextContent("0xa31844b0");
    expect(screen.getByText(/0xa31844b0/)).toBeInTheDocument();
  });

  it("does not claim a pass for a batch that was never run", () => {
    renderPanels(PREVIEWING);
    expect(screen.getByText(/not simulated yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/simulation succeeded/i)).toBeNull();
  });
});
