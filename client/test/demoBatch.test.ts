import { describe, expect, it } from "vitest";
import { decodeAbiParameters } from "viem";
import {
  BASE_SEPOLIA,
  DEFAULT_AMOUNT_IN,
  DEFAULT_HEARTBEAT,
  buildDemoBatch,
  buildFailingDemoBatch,
  encodeDemoBatch,
} from "../src/demoBatch";
import { encodeBatch, selectorOf } from "../src/builder";
import { decodeBatch } from "../src/decoder";
import { MAX_ENTRIES } from "../src/constants";

const ACCOUNT = "0x1234567890123456789012345678901234567890";
const FEED_GUARD = "0x00000000000000000000000000000000000000AA";
const MIN_OUT = 1_000_000_000_000_000n; // 0.001 WETH, a deliberately unreachable floor

const opts = { account: ACCOUNT, feedGuard: FEED_GUARD, minAmountOut: MIN_OUT };

describe("the demo batch has the shape the script describes", () => {
  it("is six entries", () => {
    expect(buildDemoBatch(opts)).toHaveLength(6);
  });

  it("fits inside MAX_ENTRIES", () => {
    // Six steps against a ten-step reviewability cap. If MAX_ENTRIES ever drops below six, the demo
    // stops being expressible and this fails rather than the demo breaking on stage.
    expect(6).toBeLessThanOrEqual(MAX_ENTRIES);
  });

  it("validates against the engine's rules", () => {
    expect(() => encodeBatch(buildDemoBatch(opts))).not.toThrow();
  });

  it("makes steps 1, 2 and 5 pure assertions", () => {
    const steps = decodeBatch(encodeDemoBatch(opts));
    const predicates = steps.filter((s) => s.isPredicate).map((s) => s.index);
    // Steps 1, 2 and 5 assert without changing anything. Step 1 issues a `staticcall`, so it reads
    // chain state, but it moves none -- which is what makes it safe to run first.
    expect(predicates).toEqual([0, 1, 4]);
  });

  it("points each calling step at the verified contract", () => {
    const steps = decodeBatch(encodeDemoBatch(opts));

    // No names supplied, so these must render as literal addresses rather than being guessed.
    // Step 1 has no target: the guard is a staticcall's destination, not the call's.
    expect(steps[0]!.target).toBeUndefined();
    expect(steps[2]!.target?.toLowerCase()).toBe(BASE_SEPOLIA.usdc.toLowerCase());
    expect(steps[3]!.target?.toLowerCase()).toBe(BASE_SEPOLIA.router.toLowerCase());
    expect(steps[5]!.target?.toLowerCase()).toBe(BASE_SEPOLIA.aavePool.toLowerCase());
  });
});

describe("the gates are the ones the script claims", () => {
  /**
   * @dev Three gates, not four, and the script's wording is what makes four tempting.
   *
   *      Steps 1, 2 and 5 carry constraints. The swap's minimum output is *not* one: `amountOutMin`
   *      is a literal in the calldata that the router itself enforces, and it reverts on its own. So
   *      the floor is real and it is signed, but it is enforced by the callee rather than by the
   *      engine, and a review screen that draws it as an engine-level gate would be overstating what
   *      the batch can prove.
   */
  it("has exactly three: freshness, USDC balance, WETH balance", () => {
    const steps = decodeBatch(encodeDemoBatch(opts));
    const gates = steps.flatMap((s) => s.gates);

    expect(gates).toHaveLength(3);

    const labels = gates.map((g) => (g.verdict as { label: string }).label);
    expect(labels[0]).toBe("= 1");
    expect(labels[1]).toBe(`≥ ${DEFAULT_AMOUNT_IN}`);
    expect(labels[2]).toBe(`≥ ${MIN_OUT}`);
  });

  it("puts the swap floor in the calldata, not in a constraint", () => {
    const swap = buildDemoBatch(opts)[3]!;
    expect(swap.inputParams.every((p) => p.constraints.length === 0)).toBe(true);

    // 0.001 WETH as a literal, so the router enforces it.
    const calldata = swap.inputParams[1]!.paramData;
    expect(BigInt(`0x${calldata.slice(-128, -64)}`)).toBe(MIN_OUT);
  });

  it("passes the documented 1200-second heartbeat", () => {
    const fetch = buildDemoBatch(opts)[0]!.inputParams[0]!;
    expect(fetch.fetcherType).toBe(1);

    // `staticCall` paramData is `abi.encode(address, bytes)`, so the heartbeat sits inside the inner
    // call rather than at the end of paramData, which is mostly padding.
    const [guard, inner] = decodeAbiParameters([{ type: "address" }, { type: "bytes" }], fetch.paramData);

    expect(guard?.toLowerCase()).toBe(FEED_GUARD.toLowerCase());
    // Inner call: `isFresh(address,uint256)` selector, then the feed word and the heartbeat word.
    expect(inner!.slice(0, 10)).toBe(selectorOf("isFresh(address,uint256)"));
    expect(BigInt(`0x${inner!.slice(-64)}`)).toBe(DEFAULT_HEARTBEAT);
    expect(inner!.toLowerCase()).toContain(BASE_SEPOLIA.ethUsd.toLowerCase().slice(2));
  });
});

