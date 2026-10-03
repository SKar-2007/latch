---
title: "ADR 0006: Off-chain quote derivation with on-chain bound enforcement"
status: draft
project: LATCH
last_reviewed: 2026-10-03
sources: appendix/sources.md (R1, R2, V-23, V-25)
---

# ADR 0006: Off-chain quote derivation with on-chain bound enforcement

- **Status:** proposed
- **Date:** 2026-10-03
- **Deciders:** LATCH team
- **Relates to:** [04-constraints-and-oracles.md](../04-constraints-and-oracles.md), [00-deck-analysis.md](../00-deck-analysis.md), [appendix/verification-log.md](../appendix/verification-log.md)

## Context

The original design proposed resolving dynamic slippage bounds on-chain via `QuoterGuard.minAmountOut` reaching a Uniswap `QuoterV2` or `Quoter` through the `STATIC_CALL` fetcher.

Verification item **V-25** revealed an insurmountable EVM constraint with Uniswap's architecture:
Uniswap's official `Quoter` and `QuoterV2` contracts simulate swaps by executing `IUniswapV3Pool.swap`. During execution, `swap` unconditionally emits a `Swap` event. In the EVM, executing the `LOG` opcode inside a `STATICCALL` context immediately reverts with empty return data.

Over a stateful `CALL` (or `eth_call` off-chain), Uniswap's Quoter succeeds (e.g., returning 0.095452 WETH for 15 USDC on the fee-3000 pool). But on-chain, within an ERC-8211 `STATIC_CALL` fetcher, it reverts unconditionally.

## Options considered

### Option 1 — Switch `QuoterGuard` and fetcher to stateful `CALL`
Change `QuoterGuard` from `view` to non-view and dispatch it over `CALL`.
- **Pros:** Preserves the on-chain quoter call verbatim.
- **Cons:** Critical security vulnerability. `QuoterGuard` takes the quoter address as a caller-supplied argument. Under `CALL`, an arbitrary contract chosen by the caller could execute mutating logic, transfer tokens, or re-enter during intent evaluation.
- **Verdict:** Rejected. A view safety layer must never execute untrusted mutating calls.

### Option 2 — Deploy a bespoke Uniswap Quoter without event logs
Fork and recompile Uniswap's pool or quoter logic without the `emit Swap` statement.
- **Pros:** Allows `STATICCALL` to succeed on-chain.
- **Cons:** Requires custom non-canonical infrastructure, deviates from deployed protocol invariants, and creates an unaudited mock lens that does not reflect canonical pool addresses.
- **Verdict:** Rejected.

### Option 3 — Off-chain quote via `eth_call`, on-chain enforcement via signed bounds
Derive the quote off-chain at intent construction time via `eth_call` against the deployed Uniswap `Quoter`, apply user-selected slippage (e.g., 50 bps), and encode the calculated `minAmountOut` directly into the swap calldata and the post-swap `BALANCE` predicate gate (`step 5`).
- **Pros:** 
  1. 100% EVM and Uniswap compatible without custom forks.
  2. The slippage tolerance and calculated floor are part of the signed payload.
  3. Enforced on-chain at two distinct layers: callee router enforcement (`amountOutMinimum`) and ERC-8211 module gate (`weth.balanceOf(account) >= minOut`).
  4. Zero gas overhead from intermediary view calls during on-chain execution.
- **Cons:** The quote reflects liquidity at the moment of intent signing rather than block execution.
- **Verdict:** Accepted as the canonical architecture.

## Decision

1. **Adopt Option 3 as the primary architectural model.**
   Quotes are simulated off-chain via `eth_call` against Uniswap's `Quoter`, and the derived `minAmountOut` is embedded into the signed batch payload.
2. **On-chain bound enforcement is twofold:**
   - Callee level: The swap call to `SwapRouter02` passes `amountOutMinimum = minAmountOut`.
   - Engine level: A pure predicate entry (`target == address(0)`) asserts `weth.balanceOf(account) >= minAmountOut`.
3. **Clarify the role of `QuoterGuard`:**
   - `QuoterGuard` is retained in the repository as a reference implementation and test utility.
   - It is functional for test doubles (`MockQuoter`), constant-product arithmetic views, or protocols with pure `view` quote functions.
   - It is explicitly **not** used to query live Uniswap pools on-chain via `STATICCALL`.
4. **Documentation & UI alignment:**
   All documentation, presentations, and UI copies must state that quotes are evaluated off-chain and enforced on-chain via signed bounds, avoiding claims of "reading live Uniswap liquidity via on-chain staticcall".

## Consequences

- **Safety:** Eliminates untrusted external `CALL` execution risks.
- **Truth in Advertising:** Reconciles the codebase with live EVM semantics and eliminates false claims of on-chain Uniswap quoter evaluation.
- **Test Integrity:** `test_theGuardCannotReadLiveLiquidityAndThatIsDocumented` remains an explicit, passing test documenting this EVM boundary.