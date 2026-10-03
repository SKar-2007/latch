import { describe, expect, it } from "vitest";
import { decodeAbiParameters, encodeAbiParameters } from "viem";
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
  isPredicate,
  lte,
  lteSigned,
  or,
  selectorOf,
  skip,
  staticCall,
  target,
  validateEntry,
  value,
} from "../src/builder";
import { BuilderError, BuilderErrorCode } from "../src/errors";
import { ConstraintType, InputParamFetcherType, InputParamType, type Hex } from "../src/types";
import { MAX_ENTRIES } from "../src/constants";
import { decodeBatch } from "../src/decoder";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const ACCOUNT = "0x1111111111111111111111111111111111111111";

/** Expect a BuilderError with a specific upstream code, and return it for further assertions. */
function expectCode(fn: () => unknown, code: string): BuilderError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BuilderError);
    const err = e as BuilderError;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

describe("paramData encodings", () => {
  it("BALANCE is exactly 40 bytes, packed", () => {
    const p = balance(USDC, ACCOUNT);
    expect((p.paramData.length - 2) / 2).toBe(40);
    expect(p.paramData.slice(2, 42)).toBe(USDC.slice(2).toLowerCase());
    expect(p.paramData.slice(42, 82)).toBe(ACCOUNT.slice(2).toLowerCase());
  });

  it("BALANCE treats the zero token as native", () => {
    const p = balance("0x0000000000000000000000000000000000000000", ACCOUNT);
    expect((p.paramData.length - 2) / 2).toBe(40);
  });

  it("BALANCE rejects more than one constraint", () => {
    // One word resolves, so a second constraint would index past it and the engine would revert
    // with InsufficientRawValue. Catching it here turns an opaque execution failure into a message.
    expectCode(() => balance(USDC, ACCOUNT, [gte(1), lte(2)]), BuilderErrorCode.InvalidSetOfInputParams);
  });

  it("STATIC_CALL is abi.encode(address, bytes)", () => {
    const p = staticCall(ROUTER, "0x12345678");
    const [addr, data] = decodePair(p.paramData);
    expect(addr.toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(data).toBe("0x12345678");
  });

  it("TARGET is a 32-byte word holding the address", () => {
    // Not 20 bytes. The module reads it with `abi.decode(paramData, (address))`, and Solidity's
    // decoder needs a full word. A bare 20-byte address reverts on-chain with empty return data.
    expect((target(ROUTER).paramData.length - 2) / 2).toBe(32);
    // The address occupies the low-order 20 bytes.
    expect(target(ROUTER).paramData.slice(-40).toLowerCase()).toBe(ROUTER.slice(2).toLowerCase());
  });

  it("VALUE is one 32-byte word", () => {
    expect((value(1n).paramData.length - 2) / 2).toBe(32);
  });
});

function decodePair(data: Hex): [string, Hex] {
  const [a, b] = decodeAbiParameters([{ type: "address" }, { type: "bytes" }], data);
  return [a as string, b as Hex];
}

describe("constraint referenceData", () => {
  it("word comparisons carry exactly 32 bytes", () => {
    for (const c of [eq(1), gte(1), lte(1), gteSigned(-1), lteSigned(-1)]) {
      expect((c.referenceData.length - 2) / 2).toBe(32);
    }
  });

  it("ranges carry exactly 64 bytes", () => {
    expect((inRange(1, 2).referenceData.length - 2) / 2).toBe(64);
    expect((inRangeSigned(-2, -1).referenceData.length - 2) / 2).toBe(64);
  });

  it("SKIP carries nothing", () => {
    expect(skip().referenceData).toBe("0x");
  });

  it("encodes negative numbers as two's complement", () => {
    const c = gteSigned(-1);
    expect(BigInt(c.referenceData)).toBe((1n << 256n) - 1n);
  });

  it("OR refuses an empty sub-list", () => {
    // An empty OR can never be satisfied, so encoding it would present a gate that always passes.
    expectCode(() => or([]), BuilderErrorCode.EmptyOrSubConstraints);
  });

  it("OR refuses a nested OR", () => {
    expectCode(() => or([or([gte(1)])]), BuilderErrorCode.InvalidConstraintType);
  });
});

describe("validation mirrors the engine", () => {
  it("rejects a second TARGET", () => {
    const e = entry({ functionSig: "0xdeadbeef", inputParams: [target(ROUTER), target(USDC)] });
    expectCode(() => validateEntry(e), BuilderErrorCode.InvalidSetOfInputParams);
  });

  it("rejects a second VALUE", () => {
    const e = entry({ functionSig: "0xdeadbeef", inputParams: [value(1), value(2)] });
    expectCode(() => validateEntry(e), BuilderErrorCode.InvalidSetOfInputParams);
  });

  it("rejects BALANCE as a TARGET fetcher", () => {
    const e = entry({
      functionSig: "0xdeadbeef",
      inputParams: [{ ...balance(USDC, ACCOUNT), paramType: InputParamType.TARGET }],
    });
    expectCode(() => validateEntry(e), BuilderErrorCode.InvalidParameterEncoding);
  });

  it("rejects more constraints than the value has words", () => {
    // Two words of literal data, three constraints: the third indexes past the end.
    const twoWords = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, 2n]);
    const e = entry({
      functionSig: "0xdeadbeef",
      inputParams: [callData(twoWords, [gte(1), lte(2), eq(3)])],
    });
    const err = expectCode(() => validateEntry(e), BuilderErrorCode.InvalidParameterEncoding);
    expect(err.message).toContain("InsufficientRawValue");
  });

  it("accepts exactly as many constraints as there are words", () => {
    const twoWords = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, 2n]);
    const e = entry({
      functionSig: "0xdeadbeef",
      inputParams: [callData(twoWords, [gte(1), lte(2)])],
    });
    expect(() => validateEntry(e)).not.toThrow();
  });

  it("does not guess a word count for STATIC_CALL", () => {
    // The return length is unknown until execution, so any number of constraints is structurally
    // allowed client-side. Rejecting here would be a false positive on a legitimate batch.
    const e = entry({
      functionSig: "0xdeadbeef",
      inputParams: [staticCall(ROUTER, "0x12345678", [gte(1), gte(2), gte(3)])],
    });
    expect(() => validateEntry(e)).not.toThrow();
  });

  it("rejects a malformed referenceData length", () => {
    const e = entry({
      functionSig: "0xdeadbeef",
      inputParams: [callData(encodeAbiParameters([{ type: "uint256" }], [1n]), [{ constraintType: ConstraintType.GTE, referenceData: "0x1234" }])],
    });
    expectCode(() => validateEntry(e), BuilderErrorCode.InvalidReferenceDataLength);
  });

  it("rejects an inverted range", () => {
    const e = entry({
      functionSig: "0xdeadbeef",
      inputParams: [callData(encodeAbiParameters([{ type: "uint256" }], [1n]), [inRange(10, 5)])],
    });
    const err = expectCode(() => validateEntry(e), BuilderErrorCode.InvalidConstraintRange);
    expect(err.message).toContain("never be satisfied");
  });

  it("rejects a SKIP that carries data", () => {
    const e = entry({
      functionSig: "0xdeadbeef",
      inputParams: [
        callData(encodeAbiParameters([{ type: "uint256" }], [1n]), [
          { constraintType: ConstraintType.SKIP, referenceData: `0x${"11".repeat(32)}` as Hex },
        ]),
      ],
    });
    expectCode(() => validateEntry(e), BuilderErrorCode.InvalidReferenceDataLength);
  });

  it("rejects a SKIP that is not SKIP but claims to be", () => {
    // An ordinal outside the enum must fail rather than render as a pass.
    const e = entry({
      functionSig: "0xdeadbeef",
      inputParams: [
        callData(encodeAbiParameters([{ type: "uint256" }], [1n]), [
          { constraintType: 99 as ConstraintType, referenceData: "0x" },
        ]),
      ],
    });
    expectCode(() => validateEntry(e), BuilderErrorCode.InvalidConstraintType);
  });

  it("names the offending path", () => {
    const e = entry({
      functionSig: "0xdeadbeef",
      inputParams: [target(ROUTER), target(USDC)],
    });
    const err = expectCode(() => validateEntry(e, "batch[3]"), BuilderErrorCode.InvalidSetOfInputParams);
    expect(err.path).toBe("batch[3].inputParams[1]");
  });

  it("rejects a functionSig that is not 4 bytes", () => {
    const e = entry({ functionSig: "0xdeadbe" });
    expectCode(() => validateEntry(e), BuilderErrorCode.InvalidParameterEncoding);
  });
});

