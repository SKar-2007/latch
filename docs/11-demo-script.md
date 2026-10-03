---
title: Demo script
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (O2, R4)
---

# Demo script

Base Sepolia. Six steps, one signature, every value gated on-chain. Runtime target **three minutes**,
rehearsed at least three times.

The demo has one job: prove the *guarantee*, not the plumbing. Success is boring. The moment that
earns the project is a well-formed batch refusing to execute against a violated bound.

## Cast

| Role | Component |
|---|---|
| Account | Nexus on Base Sepolia, composability module installed |
| Gate | `FeedGuard` at a pinned address |
| Feed | Chainlink ETH/USD, `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`, heartbeat 1200s |
| Price driver | `MockOracle`, driven from the UI |
| Client | LATCH web app with the batch decoder |
| Relayer | Local script, or MEE |

## Beat sheet

| Beat | Minutes | What it proves |
|---|---|---|
| 1. The plan | 0:30 | The user can read what they are signing |
| 2. The signature | 0:15 | One signature for a plan with runtime values |
| 3. The success | 0:30 | Values resolved on-chain, gates passed, six entries executed |
| 4. The failure | 1:00 | A violated bound reverts the whole batch, with nothing committed |
| 5. The freshness gate | 0:45 | A stale or out-of-band price stops the batch before any value moves |
| 6. The honesty | 0:15 | What this does not do |

## Beat 1 — the plan, not a hex blob

Open the client with a pre-filled intent: swap USDC to WETH on a Base Sepolia pool, then supply the
WETH to a lending market, with a 0.5% minimum output and a freshness bound of 1200 seconds.

Point at the rendered plan:

```
 1  [assert]  FeedGuard.isFresh(ETH/USD, 1200) == 1
 2  [assert]  USDC.balanceOf(account) >= 15.00
 3  [call]    USDC.approve(router, <live balance>)
 4  [call]    router.exactInputSingle(USDC -> WETH, 15.00, <min out>, account)
 5  [assert]  WETH.balanceOf(account) >= <min out>
 6  [call]    pool.supply(WETH, <live balance>, account, 0)
```

Say: *"Steps 3 and 6 take amounts that did not exist when this was signed. Step 1 is the freshness
gate. Steps 2 and 5 are the constraints. If any of them fails, nothing in this list executes."*

The `<live balance>` markers are the point. Read them aloud — a literal amount would have been a guess.

## Beat 2 — one signature

Sign. Show the single signature request.

Say: *"One signature. The swap output, the approval amount, and the deposit amount are all unknown
until execution, and none of them required a second signature."*

Do not dwell here. The interesting part is what happens next.

## Beat 3 — success

Submit. Show the receipt and decode it live: six entries, each with the resolved value and each gate's
verdict.

Say: *"Step 3 approved the exact balance. Step 4 produced more than the floor. Step 5 confirmed it. Step
6 deposited the full amount, down to the last wei, with no dust left behind."*

Have the decoded receipt open on a second screen if presenting. The demonstration that the gates ran
is worth more than the demonstration that the swap worked.

## Beat 4 — the failure

This is the beat the project lives or dies on.

Reopen the client. Same intent. **Raise the minimum output to 200% of the quote.** Everything else is
identical.

Submit. It reverts.

Then, before saying anything, show the state diff: the account's WETH balance is unchanged, the
USDC approval is gone, no deposit position exists. Nothing moved.

Say: *"The batch was well-formed. Every target and every constraint was exactly what we signed thirty
seconds ago. It still refused to execute, because the swap would have produced less than the floor the
user signed for. Not the transaction that failed — the whole batch. There is no partial outcome to
clean up."*

If a judge asks about the approval in step 3: it reverted with the batch. ERC-8211 runs every entry
inside one call frame.

If a judge asks "why not just skip the failed step": that is the question beat 6 and
[05-failure-semantics.md](05-failure-semantics.md) answer. Do not improvise it here.

## Beat 5 — the freshness gate

Two sub-beats, and the second is optional if time is short.

**5a, out-of-band price.** Use the `MockOracle` control to push ETH/USD outside the signed band. The
band is enforced through `FeedGuard.answerIfFresh`, which returns the answer as a single word so the
`OR` band applies to the price rather than to `roundId`. It fails before any movement. Show the same
full revert.

**5b, stale feed.** Set `maxStaleness` to 1 second. The `FeedGuard` gate fails, and the revert reason
names freshness rather than price.

Say for 5b: *"This is the part ERC-8211 cannot do on its own. A constraint compares a value against a
number chosen at signing. It cannot read the block timestamp. `FeedGuard` reduces freshness to a single
word so `EQ 1` can gate on it. That helper contract is ours."*

That sentence is the clearest statement of LATCH's contribution in the entire demo. Do not skip it.

If 5b misbehaves — the feed was updated so recently that even one second is fresh — narrate 5a instead
and move on. Do not debug live.

