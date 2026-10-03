import { describe, expect, it } from "vitest";
import { decodeBatch, describeConstraint } from "../src/decoder";
import {
  balance,
  callData,
  captureExecResult,
  entry,
  encodeBatch,
  eq,
  gte,
  gteSigned,
  inRange,
  inRangeSigned,
  lte,
  lteSigned,
  or,
  skip,
  staticCall,
  target,
  value,
} from "../src/builder";
import { ConstraintType, InputParamType, type Constraint } from "../src/types";

const A = "0x1111111111111111111111111111111111111111";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";

const label = (c: Constraint): string => {
  const v = describeConstraint(c) as { kind: string; label?: string };
  return v.label ?? v.kind;
};

describe("every constraint renders with its own operator", () => {
  /**
   * @dev This is the invariant docs/09 promises for the decoder, stated as a table rather than as a
   *      loop over a list, because a loop would pass if the operator were accidentally the same
   *      constant for every case.
   */
  it("distinguishes all nine constraint types", () => {
    const cases: [Constraint, string][] = [
      [eq(5n), "= 5"],
      [gte(5n), "≥ 5"],
      [lte(5n), "≤ 5"],
      [inRange(1n, 5n), "within 1 … 5"],
      [gteSigned(-5n), "≥ (signed) -5"],
      [lteSigned(-5n), "≤ (signed) -5"],
      [or([eq(1n), gte(2n)]), "any of"],
      [skip(), "not checked (SKIP)"],
    ];

    for (const [c, expected] of cases) {
      expect(label(c)).toBe(expected);
    }

    // Distinct operators must produce distinct renderings.
    const distinct = new Set(cases.map(([c]) => label(c)));
    expect(distinct.size).toBe(cases.length);
  });

  it("renders a signed range as signed and says so", () => {
    expect(label(inRangeSigned(-5n, -1n))).toBe("within (signed) -5 … -1");
  });

  it("renders OR sub-constraints rather than collapsing them", () => {
    expect(label(or([eq(1n), lte(2n)]))).toBe("any of");
    const v = describeConstraint(or([eq(1n), lte(2n)]));
    expect(v.kind).toBe("any-of");
    expect((v as { subs: readonly string[] }).subs).toEqual(["= 1", "≤ 2"]);
  });
});

describe("SKIP is never rendered as a pass", () => {
  /**
   * @dev Rule 1 of the frontend blueprint. A green tick on a field that was never validated is worse
   *      than no tick at all, so the verdict has its own kind rather than reusing `checked`.
   */
  it("uses a distinct verdict kind", () => {
    const v = describeConstraint(skip());
    expect(v.kind).toBe("not-checked");
    expect(v.kind).not.toBe("checked");
  });

  it("says so in the rendered text", () => {
    expect(label(skip())).toContain("not checked");
  });
});

describe("a runtime value is never shown as known", () => {
  /**
   * @dev Rule 3 of the blueprint, and the one most likely to be violated, because a client that has
   *      simulated the batch already has a number in hand and is tempted to display it.
   */
  it("shows the call for a STATIC_CALL, not a result", () => {
    const steps = decodeBatch(
      encodeBatch([entry({ functionSig: "0xdeadbeef", inputParams: [staticCall(ROUTER, "0x12345678")] })]),
    );

    const source = steps[0]!.params[0]!.source;
    expect(source.kind).toBe("runtime");
    expect("value" in source).toBe(false);
    expect((source as { label: string }).label).toContain("result of");
  });

  it("shows which token and account a BALANCE will read", () => {
    const steps = decodeBatch(
      encodeBatch([entry({ functionSig: "0xdeadbeef", inputParams: [balance(USDC, A, [gte(1n)])] })]),
    );

    const source = steps[0]!.params[0]!.source;
    expect(source.kind).toBe("balance");
    expect((source as { label: string }).label.toLowerCase()).toContain(USDC.toLowerCase());
    expect((source as { label: string }).label.toLowerCase()).toContain(A.toLowerCase());
  });

  it("names the native balance rather than showing an address", () => {
    const zero = "0x0000000000000000000000000000000000000000";
    const steps = decodeBatch(
      encodeBatch([entry({ functionSig: "0xdeadbeef", inputParams: [balance(zero, A, [gte(1n)])] })]),
    );
    expect((steps[0]!.params[0]!.source as { label: string }).label).toContain("native balance");
  });
});

describe("unknown targets are not guessed", () => {
  it("falls back to the literal address", () => {
    const steps = decodeBatch(
      encodeBatch([entry({ functionSig: "0xdeadbeef", inputParams: [target(ROUTER)] })]),
    );
    expect(steps[0]!.target?.toLowerCase()).toBe(ROUTER.toLowerCase());
  });

  it("uses a supplied name when there is one", () => {
    const steps = decodeBatch(encodeBatch([entry({ functionSig: "0xdeadbeef", inputParams: [target(ROUTER)] })]), {
      names: { [ROUTER.toLowerCase()]: "Uniswap V3 SwapRouter02" },
    });
    expect(steps[0]!.target).toBe("Uniswap V3 SwapRouter02");
  });

  it("leaves a predicate with no target rather than inventing one", () => {
    const steps = decodeBatch(
      encodeBatch([entry({ functionSig: "0xdeadbeef", inputParams: [balance(USDC, A, [gte(1n)])] })]),
    );
    expect(steps[0]!.isPredicate).toBe(true);
    expect(steps[0]!.target).toBeUndefined();
  });
});

