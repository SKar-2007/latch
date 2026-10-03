import {
  balance,
  callData,
  captureExecResult,
  entry,
  eq,
  gte,
  selectorOf,
  staticCall,
  target,
  type CaptureSpec,
} from "./builder";
import { encodeExecutions } from "./abi";
import type { ComposableExecution, Hex } from "./types";

/**
 * The demo batch from docs/11-demo-script.md, built rather than described.
 *
 * @dev The script lists six steps in prose. This is those six steps as encodable batches, which is a
 *      stronger claim: prose cannot be wrong about ABI layout, and this can.
 *
 *      It also settles a question the prose leaves open. Steps 3, 4 and 6 each need an amount that
 *      does not exist at signing time, and the encoding has to say where each one comes from:
 *
 *        3. approve     the amount is the USDC balance, resolved by a STATIC_CALL at execution
 *        4. swap        amountIn is a signed literal; amountOutMin is a signed literal
 *        6. supply      the amount is the WETH balance, resolved by a STATIC_CALL at execution
 *
 *      Step 4's minimum output is a literal rather than a `QuoterGuard` call, and that is a
 *      consequence, not a shortcut. V-23 records that the Base Sepolia address labelled `QuoterV2`
 *      does not implement the interface `QuoterGuard` calls, so the guard cannot read live liquidity
 *      on this chain yet. Computing the bound on-chain is the better design and docs/04 sets out why;
 *      until the quoter exists, a literal computed off-chain at signing time is the honest
 *      alternative, and the tolerance itself is still part of what the user signed.
 *
 *      One subtlety the encoding forces, which is worth stating because it is easy to get wrong: a
 *      `TARGET` param is decoded into the call's target and is *not* appended to the calldata. So
 *      `approve(address,uint256)` cannot be written as "TARGET then a RAW_BYTES address", because the
 *      address would never reach the calldata and the composed call would be `approve(uint256,?)`
 *      with a 20-byte address where a 32-byte word belongs. Every address argument below is therefore
 *      an explicitly padded 32-byte word inside a `CALL_DATA` param.
 */

/** Live addresses on Base Sepolia, all verified. See docs/appendix/verification-log.md. */
export const BASE_SEPOLIA = {
  /** V-06 */
  router: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  weth: "0x4200000000000000000000000000000000000006",
  /** V-07 */
  aavePool: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
  /** K-02 */
  ethUsd: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
} as const;

export interface DemoBatchOptions {
  /** The account whose balances are read and spent. */
  readonly account: string;
  /** Where `FeedGuard` was deployed. Not a constant because the client deploys it. */
  readonly feedGuard: string;
  /** USDC to swap, in the token's 6 decimals. */
  readonly amountIn?: bigint;
  /** Minimum acceptable WETH out, in the token's 18 decimals. */
  readonly minAmountOut?: bigint;
  /** Freshness bound passed to `FeedGuard.isFresh`. */
  readonly heartbeatSeconds?: bigint;
  /** Slot for a step-4 capture, if the caller wants the swap's output in composable storage. */
  readonly swapCapture?: CaptureSpec;
}

/**
 * 15 USDC.
 *
 * Was 25. The Circle faucet grants 20 USDC to a Base Sepolia address, so a 25 USDC demo could not
 * clear its own balance gate on a single grant -- it failed at step 2 for reasons that had nothing to
 * do with the logic being demonstrated. 15 leaves headroom above the grant size and keeps the swap
 * small enough that price impact stays negligible in a shallow testnet pool, which is what you want
 * when the point of the step is the guard, not the fill.
 */
export const DEFAULT_AMOUNT_IN = 15_000_000n;
/** 1200 seconds, per the demo script. */
export const DEFAULT_HEARTBEAT = 1200n;

