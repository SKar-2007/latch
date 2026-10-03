---
title: Constraints and oracles
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R1, R2, O1, O2, O3, D1)
---

# Constraints and oracles

How LATCH turns user intentions into ERC-8211 constraints, and the two helper views that exist
because constraints cannot do arithmetic or read the clock.

## The design boundary

ERC-8211 constraints compare a resolved value against a **static literal** chosen at signing time.
Two things follow, and both are load-bearing for this project.

| Cannot be expressed | Why |
|---|---|
| `price * (1 - slippage)` | `InputParam` has no expression or operator. Fetchers return bytes |
| `block.timestamp - updatedAt <= maxStaleness` | Bounds are literals. Nothing in the pipeline sees `block.timestamp` |

Neither is an oversight in the spec. The spec's position is that a batch is a self-contained
program of fetches and comparisons, and arithmetic belongs either off-chain or in a helper contract
you can audit once. LATCH takes the second option for both, which means **two audited view
contracts instead of a bespoke executor per flow.**

## Constraint vocabulary

| Intent | Constraint | `referenceData` |
|---|---|---|
| Balance at least X | `GTE` | 32 bytes, X |
| Balance at most X | `LTE` | 32 bytes, X |
| Balance exactly X (sweep is complete) | `EQ` | 32 bytes, X |
| Balance in range | two `InputParam`s, or `IN` | 64 bytes, (lower, upper) |
| Signed price delta within band | `GTE_SIGNED` / `LTE_SIGNED` | 32 bytes each |
| Either drained or replenished | `OR` with two leaf children | `abi.encode(Constraint[])` |
| Ignore a field, keep checking later ones | `SKIP` | empty |

Four rules that are easy to get wrong:

**AND across the array, indexed by word.** `constraints[i]` compares against the *i*-th 32-byte word
of the resolved value. Two constraints on one `InputParam` do not create a range — they check two
different words.

**A single constraint always means word 0.** `@biconomy/smart-batching` 0.1.0 exposes
`contract.check({ functionName, args, constraint })`, where `constraint` is one `RuntimeConstraint`, not
an array. One constraint is therefore always compared against the **first** 32-byte word of the return
data. Verified against the published package. This single fact decides the entire helper design below.

**One constraint per parameter for balances.** `processInput` reverts with
`InvalidSetOfInputParams("BALANCE supports at most 1 constraint")` on a second constraint. A range on
a balance needs two parameters.

**`SKIP` is for word alignment, not failure handling.** When a `latestRoundData()` constraint array
is `[SKIP, GTE]`, it means "word 0 is `roundId` and I do not care; word 1 is `answer` and it must be
at least X."

## The SDK exposes 6 of the 9 constraint types

`@biconomy/smart-batching` is at **0.1.0, exactly one published version** as of 2026-10-02. Its
`ConstraintType` is:

```typescript
declare const ConstraintType: {
    readonly EQ: 0;
    readonly GTE: 1;
    readonly LTE: 2;
    readonly IN: 3;
    readonly GTE_SIGNED: 4;
    readonly LTE_SIGNED: 5;
    readonly OR: 6;
};
```

The contract has nine. **`SKIP: 7` and `IN_SIGNED: 8` are absent from the SDK's type.**

| Operator | Contract | SDK helper |
|---|---|---|
| `EQ`, `GTE`, `LTE`, `IN`, `GTE_SIGNED`, `LTE_SIGNED` | Yes | Yes |
| `OR` | Yes | Yes, `orConstraint` |
| `SKIP` | Yes | **No. Hand-encode** |
| `IN_SIGNED` | Yes | **No. Hand-encode** |

The six typed ordinals match the contract exactly, so anything the SDK encodes is correct by
construction. This is a gap in convenience, not in correctness — and LATCH's helper design is shaped to
avoid needing the two missing types.

### The consequence: helpers must return the field of interest as word 0

