---
title: Composition patterns
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R1, R2, D1, O2)
---

# Composition patterns

Six flows built from the primitives, each showing which constraint and fetcher type does the work.
Patterns 1, 2, 5 and 6 are the demo candidates.

Every pattern assumes the `call` flow and namespace `keccak256(account, account)` per
[adr/0003](adr/0003-storage-namespace.md), and the `REVERT_BATCH` default per
[adr/0001](adr/0001-atomicity.md).

## Primitive summary

| Need | Mechanism |
|---|---|
| Use whatever the previous step produced | `BALANCE` fetcher |
| Assert a minimum outcome | `GTE` on a `check` |
| Assert an exact outcome | `EQ` on a `check` |
| Accept either of two outcomes | `OR` with leaf children |
| Assert a range | `IN`, or two constraints on separate parameters |
| Chain a return value into a later step | `EXEC_RESULT` or `STATIC_CALL` capture into `Storage` |
| Gate on oracle freshness | `FeedGuard.isFresh` with `EQ 1` |
| Compute a runtime bound | `QuoterGuard.minAmountOut` via `STATIC_CALL` |

## Pattern 1 — swap then supply, with a minimum-output gate

The canonical flow. Step 2 cannot know its amount at signing, so it reads the live balance.

```typescript
const batch = createComposableBatch(publicClient, scaAddress);
const weth  = batch.erc20Token(WETH);
const usdc  = batch.erc20Token(USDC);
const router = batch.contract(ROUTER, UNISWAP_V3_ABI);
const pool   = batch.contract(AAVE_POOL, AAVE_V3_ABI);

const minOut = /* computed off-chain from a quote, 0.5% slippage */;

batch.add([
  // 1. Guard: the account holds enough to sell.
  usdc.check({
    functionName: "balanceOf",
    args: [scaAddress],
    constraint: { gte: amountIn },
  }),

  // 2. Approve the router for the full balance — no re-signing, resolved at execution.
  usdc.write({
    functionName: "approve",
    args: [ROUTER, usdc.runtimeBalance({ constraint: { gte: amountIn } })],
  }),

  // 3. Swap, minimum output fixed at signing time.
  router.write({
    functionName: "exactInputSingle",
    args: [USDC, WETH, amountIn, minOut, scaAddress],
  }),

  // 4. Assert the swap met its floor. This is the slippage guard.
  weth.check({
    functionName: "balanceOf",
    args: [scaAddress],
    constraint: { gte: minOut },
  }),

  // 5. Supply whatever the swap produced. Down to the last wei.
  weth.write({
    functionName: "approve",
    args: [AAVE_POOL, weth.runtimeBalance()],
  }),
  pool.write({
    functionName: "supply",
    args: [WETH, weth.runtimeBalance(), scaAddress, 0],
  }),
]);
```

Why step 4 is not redundant with step 3: `amountOutMinimum` is enforced by the router and would revert
the whole swap. Step 4 exists because the batch continues past the swap, so it must independently
confirm the balance before committing it to a lending market. The two together mean a bad trade never
becomes a position.

**Failure demo:** rebuild with `minOut` set 20% above the quote. Step 4 fails, the entire batch reverts,
no approval persists, no WETH is deposited. Note that step 2's approval also rolls back.

## Pattern 2 — MEV-protected swap

