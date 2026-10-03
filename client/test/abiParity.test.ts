import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeExecutions, deriveValueSlot } from "../src/abi";
import {
  balance,
  callData,
  captureExecResult,
  entry,
  encodeBatch,
  eq,
  gte,
  inRange,
  lte,
  or,
  staticCall,
  target,
} from "../src/builder";
import { decodeBatch, decodeOrSubs } from "../src/decoder";
import { ConstraintType, type ComposableExecution } from "../src/types";

/**
 * Parity between the TypeScript encoder and Solidity's.
 *
 * @dev The client cannot use `viem` for this struct: `encodeAbiParameters` routes a nested tuple into
 *      its `bytes` encoder, whose `size()` helper returns `value.length` for a non-string, so a
 *      `ComposableExecution` is measured as a 3-byte `bytes4` and the call throws. The codec in
 *      `src/abiCodec.ts` is therefore hand-written, and a hand-written encoder tested only against
 *      itself proves nothing -- every other test in this suite encodes and decodes with the same code
 *      on both sides, so they would all agree on a wrong layout.
 *
 *      So the reference is Solidity's `abi.encode` over the real struct types, from
 *      `contracts/mocks/ParityBatch.sol`, committed to `fixtures/batch.abi.json`. Three
 *      implementations now have to agree: Solidity's encoder, this one, and the decoder.
 *
 *      The batch below is built with the public API rather than hand-assembled structs, so this test
 *      covers the code the client actually calls. An earlier version encoded the `OR` payload by hand
 *      and got it wrong, which is exactly the class of bug the fixture exists to catch -- except that
 *      here it was in the test.
 */
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const STORAGE = "0x00008211dea1Aca67ac55fc44AE3bF88CF41281d";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const WETH = "0x4200000000000000000000000000000000000006";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/batch.abi.json", import.meta.url)), "utf8"),
) as { encoded: `0x${string}` };

/** The batch from `ParityBatch.sol`, expressed through the client's own API. */
const parityBatch = (): ComposableExecution[] => [
  entry({
    functionSig: "0xdeadbeef",
    inputParams: [
      balance(WETH, ACCOUNT, [gte(1n)]),
      target(ROUTER),
    ],
    outputParams: [
      captureExecResult({
        returnValues: 1,
        storageContract: STORAGE,
        storageKey: `0x${"ab".padStart(64, "0")}`,
      }),
    ],
  }),
  entry({
    functionSig: "0xcafebabe",
    inputParams: [
      callData(
        `0x${"7".padStart(64, "0")}${"9".padStart(64, "0")}`,
        [eq(7n), lte(100n)],
      ),
      staticCall(USDC, `0x70a08231${ACCOUNT.slice(2).padStart(64, "0")}`, [inRange(1n, 100n), or([eq(5n), gte(3n)])]),
    ],
  }),
];

describe("ABI parity with Solidity", () => {
  /**
   * @dev The load-bearing test of the client library. If this fails, every batch the client produces
   *      is wrong, and nothing else in the suite would show it.
   */
  it("produces byte-identical output to Solidity's abi.encode", () => {
    expect(encodeBatch(parityBatch())).toBe(fixture.encoded);
  });

  it("decodes the Solidity-produced bytes back to the same batch", () => {
    const decoded = decodeExecutions(fixture.encoded);
    const original = parityBatch();

    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]!.functionSig).toBe(original[i]!.functionSig);
      expect(decoded[i]!.inputParams.length).toBe(original[i]!.inputParams.length);
      expect(decoded[i]!.outputParams.length).toBe(original[i]!.outputParams.length);

      for (let j = 0; j < original[i]!.inputParams.length; j++) {
        expect(decoded[i]!.inputParams[j]!.paramData.toLowerCase()).toBe(
          original[i]!.inputParams[j]!.paramData.toLowerCase(),
        );
        expect(decoded[i]!.inputParams[j]!.fetcherType).toBe(original[i]!.inputParams[j]!.fetcherType);
        expect(decoded[i]!.inputParams[j]!.paramType).toBe(original[i]!.inputParams[j]!.paramType);
        expect(decoded[i]!.inputParams[j]!.constraints.length).toBe(
          original[i]!.inputParams[j]!.constraints.length,
        );
      }
    }
  });

  it("re-encoding the decoded batch reproduces the fixture exactly", () => {
    // Round-trip stability alone is weak: an encoder and decoder can agree with each other and both
    // be wrong. Paired with the fixture comparison, their agreement is what makes the pair sound.
    expect(encodeBatch(decodeExecutions(fixture.encoded))).toBe(fixture.encoded);
  });

  it("preserves the OR's abi-encoded sub-constraints", () => {
    const orConstraint = decodeExecutions(fixture.encoded)[1]!.inputParams[1]!.constraints[1]!;

    expect(orConstraint.constraintType).toBe(ConstraintType.OR);

    const subs = decodeOrSubs(orConstraint.referenceData);
    expect(subs.map((sub) => sub.constraintType)).toEqual([ConstraintType.EQ, ConstraintType.GTE]);
    expect(subs.map((sub) => BigInt(sub.referenceData))).toEqual([5n, 3n]);
  });

  it("preserves the STATIC_CALL paramData, which is itself abi-encoded", () => {
    // A nested encoding inside a `bytes` field. Getting this wrong yields a batch that encodes
    // cleanly and resolves to a different call on-chain.
    expect(decodeExecutions(fixture.encoded)[1]!.inputParams[1]!.paramData.toLowerCase()).toBe(
      parityBatch()[1]!.inputParams[1]!.paramData.toLowerCase(),
    );
  });

  it("preserves the packed BALANCE paramData at exactly 40 bytes", () => {
    const p = decodeExecutions(fixture.encoded)[0]!.inputParams[0]!;
    expect((p.paramData.length - 2) / 2).toBe(40);
  });

  it("renders every gate in the fixture, each with its own operator", () => {
    const steps = decodeBatch(fixture.encoded);

    expect(steps).toHaveLength(2);

    // Entry 0: one BALANCE gate. Entry 1: EQ and LTE on literal data, then IN and OR on the
    // STATIC_CALL. Every constraint in the batch must surface, or a gate exists that the user cannot
    // see.
    expect(steps[0]!.gates.map((g) => g.verdict.kind)).toEqual(["checked"]);
    expect(steps[1]!.gates.map((g) => g.verdict.kind)).toEqual([
      "checked",
      "checked",
      "checked",
      "any-of",
    ]);

    const labels = steps[1]!.gates.map((g) => (g.verdict as { label: string }).label);
    // `GTE 100` and `LTE 100` must never render identically. Collapsing both to a tick is the mistake
    // rule 2 of the frontend blueprint exists to prevent.
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[1]).toContain("≤");
  });
});

describe("deriveValueSlot", () => {
  it("packs the index as a full word", () => {
    // keccak256(abi.encodePacked(baseSlot, uint256(index))). Packing the index as a minimal integer
    // gives a different slot, and a read using the correct derivation then silently returns zero.
    const base = `0x${"11".repeat(32)}` as const;
    expect(deriveValueSlot(base, 0)).toBe(keccak256(`${base}${"0".repeat(64)}`));
  });

  it("gives different slots to different indices", () => {
    const base = `0x${"11".repeat(32)}` as const;
    expect(deriveValueSlot(base, 0)).not.toBe(deriveValueSlot(base, 1));
  });

  it("rejects a negative index", () => {
    expect(() => deriveValueSlot(`0x${"11".repeat(32)}` as const, -1)).toThrow(RangeError);
  });
});

import { keccak256 } from "viem";