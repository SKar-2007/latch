---
title: Relayer and keepers
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (D3, D5, S4, S7)
---

# Relayer and keepers

Off-chain execution. A relayer can delay, reorder or withhold a batch; it cannot alter one. That
property is what makes delegation safe, and this document is about keeping it true.

## What a relayer may and may not do

| May | May not |
|---|---|
| Submit the exact signed batch | Modify any target, value, fetcher or constraint |
| Choose when to submit | Submit a batch the account did not sign |
| Withhold submission | Partial-submit a batch, entry by entry |
| Re-simulate before submitting | Sign on the user's behalf |
| Abandon and retry after a stale quote | Alter the UserOp's `callData` |

Nothing here requires trusting the relayer. A relayer that violates any row on the right produces a
transaction the EntryPoint and the Nexus validator reject.

## Submission paths

| Path | Latency | Sponsorship | Cross-chain | Use |
|---|---|---|---|---|
| MEE quote and execute | Seconds | Optional | Yes | **Primary.** Simulates, waits on constraints, retries |
| Bundler UserOp | ~1 block | Via paymaster | No | Self-hosted control |
| Direct `eth_sendRawTransaction` from a funded EOA | Immediate | No | No | Debugging only |

MEE is preferred because it already implements the loop this document describes. Its orchestrator
simulates, waits when a constraint is not yet satisfied, and retries — see the conditional-execution
and cleanup-transaction documentation.

## The simulate-submit-retry loop

A constraint can legitimately fail today and pass tomorrow. Pattern 3 in
[13-composition-patterns.md](13-composition-patterns.md) is a conditional trigger that will only
succeed once a price band is crossed. Without a retry loop it is a batch that reverts forever.

```typescript
interface SubmitPolicy {
  maxAttempts: number;
  backoffMs: number;
  jitterMs: number;
  deadlineMs: number;      // absolute expiry. Never retry past it
  reSimulateEachAttempt: boolean;
}

const DEFAULTS: SubmitPolicy = {
  maxAttempts: 12,
  backoffMs: 15_000,
  jitterMs: 5_000,
  deadlineMs: 30 * 60_000,
  reSimulateEachAttempt: true,
};

async function submitWhenSatisfied(calls: ComposableCall[], policy = DEFAULTS) {
  const started = Date.now();

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    if (Date.now() - started > policy.deadlineMs) return { status: "expired" };

    // 1. Simulate against the current head.
    const sim = await client.simulateCalls({ calls, account: scaAddress });
    if (sim.success) return await broadcast(calls);

    // 2. Distinguish "not yet" from "never".
    const reason = decodeRevert(sim.error);
    if (!isTransient(reason)) return { status: "failed", reason };

    // 3. Wait. Jitter avoids synchronised retries across relayers.
    const wait = policy.backoffMs + Math.random() * policy.jitterMs;
    await sleep(wait);
  }
  return { status: "gave_up" };
}
```

### Classifying reverts

| Revert | Transient | Action |
|---|---|---|
| `ConstraintNotMet(EQ)` from `FeedGuard` | **No** | A stale feed is stale. Retry only after the heartbeat elapses |
| `ConstraintNotMet(GTE)` on output balance | **Maybe** | Price-dependent. Retry with a bounded deadline |
| `ComposableExecutionFailed` | Depends | Decode which fetcher failed. A reverting quoter is not transient |
| `InvalidParameterEncoding` | **No** | Encoder bug. Never retry |
| `InsufficientRawValue` | **No** | Encoder bug |
| Insufficient token balance | **Maybe** | The funding leg has not landed. Retry if cross-chain |
| Deadline exceeded | **No** | Abandon |

Retrying a permanent failure is how a relayer burns API quota and produces an alarming log. The
`isTransient` table is a whitelist, not a blacklist: unknown reverts are treated as permanent.

### Re-simulation before every attempt

State changes between attempts. A batch that simulated successfully may now fail, and one that failed
may now succeed. Re-simulating each attempt is the only way the retry loop is meaningful, and it costs
one `eth_call`.

## Idempotency and the double-submit hazard

This is the one place where the "relayer cannot cause harm" property genuinely breaks, and it is a
client bug rather than an adversarial one.

