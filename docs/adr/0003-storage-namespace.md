---
title: "ADR 0003: Storage namespace and dispatch flow"
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R4, R5, R12)
---

# ADR 0003: Storage namespace and dispatch flow

- **Status:** accepted
- **Date:** 2026-10-02
- **Deciders:** LATCH team
- **Relates to:** [03-module-integration.md](../03-module-integration.md), [05-failure-semantics.md](../05-failure-semantics.md)

## Context

The composability `Storage` contract derives its isolation namespace from two addresses:

```solidity
function getNamespace(address account, address caller) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(account, caller));
}
```

The `account` argument is supplied by the calling module, not by `Storage`. The `caller` argument is
`msg.sender` of the `Storage` call, which is always the module. So the effective namespace depends on
**which module entry point was used**.

| Entry point | `account` passed | Effective namespace |
|---|---|---|
| `executeComposable` via account fallback | `msg.sender` — the account | `keccak256(account, account)` |
| `executeComposableCall` | `msg.sender` — the account | `keccak256(account, account)` |
| `executeComposableDelegateCall` | `address(this)` — the account | `keccak256(account, caller-of-the-account)` |

Under `delegatecall`, `msg.sender` is preserved from the outer context. If the account was entered by
the EntryPoint, the namespace contains the EntryPoint. If it was entered by a relayer sending a plain
transaction, the namespace contains the relayer.

The consequence: **the same signed batch writes to a different slot depending on who submitted it.**

Upstream is aware and states the requirement without prescribing a choice:

> The actual storage slot used in `Storage.sol` depends on both the `account` address **and** the
> `caller` address. If `ComposableExecutionModule` is invoked via a `call` flow (as a Fallback or
> Executor module), it ends up at a different slot than when invoked via `delegatecall`. Pick one flow
> per smart account and stay consistent.

## Options considered

### Option 1 — delegatecall flow, accept caller-dependent slots

| | |
|---|---|
| Pros | No account fallback routing needed; `address(this)` semantics available |
| Cons | Namespace varies with submission method. Reads across different delivery paths break. Any tooling that assumes a stable slot is wrong |
| Rejected because | The namespace would encode who happened to submit the transaction, which makes off-chain slot computation impossible |

### Option 2 — delegatecall flow, pin the EntryPoint as caller

Force the namespace by always entering through the EntryPoint.

| | |
|---|---|
| Pros | Deterministic |
| Cons | Requires all traffic through a bundler. Breaks direct relayer submission. Contradicts the project's multi-provider RPC and relayer design |
| Rejected because | It solves a namespace problem by removing a delivery option |

### Option 3 — call flow, namespace is `keccak256(account, account)`

| | |
|---|---|
| Pros | Namespace depends only on the account address. Any delivery method, any caller, any bundler produces identical slots. Matches the Nexus test suite's own expectation |
| Cons | Requires the account fallback to route the selector to the module. Adds one hop of indirection |
| Rejected because | It is correct, and the hop is negligible |

## Decision

**Use the `call` flow. The LATCH namespace is `keccak256(account, account)`, and the base slot for a
capture is `keccak256(abi.encodePacked(baseSlot, i))` within it.**

Install the module as an executor and enable its fallback handler so `executeComposable` is reachable
from the account's fallback path. Never install `executeComposableCall` as a fallback selector — it
has no access control.

## Consequences

**Positive**

- Slots can be computed off-chain from public data alone: two addresses and a base slot. The decoder
  in the frontend, the relayer, and a watcher can all derive the same slot without simulating.
- `FailSafeExecutor`'s provenance tracking has a stable target. Poisoned-slot tracking is only
  meaningful if a slot names one specific value.
- Cross-chain and cross-relayer verification become possible, since the namespace carries no
  submission-method information.

**Negative**

- One extra external call per resolved value, since the namespace must be computed and passed to
  `readStorage`.
- If the account does not route `executeComposable` through its fallback, this choice does not apply
  and a different namespace results. Verification item V-11 tracks whether the module is registered as
  a fallback or an executor on Nexus accounts.

**Neutral**

- The delegatecall flow remains available for any future use case that genuinely needs
  `address(this)` semantics, at the cost of accepting caller-dependent slots.

## Verification

| Check | Method | Pass condition |
|---|---|---|
| Namespace is account-derived | Compare `getNamespace(account, account)` against a hardcoded expectation | Equal |
| Delivery-method independence | Submit the same batch from two distinct EOAs via the EntryPoint | Same slot written both times |
| Capture round-trip | Write via `EXEC_RESULT`, read via `STATIC_CALL` `readStorage` | Returns the captured value |
| Uninitialised read | Read a never-written slot | Reverts `SlotNotInitialized` |

```typescript
const namespace = await storageContract.read.getNamespace([account, account]);
const valueSlot = keccak256(encodePacked([baseSlot, BigInt(index)]));
const namespaced = keccak256(encodePacked([namespace, valueSlot]));
```

## Revisit trigger

Revisit if any of the following become true:

- The upstream reference implementation changes `getNamespace` to take only one argument.
- The composability module changes the `account` argument it passes under either flow.
- MEE v2.2.3 or later changes the delivery path for composable batches on Base Sepolia, which would
  make the choice moot (verification item V-01).
- Nexus changes how it routes fallback calls, making `executeComposable` unreachable through fallback.