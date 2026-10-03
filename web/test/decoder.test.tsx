import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BatchPreview, GATE_TONE } from "@/features/decoder";
import { Policy } from "@/app/state";
import {
  BASE_SEPOLIA,
  balance,
  buildDemoBatch,
  buildFailingDemoBatch,
  entry,
  gte,
  lte,
  skip,
} from "@latch/client";

const ACCOUNT = "0x1234567890123456789012345678901234567890";
const FEED_GUARD = "0x00000000000000000000000000000000000000AA";
/** 0.001 WETH: the signed floor of the demo batch, and a value a simulation could resolve. */
const MIN_OUT = 1_000_000_000_000_000n;

const opts = { account: ACCOUNT, feedGuard: FEED_GUARD, minAmountOut: MIN_OUT };

const demo = () => buildDemoBatch(opts);
const failing = () => buildFailingDemoBatch(opts);

/** A simulation that resolved numbers of its own, so a leak into a param line would be visible. */
const simulation = {
  ok: true,
  gasUsed: 987654321n,
  message: "simulated message: 424242 units",
  at: Date.parse("2026-10-03T12:00:00Z"),
};

const nodes = (container: Element, selector: string): HTMLElement[] =>
  [...container.querySelectorAll(selector)] as HTMLElement[];

describe("the plan is rendered as numbered steps", () => {
  it("renders six steps, numbered 1 to 6", () => {
    const { container } = render(<BatchPreview calls={demo()} />);

    const steps = nodes(container, ".dec-step");
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(nodes(container, ".dec-step__num").map((n) => n.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
  });

  it("summarises entries, predicates, calls and gates", () => {
    render(<BatchPreview calls={demo()} />);

    expect(screen.getByText("6 entries")).toBeInTheDocument();
    expect(screen.getByText("[assert] × 3")).toBeInTheDocument();
    expect(screen.getByText("[call] × 3")).toBeInTheDocument();
    expect(screen.getByText("3 gates")).toBeInTheDocument();
  });

  it("badges steps 1, 2 and 5 as assertions and the rest as calls", () => {
    const { container } = render(<BatchPreview calls={demo()} />);
    const steps = nodes(container, ".dec-step");

    for (const index of [0, 1, 4]) {
      expect(within(steps[index]!).getByText("[assert]")).toBeInTheDocument();
    }
    for (const index of [2, 3, 5]) {
      expect(within(steps[index]!).getByText("[call]")).toBeInTheDocument();
    }
    expect(screen.getAllByText("[assert]")).toHaveLength(3);
    expect(screen.getAllByText("[call]")).toHaveLength(3);
  });

  it("names a target only when the caller supplied a name, and shows hex otherwise", () => {
    render(<BatchPreview calls={demo()} names={{ [BASE_SEPOLIA.router.toLowerCase()]: "Router" }} />);

    expect(screen.getAllByText("Router").length).toBeGreaterThan(0);
    // No entry for the pool: literal hex, never a guessed contract name.
    expect(screen.getAllByText(BASE_SEPOLIA.aavePool.toLowerCase()).length).toBeGreaterThan(0);
  });
});

describe("D1: a SKIP is not a pass", () => {
  const calls = [
    entry({ functionSig: "0xdeadbeef", inputParams: [balance(BASE_SEPOLIA.usdc, ACCOUNT, [skip()])] }),
  ];

  it("renders NOT CHECKED through the not-checked tone", () => {
    const { container } = render(<BatchPreview calls={calls} />);

    const badge = container.querySelector(".ui-gate--not-checked");
    expect(badge).not.toBeNull();
    expect(badge).toHaveClass("ui-gate--not-checked");
    expect(badge?.textContent).toContain("NOT CHECKED");
    expect(badge?.textContent).toContain("not checked (SKIP)");
  });

  it("never renders a green or blocked outcome tone anywhere in the plan", () => {
    const { container } = render(<BatchPreview calls={calls} />);

    expect(container.querySelector(".ui-gate--pass")).toBeNull();
    expect(container.querySelector(".ui-gate--blocked")).toBeNull();
    expect(container.innerHTML).not.toContain("ui-gate--pass");
    expect(container.innerHTML).not.toContain("ui-gate--blocked");
  });
});

describe("D2: the operator is always visible", () => {
  const calls = [
    entry({ functionSig: "0xdeadbeef", inputParams: [balance(BASE_SEPOLIA.usdc, ACCOUNT, [gte(1000n)])] }),
    entry({ functionSig: "0xdeadbeef", inputParams: [balance(BASE_SEPOLIA.usdc, ACCOUNT, [lte(1000n)])] }),
  ];

  it("distinguishes ≥ 1000 from ≤ 1000 at a glance", () => {
    const { container } = render(<BatchPreview calls={calls} />);

    const gteLine = screen.getByText("≥ 1000");
    const lteLine = screen.getByText("≤ 1000");

    expect(gteLine).toBeInTheDocument();
    expect(lteLine).toBeInTheDocument();
    expect(gteLine.textContent).not.toBe(lteLine.textContent);
    expect(gteLine).not.toBe(lteLine);
    expect(container.innerHTML).toContain("≥ 1000");
    expect(container.innerHTML).toContain("≤ 1000");
  });

  it("keeps the operator inside the badge, not in a tooltip", () => {
    render(<BatchPreview calls={calls} />);

    const gteBadge = screen.getByText("≥ 1000").closest(".ui-gate");
    const lteBadge = screen.getByText("≤ 1000").closest(".ui-gate");

    expect(gteBadge?.textContent).toContain("≥ 1000");
    expect(lteBadge?.textContent).toContain("≤ 1000");
    expect(gteBadge?.textContent).not.toBe(lteBadge?.textContent);
  });

  it("shows the signed literal bound as well, so a runtime value is visibly different in kind", () => {
    render(<BatchPreview calls={demo()} />);

    expect(screen.getByText("≥ 15000000")).toBeInTheDocument();
    expect(screen.getByText("= 1")).toBeInTheDocument();
  });
});

describe("D3: runtime and balance params show the mechanism, never a value", () => {
  it("describes the call that will produce each runtime amount", () => {
    const { container } = render(<BatchPreview calls={demo()} simulation={simulation} />);

    const runtime = nodes(container, ".dec-param--runtime");
    expect(runtime).toHaveLength(3);

    for (const line of runtime) {
      expect(line.textContent).toMatch(/result of 0x[0-9a-fA-F]{40}\.0x[0-9a-fA-F]{8}\(\)/);
      expect(line.textContent).toContain("resolved on-chain at execution");
      // 15000000 is the signed amount a simulation would resolve here; 987654321 is its gas.
      expect(line.textContent).not.toMatch(/15000000|987654321|424242|wei/);
    }
  });

  it("describes the balance read without printing a number", () => {
    const { container } = render(<BatchPreview calls={demo()} simulation={simulation} />);

    const balances = nodes(container, ".dec-param--balance");
    expect(balances).toHaveLength(2);

    for (const line of balances) {
      expect(line.textContent).toMatch(
        /balance of 0x[0-9a-fA-F]{40} held by 0x[0-9a-fA-F]{40}/,
      );
      expect(line.textContent).toContain("resolved on-chain at execution");
      expect(line.textContent).not.toMatch(/15000000|987654321|424242|wei/);
    }
  });

  it("keeps the simulation's own numbers inside the simulated banner only", () => {
    const { container } = render(<BatchPreview calls={demo()} simulation={simulation} />);

    expect(screen.getByText("simulated message: 424242 units")).toBeInTheDocument();
    for (const line of [...nodes(container, ".dec-param--runtime"), ...nodes(container, ".dec-param--balance")]) {
      expect(line.textContent).not.toContain("424242");
    }
  });
});

describe("D4: the decoder emits description tones only", () => {
  it("maps verdicts onto exactly the four decoder tones", () => {
    expect(Object.keys(GATE_TONE).sort()).toEqual([
      "any-of",
      "checked",
      "not-checked",
      "undecodable",
    ]);
    expect(new Set(Object.values(GATE_TONE))).toEqual(
      new Set(["checked", "not-checked", "any-of", "undecodable"]),
    );
    expect(Object.values(GATE_TONE)).not.toContain("pass");
    expect(Object.values(GATE_TONE)).not.toContain("blocked");
  });

  it("renders neither pass nor blocked for the working or the failing batch", () => {
    for (const calls of [demo(), failing()]) {
      const { container } = render(<BatchPreview calls={calls} />);
      expect(container.querySelector(".ui-gate--pass")).toBeNull();
      expect(container.querySelector(".ui-gate--blocked")).toBeNull();
      expect(container.querySelectorAll(".dec-step")).toHaveLength(6);
    }
  });
});

describe("policy per entry", () => {
  const policy: readonly Policy[] = [
    Policy.RevertBatch,
    Policy.SkipCall,
    Policy.RevertBatch,
    Policy.RevertBatch,
    Policy.SkipCall,
    Policy.RevertBatch,
  ];

  it("shows REVERT_BATCH as neutral and SKIP_CALL as a warning that names the trade", () => {
    const { container } = render(<BatchPreview calls={demo()} policy={policy} />);

    expect(screen.getAllByText("REVERT_BATCH")).toHaveLength(4);
    expect(screen.getAllByText("SKIP_CALL")).toHaveLength(2);
    expect(container.querySelectorAll(".dec-policy--skip")).toHaveLength(2);
    expect(container.querySelectorAll(".dec-policy--revert")).toHaveLength(4);
    expect(screen.getAllByText(/opts out of atomicity/)).toHaveLength(2);
  });

  it("renders no policy chip when the caller declared none", () => {
    const { container } = render(<BatchPreview calls={demo()} />);

    expect(screen.queryByText("REVERT_BATCH")).toBeNull();
    expect(screen.queryByText("SKIP_CALL")).toBeNull();
    expect(container.querySelector(".dec-policy")).toBeNull();
  });
});

describe("simulation banner", () => {
  it("is labelled simulated — not guaranteed and sits above the plan", () => {
    const { container } = render(
      <BatchPreview
        calls={failing()}
        simulation={{ ok: false, message: "would revert: floor not met", at: simulation.at }}
      />,
    );

    expect(screen.getByText("simulated — not guaranteed")).toBeInTheDocument();
    expect(screen.getByText("would revert: floor not met")).toBeInTheDocument();

    const banner = container.querySelector(".dec-sim");
    const summary = container.querySelector(".dec-summary");
    expect(banner).not.toBeNull();
    expect(summary).not.toBeNull();
    expect(banner!.compareDocumentPosition(summary!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("never uses an outcome tone for a simulated result", () => {
    const { container } = render(<BatchPreview calls={demo()} simulation={{ ok: true, at: simulation.at }} />);

    expect(container.querySelector(".ui-alert--pass")).toBeNull();
    expect(container.querySelector(".ui-alert--block")).toBeNull();
    expect(container.querySelector(".ui-gate--pass")).toBeNull();
    expect(container.querySelector(".ui-gate--blocked")).toBeNull();
  });

  it("is absent when no simulation has run", () => {
    const { container } = render(<BatchPreview calls={demo()} />);

    expect(container.querySelector(".dec-sim")).toBeNull();
    expect(screen.queryByText("simulated — not guaranteed")).toBeNull();
  });
});

describe("empty state", () => {
  it("keeps the existing copy when there are no calls", () => {
    render(<BatchPreview calls={[]} />);

    expect(
      screen.getByText(
        "No batch built yet. Configure an intent and build it to see the decoded plan.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/steps/)).toBeNull();
  });
});
