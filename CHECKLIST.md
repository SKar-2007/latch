---
title: Checklist
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md
---

# Checklist

Tracks document status, phase gates, and readiness. All files ship as `draft`. Promotion to
`reviewed` requires the owning gate to pass.

## Implementation status

| Item | State |
|---|---|
| `forge build` | Clean |
| `forge test` | **137 passing, 0 failing** with an RPC endpoint. **106 passing, 2 skipped** offline |
| `contracts/FeedGuard.sol` | 1,950 B runtime. 33 unit tests, 6 invariants |
| `contracts/QuoterGuard.sol` | 1,492 B runtime. 24 unit tests, 4 invariants |
| `contracts/FailSafeExecutor.sol` | 6,478 B runtime. 33 integration tests, 3 invariants |
| `contracts/mocks/` | `MockOracle`, `MockQuoter`, `RevertingAggregator` |
| `script/Deploy.s.sol` | Base Sepolia, with pre-flight assertions |
| Gas snapshot | `.gas-snapshot` committed, 116 entries |
| Layer C invariant suite | **Done.** 13 invariants, 9,216 calls, 0 reverts, across `FeedGuard`, `FailSafeExecutor`, `QuoterGuard` |
| Layer C property tests | **Done.** `SlotDerivation.t.sol`, 10 tests, covering the original storage collision |
| Fork fuzzing against the live engine | **Done.** `test/fork/EncodingFuzz.t.sol`, 18 tests at block `47_590_000` |
| Layer D live smoke tests | **Done.** `test/smoke/LiveSmoke.t.sol`, 13 tests on Base Sepolia |
| V-06, DEX addresses | **Closed.** SwapRouter02 and factory cross-consistent, WETH/USDC pools have liquidity at all three fee tiers |
| V-07, lending addresses | **Closed.** Aave V3 Pool live, provider agrees. WETH is a market; **USDC is not**, so the supply step must use WETH |
| V-23, Base Sepolia "QuoterV2" | **Open.** The documented address does not implement `IQuoterV2`, so `QuoterGuard` cannot read live liquidity yet |
| V-01, MEE deployment version | **Closed.** `2.2.x` deployment against a Nexus `1.3.1` account |

### Three design decisions the tests forced

| Decision | Why |
|---|---|
| `FailSafeExecutor` holds **no storage** | Under `delegatecall` its storage is the account's. A `bytes32[]` at slot 0 read the account's `entryPoint` as its length, so `delete` tried to zero ~2^64 words and reverted with no data. Found by tests, invisible to inspection |
| It is a **delegatecall target**, not an installed ERC-7579 module | Same root cause. A per-account `entryPoints` registry written by `onInstall` is read from a different slot on the next `delegatecall`, so it cannot work and was removed |
| `QuoterGuard` slippage maths is **overflow-safe** | Fuzzing found `quote * (10_000 - bps)` overflows for a large quote. Replaced with an exact decomposition on the known denominator |

## Document status

### P0 — Foundations

| File | Status | Gate | Notes |
|---|---|---|---|
| `README.md` | draft | P0 | Conventions, naming, reading paths |
| `CHECKLIST.md` | draft | P0 | This file |
| `appendix/sources.md` | draft | P0 | 30 sources, all with retrieval dates |
| `appendix/verification-log.md` | draft | P0 | 11 open items, 10 confirmed |
| `appendix/glossary.md` | draft | P0 | Vocabulary locked |
| `appendix/design-tokens.md` | draft | P0 | Extracted from source deck |

### P1 — Truth layer

| File | Status | Gate | Notes |
|---|---|---|---|
| `technical-reference/composability-data-types.md` | draft | P1 | Verbatim, MIT |
| `technical-reference/composable-execution-lib.md` | draft | P1 | Verbatim, MIT |
| `technical-reference/composable-execution-module.md` | draft | P1 | Verbatim, MIT |
| `technical-reference/nexus-execution-helper.md` | draft | P1 | Verbatim, excerpts |
| `02-erc8211-spec-notes.md` | draft | P1 | Encoding, error catalogue, footguns |

### P2 — Architecture

| File | Status | Gate | Notes |
|---|---|---|---|
| `01-system-architecture.md` | draft | P2 | Trust boundaries, sequences |
| `03-module-integration.md` | draft | P2 | Four integration shapes, namespaces |
| `04-constraints-and-oracles.md` | draft | P2 | `FeedGuard`, `QuoterGuard` |
| `05-failure-semantics.md` | draft | P2 | `FailSafeExecutor` |
| `13-composition-patterns.md` | draft | P2 | Six canonical flows |
| `adr/0003-storage-namespace.md` | draft | P2 | Call flow, not delegatecall |
| `adr/0004-oracle-freshness.md` | draft | P2 | Helper view plus `EQ 1` |

### P3 — Build-facing