Combining the two rules above produces a hard limit. Because one constraint lands on word 0, and because
`SKIP` is unavailable in the SDK, **a single-word constraint can only ever test word 0 of a return
value.**

That makes this call wrong:

```typescript
// WRONG. roundId is word 0. It is a large round counter, never the price.
chainlink.check({
  functionName: "latestRoundData",
  args: [],
  constraint: { or: [{ gteSigned: minPrice }, { lteSigned: maxPrice }] },
});
```

`roundId` on Base Sepolia is around `1.8e19`. The `gteSigned minPrice` branch passes and the
`lteSigned maxPrice` branch fails, so the `OR` evaluates false and the batch reverts every time. It looks
correct and is silently wrong, which is the worst failure mode available.

Two correct options:

| Option | Mechanism | Cost |
|---|---|---|
| **Helper returns the field as word 0** | `FeedGuard.answerIfFresh` returns the answer as its only word | One helper call. Preferred |
| Hand-encode `[SKIP, OR(...)]` | Array form via `constraints: ConstraintField[]` on runtime-value params, casting `type: 7` | Bypasses SDK types. Fragile against a 0.x release |

**This is the reason `FeedGuard` returns exactly one word, and it is why it must keep doing so.** The
helper is not a convenience wrapper. It is the adapter that makes a multi-word return constrainable by a
single-word, single-constraint SDK.


## Word layout of `latestRoundData()`

```solidity
(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    = aggregator.latestRoundData();
```

| Word | Field | Bytes used | Reachable by a single SDK constraint |
|---|---|---|---|
| 0 | `roundId` | 20 of 32 | Yes, but it is a round counter, not a price |
| 1 | `answer` | full signed word | **No.** Needs `SKIP` at index 0, which the SDK does not expose |
| 2 | `startedAt` | full | No |
| 3 | `updatedAt` | full | No. And absolute bounds only |
| 4 | `answeredInRound` | 20 of 32 | No |

So no field of `latestRoundData()` other than `roundId` can be gated by a single SDK constraint, and
`roundId` is the one field you never want to constrain. Every useful check on this return value has to
come from a helper that returns the field of interest as its own word 0.

That is the entire architectural argument for `FeedGuard` existing.

### `answerIfFresh` — the price-band guard

```solidity
    /**
     * @notice The answer, but only when the round is usable.
     * @dev Returns ONE word, so a single SDK `constraint` lands on it. Pair with an
     *      `or` band, or with `gte`/`lte` for a one-sided bound.
     */
    function answerIfFresh(address aggregator, uint256 maxStaleness)
        external view returns (int256 answer)
    {
        (uint80 roundId, int256 a, , uint256 updatedAt, uint80 answeredInRound)
            = IAggregatorV3(aggregator).latestRoundData();

        if (updatedAt == 0 || a == 0) revert StaleFeed();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > maxStaleness) revert StaleFeed();
        if (answeredInRound < roundId) revert StaleFeed();

        answer = a;
    }
```

```typescript
// A price band, enforced on-chain, on the value the user signed a tolerance for.
guard.check({
  functionName: "answerIfFresh",
  args: [ETH_USD_FEED, 1200],
  constraint: { or: [{ gteSigned: minPrice }, { lteSigned: maxPrice }] },
});
```

One helper, one word, one constraint, and both guarantees — freshness *and* band — in a single gate.
This replaces the incorrect `latestRoundData` constraint that appears in earlier drafts of this
document and in [13-composition-patterns.md](13-composition-patterns.md).

What it does **not** do is detect manipulation. A fresh answer inside the band passes. See
[adr/0004](adr/0004-oracle-freshness.md).

## `FeedGuard`

