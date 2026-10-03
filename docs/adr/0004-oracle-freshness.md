---
title: "ADR 0004: Oracle freshness as a single-word predicate"
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R1, R2, O1, O2, O3)
---

# ADR 0004: Oracle freshness as a single-word predicate

- **Status:** accepted
- **Date:** 2026-10-02
- **Deciders:** LATCH team
- **Relates to:** [04-constraints-and-oracles.md](../04-constraints-and-oracles.md)

## Context

The source deck claims the execution module performs "Oracle Freshness Verification: automatically
checks timestamps on-chain to reject outdated or manipulated price data", with a `maxStaleness`
constraint chip on the slide.

ERC-8211 constraints cannot do this. Two facts from the reference implementation:

**1. Constraint bounds are static literals.** `_checkConstraint` compares a resolved 32-byte word
against `c.referenceData`, which must be exactly 32 bytes for the leaf types. There is no access to
`block.timestamp`, and no way to write `block.timestamp - updatedAt <= maxStaleness`.

**2. The `updatedAt` field is addressable but not relational.** `latestRoundData()` returns five
words, and constraints are indexed by word, so `updatedAt` at word 3 can be bounded. But only
absolutely:

| Check | Expressible | Encoding |
|---|---|---|
| `updatedAt <= 1764000000` | Yes | `constraints[3] = LTE(1764000000)` |
| `updatedAt >= block.timestamp - 1200` | No | Would need a literal computed at signing, defeating the purpose |
| `block.timestamp - updatedAt <= 1200` | No | Not expressible at all |

The absolute `LTE` is the closest available approximation, and it has a specific failure: the bound is
fixed when the user signs, so it encodes the author's clock, not the chain's.

## Options considered

### Option 1 — absolute `LTE` on `updatedAt`

The theory: `updatedAt` is word 3, so a `ConstraintField[]` of `[SKIP, SKIP, SKIP, LTE(...)]` should do it.

| | |
|---|---|
| Pros | Zero new contracts |
| Cons | Two independent failures. The bound is computed off-chain at signing, so it encodes the author's clock rather than the chain's. And reaching word 3 needs `SKIP` at indices 0 to 2, which the SDK's `ConstraintType` does not expose, because a single SDK `constraint` always lands on word 0 |
| Rejected because | It does not verify freshness. It verifies that a human once had a clock — and today it does not even compile against the SDK without hand-encoding |

A correct implementation would need a second, unrelated `STATIC_CALL` to read `block.timestamp` — which
is not possible through a fetcher that returns a single view result, and still would not combine the
two values on-chain.

### Option 2 — constrain `answer` against a computed band

| | |
|---|---|
| Pros | Genuinely useful, catches gross dislocation |
| Cons | **Not achievable through the SDK as written.** `latestRoundData()` puts `roundId` at word 0 and the answer at word 1, and a single SDK constraint always lands on word 0. Reaching word 1 needs `SKIP` at index 0, which the SDK's `ConstraintType` does not include |
| Rejected as the *only* measure | Retained in principle, but only via a helper that returns the answer as its own word. See the decision |

### Option 3 — a helper view returning a single verdict word

```solidity
function isFresh(address aggregator, uint256 maxStaleness) external view returns (uint256 ok);
```

Gated with `constraint: { eq: 1n }`.

| | |
|---|---|
| Pros | Freshness becomes expressible. One audited contract serving every flow. Fails closed |
| Cons | New, unaudited Solidity. One extra `staticcall` per resolution |
| Retained | Adopted, with the unaudited component named as a project risk |

### Option 4 — extend the composability module with a new fetcher

| | |
|---|---|
| Pros | Most expressive |
| Cons | Forks audited code and upstream's encoding. Upstream has explicitly not added arithmetic or time primitives |
| Rejected because | It would make LATCH a fork rather than a layer, and it would diverge from the standard the project is built on |

## Decision

**Adopt option 3 as `FeedGuard`, combined with option 2 as a mandatory complement.**

1. `FeedGuard.isFresh(aggregator, maxStaleness)` returns one 32-byte word: `1` usable, `0` reject.
   Gate with `constraint: { eq: 1n }`. `EQ` rather than `GTE`, so a future change to the return type
   fails closed.
2. Every oracle-derived price in a LATCH batch is additionally bounded, using
   `FeedGuard.answerIfFresh`, which returns the answer as its **single** return word so that a
   one-constraint `OR` band lands on the price rather than on `roundId`. Both gates, always.
3. `maxStaleness` defaults to the feed's published heartbeat. Base Sepolia ETH/USD is 1200s, so
   `1200`.
4. `FeedGuard` is `view`, side-effect free, holds no funds or approvals, and has no admin functions.
   `MockOracle` is treated as an ordinary aggregator address — no allowlist, no special case, so no
   testnet contract can reach a privileged path.

## The sequencer question

Base is an L2, so a price is only as trustworthy as the sequencer that produced it. Chainlink publishes
an L2 sequencer uptime feed; on Base Mainnet it is `0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`,
where `answer == 0` means the sequencer is up.

**Base Sepolia publishes no sequencer feed.** Verified against the Chainlink Reference Data Directory
bundle for Base Sepolia, which contains no sequencer entry. Recorded as V-08, resolved as
`VERIFIED ABSENT`.

So the sequencer gate is a mainnet-only control:

| Deployment | Gates |
|---|---|
| Base Sepolia | `isFresh` against heartbeat |
| Base Mainnet | `isFresh` **plus** `isFreshWithSequencer(aggregator, sequencerFeed, maxStaleness, gracePeriod)`, where `answer == 0` and `block.timestamp - startedAt > gracePeriod` |

The demo must state which gates are live. Claiming sequencer safety on a testnet that has no sequencer
feed would be exactly the kind of overclaim this project is trying to avoid.

## Consequences

**Positive**

- Freshness is enforceable, auditable in one contract, and reusable across every flow.
- The failure is loud and correctly attributed: a stale feed fails at the constraint with
  `ConstraintNotMet(EQ)`, not silently at a later step.
- The batch becomes safe by default. A flow that forgets the gate is a flow that does not read an
  oracle, which is the safe direction to fail.

**Negative**

- `FeedGuard` is new, unaudited Solidity. It is the weakest link in the project and is recorded as
  such in [12-risk-matrix.md](../12-risk-matrix.md).
- Extra gas: one `staticcall` plus one comparison per gated value.
- A feed that is fresh, in-band, and manipulated still passes. No on-chain constraint mechanism
  detects that, and LATCH does not claim to. Off-chain monitoring is the only mitigation and it is out
  of scope.

**Neutral**

- `maxStaleness` is a per-call argument, so different flows can gate the same feed at different
  tolerances. That is a feature, and it also means a permissive caller can weaken the gate. The
  client must never expose it as a free-text field.

## Interface, fixed

```solidity
function isFresh(address aggregator, uint256 maxStaleness) external view returns (uint256 ok);
function isFreshWithSequencer(address aggregator, address sequencerFeed,
                              uint256 maxStaleness, uint256 gracePeriod) external view returns (uint256 ok);
function answerIfFresh(address aggregator, uint256 maxStaleness) external view returns (int256 answer);
```

`answerIfFresh` reverts rather than returning zero, so a consuming `STATIC_CALL` fails loudly instead of
substituting a plausible-looking bad price.

## Revisit trigger

Revisit if any of the following become true:

- ERC-8211 gains a time-aware or arithmetic fetcher, which would make `FeedGuard` redundant.
- Chainlink publishes a sequencer uptime feed for Base Sepolia.
- `FeedGuard` is audited, which would move it from the project's weakest component to a routine one.