Two guarantees on the oracle: freshness, and a price band. Both come from `FeedGuard`, because
`latestRoundData()` cannot be constrained where it matters — see
[04](04-constraints-and-oracles.md#the-sdk-exposes-6-of-the-9-constraint-types).

```typescript
const guard = batch.contract(FEED_GUARD, FEED_GUARD_ABI);

batch.add([
  // 1. Freshness. The helper returns one word, so `EQ 1` lands on it.
  guard.check({
    functionName: "isFresh",
    args: [ETH_USD_FEED, 1200],
    constraint: { eq: 1n },
  }),

  // 2. Price band. The helper returns the answer as its single word, so the OR
  //    is applied to the price itself rather than to roundId.
  guard.check({
    functionName: "answerIfFresh",
    args: [ETH_USD_FEED, 1200],
    constraint: { or: [{ gteSigned: minPrice }, { lteSigned: maxPrice }] },
  }),

  // 3. Now swap.
  router.write({
    functionName: "exactInputSingle",
    args: [WETH, USDC, amountIn, minOut, scaAddress],
  }),
]);
```

`OR` is what expresses "inside the band". A single `IN` would need a signed range via `IN_SIGNED`, which
the SDK does not expose, and `OR` with two 32-byte signed leaves renders more legibly in the client's
decoder.

### The version of this pattern that does not work

```typescript
// WRONG. roundId is word 0 of latestRoundData(), so this compares a ~1.8e19 round
// counter against a price band. The gteSigned branch always passes, lteSigned always
// fails, the OR is false, and the batch reverts on every execution.
chainlink.check({
  functionName: "latestRoundData",
  args: [],
  constraint: { or: [{ gteSigned: minPrice }, { lteSigned: maxPrice }] },
});
```

Reaching word 1 would require `SKIP` at index 0. `SKIP: 7` is real in the contract but absent from the
SDK's `ConstraintType`, so it has to be hand-encoded through `constraints: ConstraintField[]` with a
cast. `answerIfFresh` avoids all of that and additionally bundles the freshness check into the same
call.

**What this does not stop:** a sandwich attack that keeps the reported price inside the band while
extracting value from the trade itself. The band bounds price dislocation, not extractable value. The
project says so in [08](08-security-model.md) and the demo says so out loud.

## Pattern 3 — stop-loss or take-profit, in one predicate

One batch that executes only when either threshold is crossed.

```typescript
const weth = batch.erc20Token(WETH);
const usdc = batch.erc20Token(USDC);
const orConstraint = {
  or: [
    { lte: stopLossThreshold },    // price collapsed below the floor
    { gte: takeProfitThreshold },  // price ran past the ceiling
  ],
};

batch.add([
  chainlink.check({
    functionName: "latestRoundData",
    args: [],
    constraint: orConstraint,
  }),
  // Only reached if one of the two branches passed.
  weth.write({ functionName: "approve", args: [UNISWAP_ROUTER, weth.runtimeBalance()] }),
  router.write({
    functionName: "exactInputSingle",
    args: [WETH, USDC, weth.runtimeBalance(), minOut, recipient],
  }),
]);
```

One `OR`, not two batches. The user signs once and the condition is evaluated at execution, so the
trigger does not require a second signature or an off-chain watcher that has to be running.

**Why this is not a limit order:** a failed constraint reverts the batch, it does not park it. A limit
order needs someone to resubmit when the price crosses. What this pattern gives is *conditional
execution within a signed plan*, which is a different and smaller guarantee, and the client must label
it that way.

The relayer in [07](07-relayer-and-keepers.md) is what closes the gap: it polls the condition and
submits when it becomes true. That combination is a limit order, and the two halves are separate
components.

## Pattern 4 — dustless sweep

```typescript
batch.add([
  usdc.check({
    functionName: "balanceOf",
    args: [scaAddress],
    constraint: { gte: parseUnits("1", 6) },
  }),
  usdc.write({
    functionName: "transfer",
    args: [recipient, usdc.runtimeBalance()],
  }),
  usdc.check({
    functionName: "balanceOf",
    args: [recipient],
    constraint: { gte: parseUnits("1", 6) },
  }),
]);
```

The original motivation for runtime resolution. A literal amount leaves dust when gas costs differ from
the estimate; `runtimeBalance()` cannot.

Note `usdc.runtimeBalance()` carries **one** constraint by construction. When a bound is needed, the
SDK attaches it to the runtime value and the pre-`check` handles the floor:

```typescript
usdc.runtimeBalance({ constraint: { gte: parseUnits("5", 6) } })
```

## Pattern 5 — capture a return value and reuse it

Balance fetches handle balances. Captures handle everything else.

```typescript
const storage = batch.storage();
const storageKey = await storage.getStorageKey();
const vault = batch.contract(VAULT, ERC4626_ABI);
const namespace = await storageContract.read.getNamespace([scaAddress, scaAddress]);

batch.add([
  // 1. Deposit; capture the shares minted.
  vault.write({
    functionName: "deposit",
    args: [usdc.runtimeBalance(), scaAddress],
    capture: { type: "execResult", storageKey },
  }),

  // 2. Assert the captured value, reading Storage directly.
  await storage.check({ storageKey, constraint: { gte: parseUnits("1", 18) } }),

  // 3. Use the captured share count as an argument.
  vault.write({
    functionName: "redeem",
    args: [await storage.runtimeValue({ storageKey }), scaAddress, owner],
  }),
]);
```

Under the hood, step 3 is a `STATIC_CALL` fetcher against `Storage.readStorage(namespace, slot)`:

```solidity
paramData = abi.encode(
    storageContract,
    abi.encodeCall(Storage.readStorage, (namespace, keccak256(abi.encodePacked(baseSlot, uint256(0)))))
)
```

Only static ABI types can be captured. A `bytes` or `string` return is unsupported by both the engine
and the SDK.

For "what is my position worth right now" rather than "what did the last call return", prefer a
`staticCall` capture, which runs after the write:

```typescript
capture: { type: "staticCall", abi: VAULT_ABI, functionName: "totalAssets",
           targetAddress: VAULT, args: [], storageKey }
```

## Pattern 6 — cross-chain predicate gating

The pattern the standard is designed for, and the one worth demonstrating if time allows.

The destination batch waits for bridged funds to arrive. It does not care which bridge delivers them,
which is what makes it interoperable across native bridges, Across, ERC-7683 or any messenger.

```
Base                                        Ethereum
────                                         ───────
approve(WETH, morphoVault, bal)
morphoVault.withdraw(bal, self, self)
assert BALANCE(USDC, self) >= 4_800e6
approve(USDC, router, bal)
router.exactInputSingle(USDC -> WETH, bal)
assert BALANCE(WETH, self) >= 2e18
approve(WETH, bridge, bal)
bridge.send(WETH, ethereum, bal)  ──────>    predicate: BALANCE(WETH, self) >= 2e18
                                          aave.supply(WETH, BALANCE(WETH, self), self)
```

Constraints observe state, not mechanism. The predicate clears when the balance appears, regardless of
who delivered it.

**Scope note.** This requires MEE cross-chain orchestration and is out of scope for a single-network
demo on Base Sepolia. It is documented because it is the clearest illustration of what the storage
context buys, and because the relayer's simulate-and-retry loop in [07](07-relayer-and-keepers.md) is
the same mechanism restricted to one chain.

## Composition rules worth internalising

| Rule | Consequence |
|---|---|
| Constraints are ANDed and word-indexed | Two constraints on one parameter check two words, not a range |
| `BALANCE` takes at most one constraint | Ranges need separate parameters |
| `TARGET` accepts only `RAW_BYTES` | A call target is never a runtime value |
| A predicate entry resolves fetches but makes no call | Put assertions where they gate the *next* entry, not where they merely observe |
| `Storage` reads survive across entries and transactions | This is the only channel for non-balance dependencies |
| Nothing sees `block.timestamp` | Route every time-dependent check through `FeedGuard` |

## Related documents

| Document | Covers |
|---|---|
| [02](02-erc8211-spec-notes.md) | Semantics behind each rule |
| [04](04-constraints-and-oracles.md) | `FeedGuard`, `QuoterGuard` |
| [13](13-composition-patterns.md) | This file |
| [11](11-demo-script.md) | Which patterns the demo runs, and in what order |