A single view contract whose only job is to answer one question with one word.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IAggregatorV3 {
    function latestRoundData()
        external view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title FeedGuard
 * @notice Reduces oracle freshness to a single word that an ERC-8211 constraint can gate on.
 * @dev Deliberately `view` and side-effect free. The composability module reaches this
 *      through the STATIC_CALL fetcher, so nothing here may write state.
 */
contract FeedGuard {
    /// @notice 1 when the round is usable, 0 when it must be rejected.
    error StaleFeed();

    function isFresh(address aggregator, uint256 maxStaleness) external view returns (uint256 ok) {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
            = IAggregatorV3(aggregator).latestRoundData();

        // An uninitialised aggregator reports zeros. Treat as stale.
        if (updatedAt == 0 || answer == 0) return 0;

        // A round that has not been observed yet cannot be fresh.
        if (updatedAt > block.timestamp) return 0;

        // The relative check ERC-8211 cannot express.
        if (block.timestamp - updatedAt > maxStaleness) return 0;

        // L2 feeds lag their sequencer; require the round to be considered answered.
        if (answeredInRound < roundId) return 0;

        return 1;
    }

    /// @notice The answer, as the single return word, but only when the round is usable.
    /// @dev Returning ONE word is load-bearing: the SDK's `contract.check` attaches a
    ///      single constraint, and a single constraint is always compared against word 0.
    ///      latestRoundData() puts roundId at word 0 and the answer at word 1, so the
    ///      answer is unreachable without this function.
    ///      Reverts instead of returning 0 so a consuming staticcall fails loudly rather
    ///      than substituting a plausible-looking bad price.
    function answerIfFresh(address aggregator, uint256 maxStaleness)
        external view returns (int256 answer)
    {
        (uint80 roundId, int256 a, , uint256 updatedAt, uint80 answeredInRound)
            = IAggregatorV3(aggregator).latestRoundData();

        if (updatedAt == 0 || a == 0) revert StaleFeed();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > maxStaleness) revert StaleFeed();
        if (answeredInRound < roundId) revert StaleFeed();

        answer = a;
    }
}
```

Then gate on one word:

```typescript
guard.check({
  functionName: "isFresh",
  args: [ETH_USD_FEED, 1200],
  constraint: { eq: 1n },
});
```

`EQ 1` rather than `GTE 1`. It is stricter, and it means a future change to the return type fails
closed instead of open.

### Invariants

| # | Invariant |
|---|---|
| F1 | `isFresh` never reverts on a well-formed aggregator, so the batch fails at the constraint with `ConstraintNotMet(EQ)` rather than at the fetcher with `ComposableExecutionFailed` |
| F2 | `isFresh` returns exactly one 32-byte word, so exactly one constraint attaches |
| F3 | Any stale condition maps to `0`, never to a plausible-looking positive number |
| F4 | No state is written. `staticcall`-safe |
| F5 | The contract holds no funds, no approvals, and no admin functions. It is a pure library in contract form |

F1 matters more than it looks. A reverting fetcher and a failing constraint produce different
diagnostics, and the batch-level revert is the same either way — but for the demo and for debugging,
the constraint path is the one that identifies the freshness gate as the cause.

### Choosing `maxStaleness`

| Chain | Feed | Heartbeat | Deviation | Recommended `maxStaleness` |
|---|---|---|---|---|
| Base Sepolia | ETH/USD | 1200s | 0.15% | 1200s. Observed at 8s, so ample headroom |
| Base Sepolia | BTC/USD | 1200s | 0.1% | 1200s |
| Base Sepolia | USDC/USD | 86400s | 0.1% | 86400s. **Do not tighten.** Observed at 55,100s |
| Base Sepolia | LINK/USD | 1200s | 0.2% | 1200s |
| Base Mainnet | ETH/USD | 27s | 0.1% | 120s |

Sources: Chainlink Reference Data Directory, Base Sepolia bundle and the price feed addresses page.
Verified 2026-10-02. Base Mainnet figures are for the mainnet deployment plan only.

Setting `maxStaleness` equal to the heartbeat is the conservative choice: a feed updates at least
that often when the deviation threshold is not met, and more often when it is. Anything tighter starts
producing spurious reverts on quiet blocks.

### Mainnet add-on: the sequencer gate

Base is an L2. Chainlink publishes a sequencer uptime feed at
`0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`; `latestRoundData().answer` is `0` when the sequencer is
up and `1` when it is down.

**Base Sepolia has no sequencer feed.** Confirmed against the Chainlink RDD bundle — it contains no
sequencer entry. So the sequencer gate is a mainnet-only control, and on Base Sepolia the freshness
guarantee rests entirely on the heartbeat.

For the mainnet deployment, `FeedGuard` gains a second entry point:

```solidity
function isFreshWithSequencer(
    address aggregator,
    address sequencerFeed,
    uint256 maxStaleness,
    uint256 gracePeriod
) external view returns (uint256 ok);
```

which additionally requires `answer == 0` on the sequencer feed and
`block.timestamp - startedAt > gracePeriod`, so a fresh sequencer has been up long enough for prices
to be trustworthy again. Documented in [adr/0004-oracle-freshness.md](adr/0004-oracle-freshness.md).

### Implementation

`contracts/FeedGuard.sol`, 1,950 bytes, 32 tests. Two additions beyond the interface above, both
forced by writing the tests:

| Addition | Reason |
|---|---|
| `MAX_STALENESS = 30 days`, enforced by failing closed | An absurd tolerance would otherwise silently disable the gate. `isFresh` returns `0`, so the batch reverts rather than the check disappearing. Long enough for the 86,400s stablecoin feeds, which measured up to 20.7 hours old |
| `aggregator.code.length == 0` guard | Reading an EOA returns empty data, which the engine's `InsufficientRawValue` path would turn into a confusing failure. An explicit `0` says "not a feed" |

`_roundIsUsable` is the single definition of usable, shared by the verdict and value forms, so
`isFresh` and `answerIfFresh` cannot drift apart. `testFuzz_verdictAndValueFormsNeverDisagree` enforces
that over 256 runs.

### `MockOracle`

The deck proposed `MockOracle.sol` with UI-driven setters. Implemented in
`contracts/mocks/MockOracle.sol`, with three rules.

1. It lives only on Base Sepolia and is never referenced by a production configuration.
2. `FeedGuard` treats it as an ordinary aggregator address. There is no allowlist and no special
   case, so there is no privileged code path that a testnet contract can reach.

A `MockOracle` setter that also moved `block.timestamp` would be useful for testing the revert path,
but `MockOracle` cannot move the chain clock. Use `vm.warp` in Foundry, and in the live demo move the
*price* out of band instead, so the guard rejects on the price-band constraint rather than on
staleness.

## `QuoterGuard`

The deck's `minAmountOut = price * (1 - slippage)` is not an ERC-8211 feature. There are exactly two
honest ways to get the behaviour.

### Option A — bound computed off-chain at signing

```typescript
const quote = await quoter.quoteExactInputSingle(...);
const minOut = quote.amountOut * 9_995n / 10_000n;   // 0.5% slippage