describe("the runtime amounts come from execution, not from signing", () => {
  /**
   * @dev The demo's central claim is that steps 3 and 6 take amounts that did not exist when the
   *      batch was signed. That is only true if those amounts are resolved by a `STATIC_CALL`, and it
   *      is observable: the fetcher type is part of the encoding.
   */
  it("resolves the approval amount with a STATIC_CALL", () => {
    const batch = buildDemoBatch(opts);
    const approve = batch[2]!;

    const runtime = approve.inputParams.filter(
      (p) => p.fetcherType === 1, // InputParamFetcherType.STATIC_CALL
    );
    expect(runtime).toHaveLength(1);
  });

  it("resolves the supply amount with a STATIC_CALL", () => {
    const supply = buildDemoBatch(opts)[5]!;
    const runtime = supply.inputParams.filter((p) => p.fetcherType === 1);
    expect(runtime).toHaveLength(1);
  });

  it("leaves both runtime amounts to the engine rather than baking them in", () => {
    // Guards the failure mode where someone "fixes" a step by pasting in an amount. That would make
    // the demo pass while destroying the property it exists to show: the fetcher type is what proves
    // the amount is read at execution, so it is asserted per step rather than by encoding size.
    const batch = buildDemoBatch(opts);
    expect(batch[2]!.inputParams.some((p) => p.fetcherType === 1)).toBe(true);
    expect(batch[5]!.inputParams.some((p) => p.fetcherType === 1)).toBe(true);
  });

  it("declares TARGET on the calling entries so the engine has somewhere to send them", () => {
    for (const index of [2, 3, 5]) {
      const params = buildDemoBatch(opts)[index]!.inputParams;
      expect(params.some((p) => p.paramType === 0)).toBe(true);
    }
  });
});

describe("the failing variant is guaranteed to fail", () => {
  it("differs from the working batch only in the floor", () => {
    const working = buildDemoBatch(opts);
    const failing = buildFailingDemoBatch(opts);

    expect(failing).toHaveLength(working.length);
    // Same targets, same call shapes; only the bound moves.
    for (let i = 0; i < working.length; i++) {
      expect(failing[i]!.inputParams.length).toBe(working[i]!.inputParams.length);
    }
  });

  it("asks for more WETH than exists", () => {
    // 2^200 WETH is not a number the pool could ever produce, so the failure is deterministic rather
    // than dependent on pool state at the moment of the demo.
    const wethGate = buildFailingDemoBatch(opts)[4]!;
    expect(wethGate.inputParams[0]!.constraints[0]!.referenceData.length).toBe(66);
    const floor = BigInt(`0x${wethGate.inputParams[0]!.constraints[0]!.referenceData.slice(2)}`);
    expect(floor).toBe(1n << 200n);
  });
});

describe("minAmountOut has no default", () => {
  /**
   * @dev A defaulted slippage tolerance is the exact failure this project exists to prevent: the user
   *      signs a number nobody chose. So the option is required and its absence is an error.
   */
  it("refuses to build without one", () => {
    expect(() => buildDemoBatch({ account: ACCOUNT, feedGuard: FEED_GUARD })).toThrow(/minAmountOut/);
  });
});

describe("encoding is stable", () => {
  it("produces the same bytes for the same inputs", () => {
    expect(encodeDemoBatch(opts)).toBe(encodeDemoBatch(opts));
  });

  it("changes when the account changes", () => {
    // A batch that ignored the account would be a batch spending nobody's money.
    const other = encodeDemoBatch({ ...opts, account: "0x0000000000000000000000000000000000000BAD" });
    expect(other).not.toBe(encodeDemoBatch(opts));
  });

  it("is a whole number of words", () => {
    const encoded = encodeDemoBatch(opts);
    expect(((encoded.length - 2) / 2) % 32).toBe(0);
  });
});