| File | Status | Gate | Notes |
|---|---|---|---|
| `06-frontend-blueprint.md` | draft | P3 | Signing, decoder, UI states |
| `07-relayer-and-keepers.md` | draft | P3 | Submission and retry |
| `08-security-model.md` | draft | P3 | Threat table |
| `09-testing-strategy.md` | draft | P3 | Layers A to D |
| `10-deployment-runbook.md` | draft | P3 | Base Sepolia |
| `12-risk-matrix.md` | draft | P3 | Risk register |

### P4 — Narrative

| File | Status | Gate | Notes |
|---|---|---|---|
| `00-deck-analysis.md` | draft | P4 | Corrections register |
| `11-demo-script.md` | draft | P4 | Live narrative |
| `adr/0001-atomicity.md` | draft | P4 | |
| `adr/0002-fail-safe-executor.md` | draft | P4 | |
| `adr/0005-account-mode.md` | draft | P4 | ERC-7702 primary |
| `BLUEPRINT.md` | draft | P4 | Master document |

## Gate criteria

| Gate | Passes when |
|---|---|
| P0 | Every file has front matter. Every document is reachable from `README.md`. Zero orphans. Glossary has no duplicate terms. Design tokens match the extracted XML values |
| P1 | Every enum member and struct field matches upstream byte for byte. Error catalogue count matches the union of `processInput`, `_checkConstraint` and output-path errors. Every footgun cites a source line |
| P2 | Each of `FeedGuard`, `QuoterGuard` and `FailSafeExecutor` states mechanism, byte encoding, invariant, failure mode and test hook. Every design claim cites a spec section |
| P3 | Every runbook step names a command and an expected observable. Every threat row has a mitigation that is implemented rather than aspirational. Test matrix covers all constraint types |
| P4 | A reader who sees only `BLUEPRINT.md` can answer any question in the pitch and cannot find a claim that fails under one probing question. Corrections register is complete and each entry has the corrected encoding |

## Verification register status

Round 1 completed 2026-10-02 against three independent Base Sepolia providers. Seventeen items tracked
in [verification-log.md](docs/appendix/verification-log.md).

| Status | IDs |
|---|---|
| **Cleared** | V-02, V-03, V-04, V-05, V-14, V-16, V-18, V-19, V-20 |
| **Blocks deployment** | V-01 (MEE path only; any bundler works around it) |
| **Blocks the demo** | V-06, V-07 |
| **Blocks production claims** | V-10, V-11, V-17 |

### Round 1 outcomes worth acting on

| Finding | Action |
|---|---|
| Module and storage confirmed deployed, identity reproduced on chain | None. Pre-flight commands retained for re-checking |
| SDK is `@biconomy/smart-batching` 0.1.0, **one published version** | Pin it. There is no upgrade path to lean on |
| SDK omits `SKIP` and `IN_SIGNED`; one constraint means word 0 | Corrected pattern 2 and the `FeedGuard` interface. `answerIfFresh` replaces `priceIfFresh` |
| Feed decimals are 8, not 9 | Corrected in the feed table. Read `decimals()` on chain |
| Stablecoin feeds 3 to 21 hours stale | `maxStaleness` must follow the published heartbeat |
| **Nexus `EXECTYPE_TRY` is present in deployed bytecode** | **Cleared.** The earlier revert was `supportsExecutionMode`, which is absent from these builds |
| **Correct Nexus is `1.3.1` at `0x…9D2`, with native `executeComposable`** | **Skip module installation entirely.** Simpler and better-authorised path |
| **Biconomy's documented singleton is `1.2.0` with no composability** | Assert `accountId()` before shipping any configuration |

## Demo readiness

| Item | State | Depends on |
|---|---|---|
| Nexus account on Base Sepolia with composability module installed | not started | V-02, V-03, V-04 |
| `MockOracle` deployed with UI-driven setters | not started | — |
| `FeedGuard` deployed and `isFresh` returning a single word | not started | — |
| `QuoterGuard` deployed | not started | V-06 |
| Happy-path batch, six entries, one signature | not started | — |
| Deterministic revert demo, oracle moved out of band | not started | — |
| ERC-7702 delegation demonstrated | not started | V-04 |
| MEEScan or Basescan link captured for the recording | not started | — |

## Submission readiness

| Item | State |
|---|---|
| Deck corrected per `00-deck-analysis.md` revised copy | not started |
| Rajdhani legibility fix applied | not started |
| Every deck claim reconciled against `BLUEPRINT.md` | not started |
| Verification register drained to zero open blockers | not started |
| Architecture diagram exported from `01` | not started |
| Demo rehearsed end to end at least three times | not started |

## Open items for the team

1. ~~Run the `EXECTYPE_TRY` functional test.~~ **Done, and unnecessary.** Bytecode answered it
   without funding an account. See [verification-log.md](docs/appendix/verification-log.md).
2. Working directory is still `paradox`. Rename to `latch`? Default is to leave it. Nothing in these
   documents depends on the directory name.
3. Source deck filename is `Declarative Smart Batching Executor (1).pptx`. Rename to `LATCH.pptx`?
   Cosmetic.
4. Submission framing section mapping docs to judging criteria. Currently excluded from scope.
5. Owners for the open verification items are all `TBD`.