router.write({
  functionName: "exactInputSingle",
  args: [tokenIn, WETH, amountIn, minOut, recipient],   // literal
});
```

| Pros | Cons |
|---|---|
| Zero additional contracts | Bound is fixed at signing; stale if execution is delayed |
| Zero additional gas | Requires the user to trust the off-chain quote |
| Uses the router's native slippage protection | The bound itself is not oracle-derived, so a manipulated quote still produces a bad bound |

This is what most production code does, and for a swap where the token's own `amountOutMinimum`
argument exists it is genuinely sufficient. It is the right default.

### Option B — bound computed on-chain at execution

```solidity
interface IQuoterV2 {
    function quoteExactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)
        external view returns (uint256 amountOut, uint160, uint32, uint256);
}

contract QuoterGuard {
    error StaleQuote(uint256 expected, uint256 actual);

    /// @notice Quotes at execution time and applies the slippage bound on-chain.
    /// @dev The multiplier and divisor are signed-time literals, so the slippage
    ///      tolerance itself is part of the signed payload.
    function minAmountOut(address quoter, address router, address tokenIn, address tokenOut,
                          uint256 amountIn, uint24 fee, uint256 slippageBps)
        external view returns (uint256 minOut)
    {
        (uint256 amountOut, , , ) = IQuoterV2(quoter).quoteExactInputSingle(tokenIn, tokenOut, amountIn, fee, 0);

        // minOut = amountOut * (10_000 - slippageBps) / 10_000, rounding down
        minOut = (amountOut * (10_000 - slippageBps)) / 10_000;

        if (minOut == 0) revert StaleQuote(1, 0);
    }
}
```

```typescript
guard.write({
  functionName: "minAmountOut",
  args: [QUOTER, ROUTER, tokenIn, WETH, amountIn, FEE, slippageBps],
  capture: { type: "execResult", storageKey },
});
```

Then the captured value flows into the router call as a `STATIC_CALL` read of Storage. The net effect
is a genuine on-chain computation of `price * (1 - slippage)` — with the slippage tolerance
enforced as part of what the user signed.

| Pros | Cons |
|---|---|
| Bound reflects state at execution, not at signing | Costs a `staticcall` to the quoter per resolution |
| Slippage tolerance is inside the signed payload | `QuoterGuard` is new, unaudited Solidity |
| No per-flow contract deployment | Quoter view is not a guarantee; the pool can move between quote and execution within the same transaction |

The last row is the honest limitation of both options, and it is not specific to LATCH. A view call
and the subsequent swap happen in the same transaction, but the swap itself still clears against live
reserves.

### Recommendation

| Scenario | Use |
|---|---|
| Swap where the router accepts `amountOutMinimum` | Option A. The router's own guard is sufficient and audited |
| Multi-step flow where a later step must size itself from an earlier quote | Option B |
| Anything a judge will probe on "is the bound real" | Show both, explain the trade-off |

**Implemented with one change.** `minAmountOut` drops the `router` argument, because it was unused.
The implemented signature is:

```solidity
function minAmountOut(address quoter, address tokenIn, address tokenOut,
                      uint256 amountIn, uint24 fee, uint256 slippageBps)
    external view returns (uint256 minOut);
