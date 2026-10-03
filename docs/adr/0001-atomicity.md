---
title: "ADR 0001: Atomic execution is the default"
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R2, R4, S2)
---

# ADR 0001: Atomic execution is the default

- **Status:** accepted
- **Date:** 2026-10-02
- **Deciders:** LATCH team
- **Relates to:** [05-failure-semantics.md](../05-failure-semantics.md), [adr/0002](0002-fail-safe-executor.md)

## Context

The source deck presents configurable failure policies — `REVERT_BATCH` versus `SKIP_CALL` — as a
headline feature. In the ERC-8211 reference implementation, `REVERT_BATCH` is not a policy. It is the
only behaviour that exists.

```solidity
if (execution.target != address(0)) {
    returnData = executeExecutionFunction(execution);
} else {
    returnData = new bytes[](1);
    returnData[0] = "";
}
```

No error handling in the loop. Every entry is dispatched with `ModeLib.encodeSimpleSingle()`, which is
`EXECTYPE_DEFAULT`. A revert in any entry unwinds all of them.

`ConstraintType.SKIP` is unrelated. It is a constraint that unconditionally returns true, with a
mandatory empty payload, so a signer can ignore one 32-byte field while later fields are still checked
at fixed positions.

So we face a choice. We can present atomicity as the guarantee and be narrow, or we can ship partial
failure and be broad.

## What the choice actually costs

A multi-step DeFi flow has a failure mode that atomicity handles badly: one optional cleanup call that
reverts takes down a swap that would otherwise have succeeded.

The deck's instinct was right about the problem. Slippage tolerance, a stale conditional leg, and a
non-essential `approve` are all realistic sources of an unnecessary full revert. Users experience that
as a failed transaction.

## Options considered

### Option 1 — atomic only, drop partial failure

| | |
|---|---|
| Pros | One behaviour, fully understood. Entirely within the audited upstream surface. The strongest guarantee we can make |
| Cons | A single optional failing call costs the whole batch. Real flows hit this |
| Rejected because | It ignores a genuine usability problem, and it looks like we only read the spec rather than used it |

### Option 2 — patch the composability module to add `try`

| | |
|---|---|
| Pros | Direct implementation |
| Cons | Forks code audited three times by Pashov and Zenith. Diverges from the standard. Every upstream fix becomes a merge |
| Rejected because | Forking audited code to add a feature upstream declined to add is a poor trade and would have to be disclosed prominently |

### Option 3 — build `FailSafeExecutor` as a separate component

Drive the **unmodified** audited module through segments, choosing `EXECTYPE_TRY` where partial failure
is wanted. Nexus supports the try exec type, so this is reachable through public interfaces.

| | |
|---|---|
| Pros | No upstream fork. Partial failure becomes available without touching audited code. The unaudited surface is confined to one contract we own and can point at |
| Cons | It is new, unaudited Solidity. Segment boundaries are coarser than a single call |
| Retained | Adopted in `adr/0002`, and **off by default** |

### Option 4 — off-chain compensation

Detect a reverted batch off-chain and resubmit a corrected one.

| | |
|---|---|
| Pros | No contract changes |
| Cons | Requires a second signature for the corrected batch. Adds latency. And it contradicts the project's central claim of no re-signing |
| Rejected because | It moves the problem rather than solving it, and it undermines the pitch |

## Decision

**Atomic execution is the default and the headline claim. Partial failure is opt-in, implemented in a
separate component, and disabled in the shipped configuration.**

Concretely:

1. Every segment defaults to `REVERT_BATCH`, which is `EXECTYPE_DEFAULT` against the unmodified audited
   module.
2. `FailSafeExecutor` is deployed but not installed by default, and the client exposes `SKIP_CALL` per
   segment behind an explicit confirmation.
3. The guarantee we state is: *a batch either executes entirely or not at all, and the reason is
   on-chain and inspectable.* That is a stronger and simpler sentence than any partial-failure
   description.

## Rationale

**The default is what gets evaluated.** If partial failure is on by default, a judge assessing the
project sees unaudited Solidity in the critical path and infers the whole thing is unaudited. If it is
off by default, the demo exercises the audited upstream path and `FailSafeExecutor` reads as an
extension with a documented risk.

**Atomicity is the claim the standard makes.** ERC-8211's own framing is that assertions sit between
steps as first-class entries, so the batch behaves "as a program with embedded safety checks, not a
hopeful script." Adopting atomicity wholesale is aligning with the standard rather than extending it.

**Failure is already diagnosable.** A reverted atomic batch gives one `ConstraintNotMet` with a
constraint type. A skipped segment gives a `TryExecuteUnsuccessful` plus the provenance question of
whether later steps depended on it. The atomic path is simpler to reason about, and for a project whose
main claim is verifiability, simpler is better.

**The risk is asymmetric.** Shipping atomic-only and being wrong about granularity costs a user a failed
transaction. Shipping partial failure and getting the provenance logic wrong costs a user funds.
[08-security-model.md](../08-security-model.md) records that second case as T12, and
[12-risk-matrix.md](../12-risk-matrix.md) rates its residual risk Low *only because it is disabled*.

## Consequences

**Positive**

- The default demo exercises only audited upstream code.
- The guarantee is one sentence, and it is true.
- `FailSafeExecutor` can be deleted without changing the product's central claim.

**Negative**

- Flows with an optional failing call still revert by default. That is a real usability cost and we
  should not pretend otherwise.
- Two failure behaviours exist, which doubles the explanation burden.
- Enabling partial failure raises the residual rating of R3 from Low to High and requires withdrawing
  this ADR's decision. That is a legitimate reversal, but it must be deliberate.

**Neutral**

- The problem the deck identified — that atomicity is too blunt for some flows — is real and is now
  solved by a component rather than by a claim.
- **Verification briefly made this decision load-bearing.** A first pass suggested the deployed account
  might not support `EXECTYPE_TRY` at all (V-14), which would have made atomicity the *only* available
  behaviour rather than the conservative one. A bytecode survey disproved that: try-execution is present
  in all four deployed builds, so option 3 is available. The decision stands on its merits rather than on
  necessity, which is the better position for it to be in.

## Revisit trigger

Revisit if any of the following become true:

- `FailSafeExecutor` receives an audit. Then R3 drops and it becomes a reasonable default.
- Upstream adds try semantics to the composability module. Then `adr/0002` is superseded and the
  feature ships audited.
- User research shows atomic-only is the dominant cause of batch abandonment. That would be evidence to
  reverse this decision rather than an argument to.
- MEE gains partial-failure handling at the orchestration layer, which would make the feature
  infrastructure we no longer need.