## Beat 6 — the honest limits

Close on this. Do not skip it.

Say: *"Three things this does not do. It does not detect oracle manipulation — a fresh price inside the
band passes every on-chain check ERC-8211 offers, and ours; that needs off-chain monitoring. It does
not park a failed batch — a failed constraint reverts, it does not wait, so a conditional batch still
needs a relayer to trigger it. And two of our three contracts are unaudited, which is why partial
failure is off by default."*

Then: *"Base Sepolia, six steps, one signature, every value gated on-chain."*

## Rehearsal

| Count | Focus |
|---|---|
| 1 | Timing. Identify every step over 4 minutes and cut |
| 2 | Failure paths. Beat 4 must be flawless — it is the important one |
| 3 | Continuity under pressure. Pre-recorded receipt as a fallback |

### Pre-demo checklist

| Item | Check |
|---|---|
| Faucet ETH on the deploying account | Balance above 0.01 |
| Demo tokens in the smart account | Balances sufficient |
| Pool liquidity | Confirmed present, or the `MockERC20` fallback pair deployed |
| `isFresh` returns 1 | Immediate pre-flight |
| Module installed and `executeComposableCall` absent from fallback selectors | Runbook step 6 |
| RPC providers responding | All three, primary pinned for writes |
| `BICONOMY_API_KEY` valid | A quote returns |
| Browser window with the explorer | Open on the right network |
| Decoded receipt from rehearsal | Open in a second tab |

## Failure modes during the demo

| Symptom | Cause | Response |
|---|---|---|
| `isFresh` returns 0 at the start | Feed genuinely older than 1200s | Wait for the heartbeat. Re-run pre-flight |
| Quote returns no route | No liquidity for the pair | Fall back to the `MockERC20` pair. Adjust the narration to "two-token swap" |
| HTTP 412 on first submission | EIP-7702 authorization not yet on chain | Sign it, wait for inclusion, retry. Narrate it as the expected first-time flow |
| MEE quote fails | API key or version | Fall back to direct UserOp submission. The batch is unaffected |
| Base Sepolia RPC rate limit | Provider throttling | Move to the pinned secondary provider for writes |
| Beat 4 does not revert | Bounds are wrong in the pre-filled intent | Rehearse beat 4 alone until it does. Do not present a batch that succeeds when it should fail |
| Explorer page slow | Public explorer | Narrate from the local decoded receipt |

The one that must not happen is beat 4 succeeding. If the setup is unverified five minutes before the
demo, cut beats 5b and 6 to protect beat 4.

## What a judge is most likely to ask

Prepare answers. These are the questions the deck's overclaims invite, and answering them well is worth
more than any additional slide.

**"Isn't this just ERC-8211?"**
The batch encoding is ERC-8211 and we do not claim it. What we built is four things: a helper that makes
oracle freshness expressible as a predicate, which the spec cannot do; a helper that computes a runtime
slippage bound, which the spec cannot do; a segment executor that adds opt-in partial failure without
modifying the audited engine; and a decoder so users can audit what they sign.

**"How do you apply a constraint to one field of a Chainlink return?"**
We do not, and that is deliberate. A single SDK constraint always lands on the first 32-byte word of a
return value, and `latestRoundData()` puts `roundId` there rather than the price. So `FeedGuard` returns
exactly the field we want as its own single word. That constraint is what makes the helper necessary
rather than merely convenient.

**"How do you know the Nexus account supports try-mode execution?"**
We do not yet, and it is on our register as a blocker. The source says it should, but the build deployed
on Base Sepolia self-identifies as v1.2.0 and behaves differently. We are running a functional test
before writing any of that code. If the test fails we drop the feature rather than work around it.

**"Can a relayer steal the batch?"**
No. The UserOp signature covers `callData`. A modified batch fails validation at the EntryPoint. A
relayer can delay or withhold a submission, which costs an opportunity, not funds.

**"Why are partial failure and your guards off by default?"**
Because two of our three contracts are unaudited. Partial failure is the riskiest of them, so it ships
disabled. We would rather ship a narrower guarantee we can defend than a broader one we cannot.

**"What if the oracle is manipulated?"**
Fresh, in-band and manipulated passes every check available on-chain, including ours. That is why the
limits beat exists and why the risk matrix rates it High and accepted rather than hiding it.

**"Why Base Sepolia?"**
Because every claim we make is testable there. Chainlink feeds, the composability module, MEE and EIP-7702
are all live on it, so nothing in this demo is mocked except the price driver, and the price driver only
moves the feed the guards already read.

## Related documents

| Document | Covers |
|---|---|
| [13](13-composition-patterns.md) | The flows, with code |
| [05](05-failure-semantics.md) | Beat 4 and the partial-failure answer |
| [04](04-constraints-and-oracles.md) | Beat 5 |
| [10](10-deployment-runbook.md) | Pre-flight checks |
| [00](00-deck-analysis.md) | Slides that accompany this demo |