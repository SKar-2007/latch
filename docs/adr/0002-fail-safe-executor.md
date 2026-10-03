---
title: "ADR 0002: Segment, do not patch"
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R4, R7, R9, R12)
---

# ADR 0002: Segment, do not patch

- **Status:** accepted
- **Date:** 2026-10-02
- **Deciders:** LATCH team
- **Relates to:** [05-failure-semantics.md](../05-failure-semantics.md), [adr/0001](0001-atomicity.md), [08-security-model.md](../08-security-model.md)

## Context

[adr/0001](0001-atomicity.md) establishes atomic execution as the default. This ADR decides how
`SKIP_CALL` is made available at all, given that the audited module does not offer it.

Three facts frame the space, all verified 2026-10-02.

**The module has no try path.** `ComposableExecutionModule._executeExecutionCall` always uses
`ModeLib.encodeSimpleSingle()`.

**The account allows one.** On the `main` branch:

```solidity
// Nexus.sol:425
return (callType == CALLTYPE_SINGLE || callType == CALLTYPE_BATCH || callType == CALLTYPE_DELEGATECALL)
    && (execType == EXECTYPE_DEFAULT || execType == EXECTYPE_TRY);
```

**The account reports caught failures.**

```solidity
event TryExecuteUnsuccessful(bytes callData, bytes result);
```

So the capability is one layer below the module. Anything that can call
`executeFromExecutor` with a try mode can use it — including an executor module we write.

## Options considered

### Option 1 — fork the composability module

Add a per-entry policy parameter and a `try` around the inner call.

| | |
|---|---|
| Pros | Finest granularity, per entry. Simplest control flow |
| Cons | Forks code audited by Pashov and Zenith. Diverges from the standard the project is built on. Every upstream fix becomes a merge conflict. The fork becomes the audited-surface story |
| Rejected because | It makes the project a fork rather than a layer, which is the opposite of the pitch |

### Option 2 — deploy a second composable module

Maintain our own implementation with try semantics, and let the user choose at install time.

| | |
|---|---|
| Pros | No upstream change |
| Cons | Two engines to keep correct, and users must choose between them. Doubles the audit surface rather than confining it. Namespace behaviour would differ between engines for the same account |
| Rejected because | It multiplies the thing we are trying to minimise |

### Option 3 — wrap, at entry granularity

Our own module reimplements the loop with a per-entry `try`.

| | |
|---|---|
| Pros | Fine granularity |
| Cons | Reimplements fetcher resolution, constraint evaluation and output capture. That is the entire audited logic, re-expressed by us and therefore unaudited, with a second `Storage` namespace path |
| Rejected because | The blast radius of unaudited code is the whole engine rather than the orchestration |

### Option 4 — wrap, at segment granularity

Our module splits the batch into contiguous runs and drives the **unmodified** audited module through
each, choosing the exec type per segment.

| | |
|---|---|
| Pros | The audited engine is untouched and does all resolution, validation and capture. Our code only decides grouping, mode selection and poisoning. Small surface, narrow responsibilities |
| Cons | Coarser than per entry. A segment is all-or-nothing, so a mixed segment reverts entirely |
| Retained | Adopted |

## Decision

**`FailSafeExecutor` wraps the unmodified module at segment granularity, and is off by default.**

Structure:

```solidity
enum FailurePolicy { REVERT_BATCH, SKIP_CALL }

struct Segment {
    ComposableExecution[] executions;
    FailurePolicy policy;
}
```

Invoked by the account as a delegatecall:

```
account.execute(
    encode(CALLTYPE_DELEGATECALL, EXECTYPE_DEFAULT, MODE_DEFAULT, payload),
    abi.encodePacked(address(failSafe), abi.encodeCall(FailSafeExecutor.executeFailSafe, (segments)))
);
```