/** `abi.encode(address)` as a 32-byte word, since a `TARGET` param never reaches the calldata. */
const addressWord = (a: string): Hex =>
  `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as Hex;

/** `abi.encode(uint256)`. */
const uintWord = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;

/** A 32-byte zero word, as raw hex. */
const ZERO_WORD = "0".repeat(64);

/**
 * Concatenate already-prefixed ABI words into one payload.
 *
 * @dev Returns *unprefixed* bytes, because every caller appends it after a function selector. An
 *      earlier version returned a `0x`-prefixed string, so each of those call sites embedded a literal
 *      `0x` in the middle of its calldata. The batch still encoded, still validated, and still
 *      round-tripped through the client's own decoder -- every client-side test passed -- and the
 *      engine rejected it. Only executing it on a fork caught it.
 */
const pack = (...parts: readonly string[]): string => parts.join("");

/** `balanceOf(address)` calldata. */
const balanceOfCalldata = (token: string, holder: string): Hex =>
  `${selectorOf("balanceOf(address)")}${addressWord(holder).slice(2)}` as Hex;

/**
 * The six-entry batch.
 *
 * Entry order matters and is not arbitrary: each step may only read state that an earlier step has
 * already changed. Step 5's WETH gate is meaningful because step 4 has run; step 6's amount is the
 * balance step 4 produced. Reordering the batch changes what it means.
 */
export function buildDemoBatch(options: DemoBatchOptions): ComposableExecution[] {
  const {
    account,
    feedGuard,
    amountIn = DEFAULT_AMOUNT_IN,
    minAmountOut,
    heartbeatSeconds = DEFAULT_HEARTBEAT,
    swapCapture,
  } = options;

  if (minAmountOut === undefined) {
    throw new Error(
      "minAmountOut is required. It cannot be defaulted, because a default slippage tolerance is " +
        "exactly the kind of invented number this batch exists to avoid. Compute it off-chain at " +
        "signing time and pass it in.",
    );
  }

  return [
    // 1. [assert] the price feed is fresh.
    //
    //    This uses STATIC_CALL, not a literal CALL_DATA, and the distinction is the whole point of the
    //    step. A constraint on a `RAW_BYTES` param is checked against the *literal bytes* the signer
    //    supplied -- the engine never calls anything. So `callData(isFresh(...), [eq(1)])` would
    //    compare 1 against the feed's address, fail every time, and tell the user their price feed was
    //    stale when it was fine. Only a `STATIC_CALL` constraint is checked against a computed result.
    //
    //    That also makes this a true predicate: no TARGET, so nothing is called except the view.
    entry({
      functionSig: "0x00000000",
      inputParams: [
        staticCall(
          feedGuard,
          (selectorOf("isFresh(address,uint256)") +
            pack(addressWord(BASE_SEPOLIA.ethUsd).slice(2), uintWord(heartbeatSeconds).slice(2))) as Hex,
          [eq(1n)],
        ),
      ],
    }),

    // 2. [assert] the account holds enough USDC. A true predicate: no target, nothing is called.
    entry({
      functionSig: "0x00000000",
      inputParams: [balance(BASE_SEPOLIA.usdc, account, [gte(amountIn)])],
    }),

    // 3. [call] approve the router for exactly the balance, not for more.
    //
    //    The address is a padded CALL_DATA word, because a TARGET param is the call's destination and
    //    is never appended. The amount is last, resolved at execution by a STATIC_CALL, so the approval
    //    cannot exceed the balance even if the balance changes between signing and execution.
    entry({
      functionSig: selectorOf("approve(address,uint256)"),
      inputParams: [
        target(BASE_SEPOLIA.usdc),
        callData(addressWord(BASE_SEPOLIA.router).slice(2) as Hex),
        staticCall(BASE_SEPOLIA.usdc, balanceOfCalldata(BASE_SEPOLIA.usdc, account)),
      ],
    }),

    // 4. [call] swap USDC for WETH, refusing anything below the signed floor.
    entry({
      functionSig: selectorOf("exactInputSingle(address,address,uint24,uint256,uint256,uint160)"),
      inputParams: [
        target(BASE_SEPOLIA.router),
        callData(
          pack(
            addressWord(BASE_SEPOLIA.usdc).slice(2),
            addressWord(BASE_SEPOLIA.weth).slice(2),
            uintWord(3000n).slice(2),
            uintWord(amountIn).slice(2),
            uintWord(minAmountOut).slice(2),
            ZERO_WORD, // sqrtPriceLimitX96: zero means no limit
          ) as Hex,
        ),
      ],
      outputParams: swapCapture ? [captureExecResult(swapCapture)] : [],
    }),

    // 5. [assert] the swap produced at least the floor. Only meaningful because step 4 ran first.
    entry({
      functionSig: "0x00000000",
      inputParams: [balance(BASE_SEPOLIA.weth, account, [gte(minAmountOut)])],
    }),

    // 6. [call] supply the entire WETH balance to the lending market, down to the last wei.
    //
    //    `supply` takes four words. The amount comes from execution, so it sits between two literals,
    //    and the trailing referral code is a literal zero.
    entry({
      functionSig: selectorOf("supply(address,uint256,address,uint16)"),
      inputParams: [
        target(BASE_SEPOLIA.aavePool),
        callData(addressWord(BASE_SEPOLIA.weth).slice(2) as Hex),
        staticCall(BASE_SEPOLIA.weth, balanceOfCalldata(BASE_SEPOLIA.weth, account)),
        callData(pack(addressWord(account).slice(2), ZERO_WORD) as Hex),
      ],
    }),
  ].filter((e) => e.inputParams.length > 0 || e.outputParams.length > 0);
}

/** Convenience: build and encode in one step. */
export function encodeDemoBatch(options: DemoBatchOptions): Hex {
  return encodeExecutions(buildDemoBatch(options));
}

/**
 * The deterministic-failure variant, for beat 4 of the demo.
 *
 * The only change is the swap's floor: raised above anything the pool can deliver, so the batch is
 * guaranteed to fail rather than merely likely to. A demo that *usually* reverts teaches the wrong
 * lesson, because the audience cannot tell a working guard from a broken one.
 */
export function buildFailingDemoBatch(options: DemoBatchOptions): ComposableExecution[] {
  return buildDemoBatch({ ...options, minAmountOut: 1n << 200n });
}
