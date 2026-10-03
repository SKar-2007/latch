import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntentBuilder } from "@/features/builder";
import { DEFAULT_BOUNDS, type Bounds, type Policy } from "@/app/state";

interface HarnessProps {
  readonly bounds?: Bounds;
  readonly policy?: readonly Policy[];
  readonly onBoundsChange?: (bounds: Bounds) => void;
  readonly onPolicyChange?: (index: number, policy: Policy) => void;
  readonly onBuild?: () => void;
  readonly busy?: boolean;
}

function renderBuilder(props: HarnessProps = {}) {
  const onBoundsChange = props.onBoundsChange ?? vi.fn();
  const onPolicyChange = props.onPolicyChange ?? vi.fn();
  const onBuild = props.onBuild ?? vi.fn();
  const view = render(
    <IntentBuilder
      bounds={props.bounds ?? DEFAULT_BOUNDS}
      policy={props.policy ?? []}
      onBoundsChange={onBoundsChange}
      onPolicyChange={onPolicyChange}
      onBuild={onBuild}
      {...(props.busy !== undefined ? { busy: props.busy } : {})}
    />,
  );
  return { ...view, onBoundsChange, onPolicyChange, onBuild };
}

const slippageGroup = () => screen.getByRole("group", { name: "Slippage tolerance" });

describe("D5 — slippage is presets only", () => {
  it("exposes exactly four radios and no editable input", () => {
    renderBuilder();
    const group = slippageGroup();

    const inputs = Array.from(group.querySelectorAll("input"));
    expect(inputs).toHaveLength(4);
    for (const input of inputs) {
      expect(input.getAttribute("type")).toBe("radio");
      expect(input).not.toHaveAttribute("contenteditable");
    }
    expect(group.querySelector('input[type="text"]')).toBeNull();
    expect(group.querySelector('input[type="number"]')).toBeNull();
    expect(group.querySelector("textarea")).toBeNull();
    expect(group.querySelector("select")).toBeNull();

    // Nothing anywhere in the panel offers a free-text route to slippage.
    expect(screen.queryByRole("textbox", { name: /slippage/i })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /slippage/i })).toBeNull();
  });

  it("shows the numeric percentage of every documented preset", () => {
    renderBuilder();
    const group = slippageGroup();

    expect(within(group).getByText("0.50%")).toBeInTheDocument();
    expect(within(group).getByText("1.00%")).toBeInTheDocument();
    expect(within(group).getByText("3.00%")).toBeInTheDocument();
    expect(within(group).getByText("2.00%")).toBeInTheDocument();

    expect(within(group).getByLabelText("Stable to stable")).toBeInTheDocument();
    expect(within(group).getByLabelText("Stable to volatile")).toBeInTheDocument();
    expect(
      within(group).getByLabelText("Volatile to volatile, long bridge"),
    ).toBeInTheDocument();
    expect(within(group).getByLabelText("Complex multi-chain rebalancing")).toBeInTheDocument();
  });

  it("publishes the chosen preset as a new bound", async () => {
    const user = userEvent.setup();
    const { onBoundsChange } = renderBuilder();

    await user.click(within(slippageGroup()).getByLabelText("Volatile to volatile, long bridge"));

    expect(onBoundsChange).toHaveBeenCalledTimes(1);
    expect(onBoundsChange).toHaveBeenCalledWith({ ...DEFAULT_BOUNDS, slippageBps: 300 });
    expect(within(slippageGroup()).getByText("3.00%")).toBeInTheDocument();
  });
});

describe("D6 — SKIP_CALL needs a confirmation", () => {
  it("does not change policy until the confirmation is accepted, and cancelling reverts", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const { onPolicyChange } = renderBuilder({ policy: ["REVERT_BATCH"] });

    expect(screen.queryByRole("alert")).toBeNull();

    await user.click(screen.getByRole("button", { name: "SKIP_CALL" }));

    const confirmation = screen.getByRole("alert");
    expect(confirmation).toHaveTextContent(/skip segment 1/i);
    expect(confirmation).toHaveTextContent(/provenance invariant/i);
    expect(confirmation).toHaveTextContent(/later steps may observe state/i);
    expect(onPolicyChange).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));

    expect(onPolicyChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "REVERT_BATCH" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    confirm.mockRestore();
  });

  it("applies SKIP_CALL only after the confirmation is accepted", async () => {
    const user = userEvent.setup();
    const { onPolicyChange } = renderBuilder({ policy: ["REVERT_BATCH"] });

    await user.click(screen.getByRole("button", { name: "SKIP_CALL" }));
    await user.click(screen.getByRole("button", { name: "Confirm SKIP_CALL" }));

    expect(onPolicyChange).toHaveBeenCalledTimes(1);
    expect(onPolicyChange).toHaveBeenCalledWith(0, "SKIP_CALL");
  });
});

describe("build action", () => {
  it("calls onBuild", async () => {
    const user = userEvent.setup();
    const { onBuild } = renderBuilder({ policy: ["REVERT_BATCH"] });

    await user.click(screen.getByRole("button", { name: "Build batch" }));
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  it("is disabled while busy", () => {
    renderBuilder({ busy: true, policy: ["REVERT_BATCH"] });
    expect(screen.getByRole("button", { name: "Building…" })).toBeDisabled();
  });
});

describe("intent summary", () => {
  const bounds: Bounds = {
    minOutput: "0.001",
    slippageBps: 300,
    maxStalenessSec: 600,
    priceBandBps: 50,
  };

  it("renders the current amount, pair and bounds", () => {
    renderBuilder({ bounds, policy: ["REVERT_BATCH", "SKIP_CALL"] });

    const summary = screen.getByText(/slippage 3\.00%/);
    expect(summary).toHaveTextContent("15 USDC → WETH");
    expect(summary).toHaveTextContent("freshness 10m");
    expect(summary).toHaveTextContent("band 0.50%");
    expect(summary).toHaveTextContent("1 of 2 segments opted out of atomicity");
  });
});

describe("bounded controls", () => {
  it("labels every control it renders", () => {
    const { container } = renderBuilder({ policy: ["REVERT_BATCH"] });
    const controls = container.querySelectorAll("input, select");
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const id = control.getAttribute("id");
      expect(id).not.toBeNull();
      expect(container.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
  });

  it("offers staleness only from the documented stepped values", async () => {
    const user = userEvent.setup();
    const { onBoundsChange } = renderBuilder();

    const select = screen.getByLabelText("Max staleness");
    const options = Array.from(select.querySelectorAll("option")).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["1m", "5m", "10m", "20m", "1h"]);

    await user.selectOptions(select, "600");
    expect(onBoundsChange).toHaveBeenCalledWith({ ...DEFAULT_BOUNDS, maxStalenessSec: 600 });
  });

  it("shows the minimum output in base units alongside the display value", () => {
    renderBuilder();
    expect(screen.getByText("1000000000000000")).toBeInTheDocument();
    const input = screen.getByLabelText<HTMLInputElement>("Minimum output (WETH)");
    expect(String(input.value)).toBe("0.001");
  });
});