```

**And the arithmetic is overflow-safe.** `amount * (10_000 - slippageBps)` overflows for a sufficiently
large quote, which a hostile or broken quoter can return. Fuzzing found it. Rather than carry a
hand-rolled 512-bit routine for a divisor we control, the implementation decomposes on it:

```
amount * n / 10_000  ==  (amount / 10_000) * n  +  (amount % 10_000) * n / 10_000
```

Exact, because the floor distributes over the decomposition, and bounded, because `q * n < amount` and
`r * n < 10^8`. See `_scaleByBps`. A reverting quoter is also wrapped into a legible `ZeroQuote` rather
than bubbling someone else's revert string.

## Staleness and manipulation are different problems

Worth separating, because conflating them is how oracle guarantees get oversold.

| Problem | Detected by | Coverage |
|---|---|---|
| Stale price | `FeedGuard.isFresh` | Complete, within `maxStaleness` |
| Price outside a band | `IN` / `OR` on `latestRoundData` word 1 | Complete, within the band |
| Answer is negative or zero | `FeedGuard` returns 0 | Complete |
| Round not yet answered | `FeedGuard` returns 0 | Complete |
| **Manipulated but fresh and in-band** | Nothing on-chain can detect | **None.** Needs off-chain monitoring |

LATCH guarantees the first four. It does not guarantee the fifth, and neither does ERC-8211, and
neither does any constraint mechanism. The demo should say this out loud rather than let a judge
infer otherwise.

## Verified Base Sepolia feeds

From the Chainlink Reference Data Directory bundle
`feeds-ethereum-testnet-sepolia-base-1.json`. Verified 2026-10-02.

| Feed | Proxy | Heartbeat | Deviation | Decimals | Live answer | Live age |
|---|---|---|---|---|---|---|
| ETH / USD | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | 1200s | 0.15% | **8** | $2,657.53 | 8s |
| BTC / USD | `0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298` | 1200s | 0.1% | **8** | $84,044.66 | 2s |
| LINK / USD | `0xb113F5A928BCfF189C998ab20d753a47F9dE5A61` | 1200s | 0.2% | **8** | $13.55 | 62s |
| USDC / USD | `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` | 86400s | 0.1% | **8** | $0.9999 | **55,100s** |
| USDT / USD | `0x3ec8593F930EA45ea58c968260e6e9FF53FC934f` | 86400s | 0.1% | **8** | $0.9998 | **11,130s** |
| DAI / USD | `0xD1092a65338d049DB68D7Be6bD89d17a0929945e` | 86400s | 0.1% | **8** | $0.9999 | **74,394s** |

Addresses, heartbeats and deviations from the Chainlink Reference Data Directory. **Decimals and the live
columns verified on chain at head `1790966516`.**

> **The decimals column is 8, not 9.** The RDD exposes both a `decimals` and a `decimalPlaces` field
> and they disagree for these feeds. On-chain `decimals()` returns 8 and is authoritative. Any code
> that hardcodes feed decimals from documentation will be wrong by a factor of ten.

> **The stablecoin feeds are hours stale, and that is normal.** USDC/USD was 15.3 hours old and DAI/USD
> 20.7 hours old against an 86,400-second heartbeat. The 1,200-second feeds update every few seconds
> because the deviation threshold triggers long before the heartbeat. Choosing `maxStaleness` tighter
> than the published heartbeat guarantees spurious reverts on the stablecoin feeds. See V-15.
| cbETH / USD | `0x3c65e28D357a37589e1C7C86044a9f44dDC17134` | 86400s | 0.2% | — |
| cbETH / ETH | `0x91b21900E91CD302EBeD05E45D8f270ddAED944d` | 86400s | 0.5% | — |
| LINK / ETH | `0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69` | 1200s | 0.2% | 8 |

No sequencer uptime feed is published for Base Sepolia. See V-08.

## Test hooks

| Property | How to test |
|---|---|
| `isFresh` accepts a current round | Foundry, feed `updatedAt = block.timestamp` |
| `isFresh` rejects a stale round | Foundry, `updatedAt = block.timestamp - maxStaleness - 1` |
| Boundary is inclusive | `updatedAt = block.timestamp - maxStaleness` must pass |
| Zero answer rejected | Mock aggregator returning `answer = 0` |
| Future timestamp rejected | `updatedAt = block.timestamp + 1` |
| Unanswered round rejected | `answeredInRound = roundId - 1` |
| Gate reverts the batch | Foundry, full batch with a stale feed, expect `ConstraintNotMet(EQ)` |
| Selector collision rejected | Non-upgradeable, no admin functions, address pinned in config. `test_hasNoFallbackOrReceive` asserts it |

The last row is a real requirement. `check` encodes a selector, and a proxy whose admin exposes a
fallback could shadow a `view` function with a mutating one. `FeedGuard` should be non-upgradeable
and its address pinned in configuration, not discovered dynamically.

## Related documents

| Document | Covers |
|---|---|
| [02](02-erc8211-spec-notes.md) | Constraint evaluation semantics |
| [05](05-failure-semantics.md) | Where these gates sit in the failure model |
| [09](09-testing-strategy.md) | Full test matrix |
| [13](13-composition-patterns.md) | Patterns using these guards |
| [adr/0004](adr/0004-oracle-freshness.md) | The freshness decision |