```typescript
// WRONG — a timeout is indistinguishable from a failure, and the tx may already be in the mempool.
async function submit(calls: ComposableCall[]) {
  return client.sendTransaction({ ... });   // throws on timeout
}

// RIGHT — check before retrying.
async function submitIdempotent(signed: Hex, knownHash: Hash) {
  const receipt = await client.getTransactionReceipt({ hash: knownHash });
  if (receipt) return { status: "already_mined", receipt };

  const pending = await client.getTransaction({ hash: knownHash });
  if (pending) return { status: "in_mempool", hash: knownHash };

  return client.sendRawTransaction({ serializedTransaction: signed });
}
```

Rules:

1. Compute the transaction hash locally from the signed payload before broadcasting.
2. On any error, check that hash for a receipt and for mempool presence before retrying.
3. Never rebuild a batch to "try again". Resubmitting a *different* batch with the same UserOp intent
   is a new transaction and a new signature.

A relayer replaying a previously submitted batch is harmless in itself — the account's nonce has moved,
so the UserOp fails validation. But a relayer replaying across accounts, or a client double-clicking,
produces two transactions of which one reverts. The user pays for both.

## RPC fallback, again, correctly

The frontend uses fallback for read convenience. A relayer cannot, because writes must not fan out.

| Operation | Fallback allowed | Reason |
|---|---|---|
| `eth_call` simulation | Yes | Read-only |
| Chain ID, block number | Yes | Read-only |
| `eth_getTransactionReceipt` | Yes | Read-only |
| `eth_sendRawTransaction` | **No** | May broadcast twice |
| `eth_sendUserOperation` | **No** | Same, plus bundler-side dedup assumptions |

Pin one write-capable provider per operation. Fail loudly on a write timeout rather than trying the
next one.

## Keeper

The deck names "keeper script compatibility" for "uninterrupted automated batch execution". A keeper
is the off-chain half of a conditional batch: it watches a condition and submits when it holds.

```typescript
interface KeeperJob {
  id: string;
  chainId: number;
  account: Address;
  batchHash: Hex;              // the exact batch, pinned at registration
  watch: WatchSpec;            // what to observe
  policy: SubmitPolicy;
}

// A keeper must never construct a batch. It submits a pinned one.
interface WatchSpec {
  kind: "oraclePriceBand" | "balanceGte" | "storageSlotSet" | "nonce";
  feed?: Address;
  word?: number;               // which word of the watched return value
  lower?: bigint;
  upper?: bigint;
  token?: Address;
  holder?: Address;
  threshold?: bigint;
}
```

Two design constraints:

**The keeper watches; it does not decide.** A keeper that assembles a batch from a live quote becomes
an execution policy, and its operator becomes a trusted party — exactly what ERC-8211 exists to
eliminate. The keeper observes and submits. Constraints still decide.

**Every job is a pinned batch plus a deadline.** A keeper job with no deadline is a standing order to
move funds whenever a condition happens to hold, which is indistinguishable from an unlimited
allowance. `policy.deadlineMs` is mandatory.

## Observability

| Metric | Why |
|---|---|
| `attempts` per submission | A batch that never succeeds is a broken encoding, not bad luck |
| `revert_reason` histogram | Surfaces the permanent/transient boundary working |
| `simulation_gas` vs `receipt_gas` | Divergence means state changed between simulate and mine |
| `time_to_first_attempt` | Distinguishes slow configuration from slow conditions |
| `stale_read_events` | Any time a feed read returned an older `updatedAt` than expected |

Gas comparison is the most useful of these. If simulation predicts 180k and the receipt shows 400k,
something is not being captured or a fetcher is reading different state.

## Failure handling summary

| Failure | Detection | Response |
|---|---|---|
| Constraint fails permanently | Revert classification | Surface to user, do not retry |
| Constraint fails transiently | Classification | Retry with jitter until the deadline |
| Write timeout after broadcast | Local hash check | Poll, never blind-retry |
| Provider rate limit | HTTP 429 | Backoff on the pinned write provider only |
| Keeper offline | Watchdog alert | Conditions unobserved, batches untriggered. Monitor |
| Feed stale | `FeedGuard` returns 0 | Batch reverts by design. Feed freshness is a feature |

## Related documents

| Document | Covers |
|---|---|
| [01](01-system-architecture.md) | Where the relayer sits |
| [05](05-failure-semantics.md) | What a failed segment means |
| [06](06-frontend-blueprint.md) | Client-side submission |
| [08](08-security-model.md) | Relayer threat rows |
| [13](13-composition-patterns.md) | Pattern 3, the conditional trigger |