The delegatecall is required, not incidental. The composability module dispatches through
`IERC7579Account(msg.sender).executeFromExecutor`, so it must be called *by the account*. Under
`delegatecall` the executor's outbound call originates from the account and that dispatch resolves.

**The contract holds no storage.** See [Storage](#storage-the-hard-constraint) below.

Three rules make it correct rather than merely permissive.

### Rule 1 — predicates may never be skippable

```solidity
require(_hasTarget(seg.executions[i]), PredicateNotSkippable());
```

A predicate entry is `target == address(0)`. Skipping it means skipping a safety assertion. The check
runs **on-chain**, not in the client, because the client is not in the trust boundary.

### Storage: the hard constraint

A delegatecall target executes in the account's context, so every storage slot it declares is really a
slot in the smart account.

This was found by the test suite, not by inspection. An earlier version declared
`bytes32[] _poisonedSlots` at slot 0 and cleared it with `delete _poisonedSlots` at the top of each
call. The account's slot 0 holds `entryPoint`, an address. Read as an array length that is roughly 2⁶⁴,
so `delete` attempted to zero that many words, exhausted the gas limit, and reverted with no data. Every
test that reached the entry point failed identically.

Consequences, all now enforced in code:

| Unavailable | Why |
|---|---|
| Per-account EntryPoint registry | `onInstall` writes to the executor's slot 0; the next `delegatecall` reads the account's slot 0 |
| Reentrancy guard | Same collision. Not needed: the only external call targets an immutable, deploy-time address |
| Pause flag, counters, "have I warned" flags | Same collision |
| Poison set | Moved to **memory**, which is discarded on return, which is precisely the lifetime required |

The regression tests `test_doesNotTouchAccountStorage` and
`test_survivesAnAccountWhoseSlotZeroIsANonZeroAddress` exist to stop this being reintroduced.

A consequence for the module framing: because it cannot hold registry state, `FailSafeExecutor` does
not implement `onInstall`, `onUninstall` or `isInitialized`. It is a delegatecall target, not an
installed ERC-7579 module, and `isModuleType` is retained only as informational. The account
authorises it exactly as it authorises any delegatecall, through its own `execute` — which is the same
authorisation a native `executeComposable` would use, and involves no second contract.

### Storage: the hard constraint

A delegatecall target executes in the account's context, so every storage slot it declares is really a
slot in the smart account.

This was found by the test suite, not by inspection. An earlier version declared
`bytes32[] _poisonedSlots` at slot 0 and cleared it with `delete _poisonedSlots` at the top of each
call. The account's slot 0 holds `entryPoint`, an address. Read as an array length that is roughly 2^64,
so `delete` attempted to zero that many words, exhausted the gas limit, and reverted with no data. Every
test reaching the entry point failed identically.

| Unavailable | Why |
|---|---|
| Per-account EntryPoint registry | `onInstall` writes the executor's slot 0; the next `delegatecall` reads the account's slot 0 |
| Reentrancy guard | Same collision. Not needed: the only external call targets an immutable, deploy-time address |
| Pause flag, counters, dedup flags | Same collision |
| Poison set | Moved to **memory**, discarded on return, which is precisely the lifetime required |

Two regression tests exist to prevent reintroduction:
`test_doesNotTouchAccountStorage` and `test_survivesAnAccountWhoseSlotZeroIsANonZeroAddress`.

A framing consequence: unable to hold registry state, `FailSafeExecutor` does not implement
`onInstall`, `onUninstall` or `isInitialized`. It is a delegatecall target, not an installed ERC-7579
module, and `isModuleType` survives only as informational. The account authorises it exactly as it
authorises any delegatecall, through its own `execute` — the same authorisation a native
`executeComposable` uses, and with no second contract in the trust boundary.

### Rule 2 — provenance is derived, not declared

A client that supplies `readsSlots` and `writesSlots` is asking to be trusted. The executor computes
both from the batch:

| Relationship | Derivation |
|---|---|
| Writes | Every `OutputParam` with `EXEC_RESULT` or `STATIC_CALL`, keyed by its base slot |
| Reads | Every `STATIC_CALL` `InputParam` targeting `Storage.readStorage(address,bytes32)`, with the slot decoded from the argument |

A malformed `readStorage` argument is rejected rather than treated as reading nothing. Skipping that
check would silently disable the provenance invariant.

### Rule 3 — a skipped segment poisons what it would have written

```solidity
mapping(bytes32 => bool) private _poisoned;

if (!ok) {
    for (uint256 w; w < seg.writesSlots.length; w++) _poisoned[seg.writesSlots[w]] = true;
}
```

Any later segment reading a poisoned slot reverts the whole batch. Without this, a skipped swap followed
by a deposit sized from that swap's captured output would use a stale value.

`BALANCE` fetches need no provenance tracking: they observe live state, so a skipped segment simply is
not reflected, and the next segment's balance constraint decides whether that is acceptable.

## Consequences

**Positive**

- The audited engine is never modified, so upstream fixes and audits continue to apply.
- Unaudited surface is one orchestration contract, not a re-implementation of the engine.
- Deployed but not installed by default, per `adr-0001`. Since it is a delegatecall target rather than
  an installed module, "not installed" simply means the client does not route to it.
- Storage-free, so it cannot corrupt the account it runs inside. That is a stronger safety property
  than a conventional module has.

**Negative**

- Coarser granularity. A segment mixing one critical and nine optional calls reverts entirely. The
  builder should warn on that shape.
- Gas for a skipped segment's inner call is still paid. `SKIP_CALL` saves value, not gas. The UI must
  say so.
- **No per-account EntryPoint registration.** Only `ENTRY_POINT_V07` or the account itself is
  authorised. A delegatecall target cannot hold the registry, so supporting another EntryPoint means
  changing a constant rather than registering an account. Correct trade, but a limitation.
- The poison array is bounded at `MAX_SEGMENTS * MAX_CAPTURED_VALUES` = 2,048 words. A batch that
  poisoned more would stop poisoning silently. Gas-bounding, unreachable in practice, but a cliff
  rather than a revert.

**Precondition verified.** The mechanism this ADR depends on was confirmed present in deployed bytecode
on 2026-10-02. All four Nexus builds on Base Sepolia carry the `TryExecuteUnsuccessful` and
`TryDelegateCallUnsuccessful` event topics and the `executeFromExecutor` selector. The target build is
`0x0000000020fe2F30453074aD916eDeB653eC7E9D`, `biconomy.nexus.1.3.1`. See V-14 in the
[verification log](../appendix/verification-log.md).

The ADR is now buildable rather than merely designed, and implemented. It remains unaudited, which is
the reason it ships disabled.

### What implementation changed

Two things this ADR did not anticipate, both found by tests:

1. **Storage-free, and a delegatecall target rather than a module.** Described above. This is a
   constraint of the invocation path, not a preference.
2. **The poison key had to be the derived value slot.** The engine writes return value `i` to
   `keccak256(abi.encodePacked(baseSlot, i))`, and a read looks up that same derived slot. An earlier
   draft poisoned the *base* slot, which never matches a read, so the provenance rule would have
   silently never fired. The suite caught it because the expected revert never arrived. The inline
   comment in `_deriveWrites` exists to stop that regressing.

**Residual risk.** This is our least trustworthy component and it is unaudited.
[08-security-model.md](../08-security-model.md) records it as T12;
[12-risk-matrix.md](../12-risk-matrix.md) rates it Low *only because it is disabled by default*. Enabling
it as the default raises R3 to High and reverses `adr-0001`.

## Revisit trigger

- `FailSafeExecutor` is audited. R3 drops, and it becomes a candidate default.
- Upstream adds try semantics. This ADR is superseded.
- A segment proves too coarse in practice, which is the argument for revisiting the granularity decision
  in option 1 versus option 4 — but not for forking audited code without an audit.