describe("the decoder renders every constraint in the batch", () => {
  /**
   * @dev The docs/09 invariant: "For any valid batch, the decoder renders every constraint with its
   *      operator."
   *
   *      The risk it guards against is a gate existing in the batch that never reaches the screen. A
   *      user who cannot see a bound cannot consent to it, and the batch still executes.
   */
  it("counts every constraint across every input param", () => {
    const constraints: Constraint[] = [eq(1n), gte(2n), lte(3n)];
    // Three constraints need three words of resolved value; the builder enforces that, so the data has
    // to actually be three words long.
    const threeWords = `0x${"1".repeat(64)}${"2".repeat(64)}${"3".repeat(64)}` as const;
    const batch = [
      entry({
        functionSig: "0xdeadbeef",
        inputParams: [
          callData(threeWords, constraints),
          balance(USDC, A, [gte(1n)]),
          staticCall(ROUTER, "0x12345678", [inRange(1n, 2n)]),
          target(ROUTER),
        ],
      }),
    ];

    const steps = decodeBatch(encodeBatch(batch));
    // 3 literal + 1 balance + 1 static call. The TARGET carries none, and BALANCE takes at most one
    // constraint because it resolves to exactly one word.
    expect(steps[0]!.gates).toHaveLength(5);

    const declared = batch[0]!.inputParams.reduce((n, p) => n + p.constraints.length, 0);
    expect(steps[0]!.gates).toHaveLength(declared);
  });

  it("never drops a gate when the batch mixes param types", () => {
    const batch = [
      entry({
        functionSig: "0xaaaaaaaa",
        inputParams: [target(ROUTER), value(1n), callData(`0x${"2".repeat(64)}`, [gte(1n)])],
      }),
      entry({
        functionSig: "0xbbbbbbbb",
        inputParams: [staticCall(ROUTER, "0xdeadbeef", [lte(9n), skip()])],
      }),
    ];

    const steps = decodeBatch(encodeBatch(batch));
    expect(steps[0]!.gates).toHaveLength(1);
    expect(steps[1]!.gates).toHaveLength(2);
    expect(steps[1]!.gates[1]!.verdict.kind).toBe("not-checked");
  });

  it("keeps gate order aligned with the params that carry them", () => {
    const batch = [
      entry({
        functionSig: "0xcccccccc",
        inputParams: [balance(USDC, A, [gte(1n)]), callData(`0x${"3".repeat(64)}`, [lte(2n)])],
      }),
    ];
    const steps = decodeBatch(encodeBatch(batch));
    expect(steps[0]!.gates.map((g) => g.paramIndex)).toEqual([0, 1]);
    expect(steps[0]!.gates.map((g) => g.wordIndex)).toEqual([0, 0]);
  });
});

describe("captures are described, not silently dropped", () => {
  it("names the word count and the storage key", () => {
    const steps = decodeBatch(
      encodeBatch([
        entry({
          functionSig: "0xdddddddd",
          outputParams: [
            captureExecResult({
              returnValues: 2,
              storageContract: A,
              storageKey: `0x${"ab".repeat(32)}`,
            }),
          ],
        }),
      ]),
    );
    expect(steps[0]!.captures).toHaveLength(1);
    expect(steps[0]!.captures[0]).toContain("2 word(s)");
    expect(steps[0]!.captures[0]).toContain("abab");
  });
});

describe("param types are reported, not collapsed", () => {
  it("keeps TARGET, VALUE and CALL_DATA distinguishable", () => {
    const steps = decodeBatch(
      encodeBatch([
        entry({
          functionSig: "0xeeeeeeee",
          inputParams: [target(ROUTER), value(5n), callData("0x1234")],
        }),
      ]),
    );
    expect(steps[0]!.params.map((p) => p.paramType)).toEqual([
      InputParamType.TARGET,
      InputParamType.VALUE,
      InputParamType.CALL_DATA,
    ]);
  });

  it("shows VALUE in wei rather than as a raw word", () => {
    const steps = decodeBatch(
      encodeBatch([entry({ functionSig: "0xffffffff", inputParams: [value(1_000_000n)] })]),
    );
    expect((steps[0]!.params[0]!.source as { label: string }).label).toBe("1000000 wei");
  });
});

describe("enum ordinals are the ones the chain uses", () => {
  /**
   * @dev V-10: enum ordering is part of the encoding, not an implementation detail. If a member moves,
   *      every previously signed batch decodes differently.
   */
  it("matches the Solidity declaration order", () => {
    expect([
      ConstraintType.EQ,
      ConstraintType.GTE,
      ConstraintType.LTE,
      ConstraintType.IN,
      ConstraintType.GTE_SIGNED,
      ConstraintType.LTE_SIGNED,
      ConstraintType.OR,
      ConstraintType.SKIP,
      ConstraintType.IN_SIGNED,
    ]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});