describe("MAX_ENTRIES", () => {
  const one = () => entry({ functionSig: "0xdeadbeef", inputParams: [target(ROUTER)] });

  it("accepts exactly the limit", () => {
    const batch = Array.from({ length: MAX_ENTRIES }, one);
    expect(() => encodeBatch(batch)).not.toThrow();
  });

  it("rejects one entry over the limit", () => {
    const batch = Array.from({ length: MAX_ENTRIES + 1 }, one);
    const err = expectCode(() => encodeBatch(batch), BuilderErrorCode.BatchTooLarge);
    expect(err.message).toContain(String(MAX_ENTRIES));
  });

  it("can be raised deliberately", () => {
    const batch = Array.from({ length: MAX_ENTRIES + 1 }, one);
    expect(() => encodeBatch(batch, { maxEntries: MAX_ENTRIES + 1 })).not.toThrow();
  });

  it("holds for any limit, not just the default", () => {
    for (const limit of [1, 2, 5, 20]) {
      const batch = Array.from({ length: limit + 1 }, one);
      expectCode(() => encodeBatch(batch, { maxEntries: limit }), BuilderErrorCode.BatchTooLarge);
    }
  });
});

describe("batch encoding", () => {
  it("round-trips: an encoded batch decodes to the same structure", () => {
    const batch = [
      entry({
        functionSig: selectorOf("exactInputSingle(address,address,uint256,uint256,uint256)"),
        inputParams: [balance(WETH, ACCOUNT, [gte(10n ** 18n)]), target(ROUTER)],
        outputParams: [
          captureExecResult({
            returnValues: 1,
            storageContract: "0x00008211dea1Aca67ac55fc44AE3bF88CF41281d",
            storageKey: `0x${"ab".repeat(32)}` as Hex,
          }),
        ],
      }),
      entry({
        functionSig: selectorOf("balanceOf(address)"),
        inputParams: [balance(USDC, ACCOUNT, [inRange(1, 100)])],
      }),
    ];

    const encoded = encodeBatch(batch);
    expect(encoded.startsWith("0x")).toBe(true);

    const steps = decodeBatch(encoded);

    expect(steps).toHaveLength(2);
    expect(steps[0]!.functionSig).toBe(batch[0]!.functionSig);
    expect(steps[0]!.target!.toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(steps[0]!.gates).toHaveLength(1);
    expect(steps[1]!.gates).toHaveLength(1);
  });

  it("encodes an empty batch", () => {
    expect(encodeBatch([]).startsWith("0x")).toBe(true);
  });

  it("recognises a predicate as having no target", () => {
    const p = entry({ functionSig: "0xdeadbeef", inputParams: [balance(USDC, ACCOUNT, [gte(1)])] });
    const c = entry({ functionSig: "0xdeadbeef", inputParams: [target(ROUTER)] });
    expect(isPredicate(p)).toBe(true);
    expect(isPredicate(c)).toBe(false);
  });
});

describe("selectors", () => {
  it("matches a known selector", () => {
    // transfer(address,uint256) is 0xa9059cbb. If this drifts, every encoded batch is wrong.
    expect(selectorOf("transfer(address,uint256)")).toBe("0xa9059cbb");
  });

  it("is 4 bytes", () => {
    expect((selectorOf("balanceOf(address)").length - 2) / 2).toBe(4);
  });
});

describe("fetcher types are carried, not defaulted", () => {
  it("keeps BALANCE distinguishable from RAW_BYTES", () => {
    // The decoder and the engine both branch on this. Collapsing them would silently change meaning.
    expect(balance(USDC, ACCOUNT).fetcherType).toBe(InputParamFetcherType.BALANCE);
    expect(callData("0x00").fetcherType).toBe(InputParamFetcherType.RAW_BYTES);
    expect(staticCall(ROUTER, "0x00").fetcherType).toBe(InputParamFetcherType.STATIC_CALL);
  });
});