---
title: Glossary
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md
---

# Glossary

Single vocabulary source for the whole documentation set. If two files use different words for the
same thing, this file is wrong and one of them is a defect.

## A

**Account abstraction (AA)** — the property of a smart account that separates *authorisation* from
*execution*, allowing gas sponsorship, fee tokens and modular upgrades. ERC-4337 and ERC-7579 are
the standards LATCH builds on.

**Aggregator** — a Chainlink proxy contract exposing a price feed. `latestRoundData()` returns five
32-byte words in a fixed order, which matters for constraint indexing.

**Atomic** — a batch is atomic when either every entry executes or none does. ERC-8211 is atomic;
`FailSafeExecutor` relaxes this selectively.

## C

**Call type** — the ERC-7579 mode byte describing *how* an execution is dispatched.
`0x00` single, `0x01` batch, `0xFE` static, `0xFF` delegatecall.

**Capture** — an instruction on an entry that writes a call's return value into the `Storage`
contract so a later entry can read it as a runtime value.

**Composable call** — one entry of a `ComposableExecution[]` batch.

**ComposableExecution** — the ERC-8211 struct: a `functionSig`, an array of `InputParam`, and an
array of `OutputParam`.

**Constraint** — a bound attached to a resolved parameter. `EQ`, `GTE`, `LTE`, `IN`, `GTE_SIGNED`,
`LTE_SIGNED`, `IN_SIGNED`, `OR`, `SKIP`. A failed constraint reverts the batch.

**Constraint array semantics** — the array is ANDed. `constraints[i]` is checked against the *i*-th
32-byte word of the resolved value. OR is expressed inside a single entry via `ConstraintType.OR`.

## D

**Deviation threshold** — the percentage move that triggers a Chainlink feed update on top of the
heartbeat schedule.

**Domain separator** — the EIP-712 value binding a signature to a name, version, chain and
verifying contract. Primary defence against cross-chain and cross-application replay.

**Dust** — a residual balance too small to act on. ERC-8211 eliminates it by resolving balances at
execution time rather than signing a literal amount.

## E

**EIP-712** — the structured data signing standard. In LATCH it binds the *application-level*
intent. It is not the account's authorisation mechanism — see `06`.

**EntryPoint** — the ERC-4337 singleton that verifies UserOperations and calls into smart accounts.
v0.7 is `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.

**Exec type** — the ERC-7579 mode byte describing *failure handling*. `0x00` default reverts on
failure, `0x01` try continues and reports.

**Executor module** — ERC-7579 module type `2`. Allowed to call the account's
`executeFromExecutor`.

**Execution mode** — a `bytes32` packing call type, exec type, four unused bytes, a mode selector and
a 22-byte payload.

## F

**Fallback module** — ERC-7579 module type `3`. Handles account calls whose selector the account
does not implement. `ComposableExecutionModule` registers as both executor and fallback.

**Fetcher** — the strategy by which a parameter obtains its value. `RAW_BYTES`, `STATIC_CALL`,
`BALANCE`. LATCH does not add fetchers; it adds helpers invoked *through* `STATIC_CALL`.

**Failing batch** — a batch whose execution reverts. In ERC-8211, any failed constraint produces one.

## H

**Heartbeat** — the maximum interval between Chainlink feed updates. On Base Sepolia ETH/USD it is
1200 seconds, which sets the default `maxStaleness` for `FeedGuard`.

## M

**Module lifecycle** — `installModule` / `uninstallModule` on the account, calling `onInstall` and
`onUninstall` on the module. Installation itself must be authorised by a signed
`ModuleEnableMode` message.

**MEE (Modular Execution Environment)** — Biconomy's execution layer. Handles sequencing, runtime
injection, gas abstraction and cross-chain coordination.

## N

**Namespace** — `keccak256(abi.encodePacked(account, caller))`, the isolation boundary inside the
`Storage` contract. Because it includes the caller, changing the dispatch flow changes the slot.

## O

**OR composition** — a single `ConstraintType.OR` entry whose `referenceData` decodes to a
`Constraint[]`. Children must be leaf types; nesting OR inside OR reverts.

## P

**Param type** — where a resolved value is routed. `TARGET`, `VALUE`, `CALL_DATA`. Distinct from
fetcher type; the two are orthogonal.

**Predicate entry** — a `ComposableExecution` with no `TARGET` parameter. No call is made, but
parameters are resolved and constraints validated, producing a pure boolean gate on chain state.

**Project** — LATCH. The name is a product name and is not a backronym.

## R

**Raw bytes** — the `RAW_BYTES` fetcher. Passes literal bytes through, optionally validated by
constraints checked against each 32-byte word.

**Runtime value** — a parameter placeholder resolved on-chain at execution time rather than fixed at
signing. The core primitive of ERC-8211.

## S

**Signed constraint** — `GTE_SIGNED`, `LTE_SIGNED`, `IN_SIGNED` reinterpret the value and bounds as
`int256`. Any word with the high bit set is negative. Use only when the domain is genuinely signed.

**SKIP** — a `ConstraintType` that always passes, with `referenceData` required to be empty. It
exists so a signer can ignore one 32-byte field while still validating later fields at fixed
positions. **It does not mean "skip the call".** See `05`.

**Slippage** — the tolerated difference between an expected and an actual swap output. ERC-8211 has
no arithmetic, so LATCH computes the bound either off-chain or inside `QuoterGuard`.

**Smart Batching** — the name of ERC-8211.

**Static call** — the `STATIC_CALL` fetcher. Performs a `staticcall` against any contract and
returns its raw return data, which may span multiple 32-byte words.

## T

**Trustless** — used in LATCH strictly to mean "no trusted intermediary decides whether the batch
executes". It does not mean the batch is free of risk.

## U

**UserOperation (UserOp)** — the ERC-4337 transaction-like object carrying a signature, an
init code, a call data blob and gas parameters. The delivery layer beneath ERC-8211.

## W

**Word indexing** — constraints are applied per 32-byte word of the resolved value. A five-word
`latestRoundData()` return can therefore be validated field by field, but a relational check such as
`block.timestamp - updatedAt <= maxStaleness` cannot be expressed in one constraint. That gap is
what `FeedGuard` exists to close.