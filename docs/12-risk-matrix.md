---
title: Risk matrix
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (D2, R4, O2)
---

# Risk matrix

Rebuilt from the source deck's sixth slide. The deck listed six risks, one of which was an orphaned
bullet marker with no text, and several mitigations that named a technique rather than a control.

What follows replaces the claims with measures that were implemented and can be tested.

## Method

| Scale | Values |
|---|---|
| Likelihood | Rare, Unlikely, Possible, Likely |
| Impact | Low, Moderate, High, Critical |
| Rating | Likelihood × impact. Critical, High, Moderate, Low |

Residual rating is what remains after the mitigation is in place. A risk whose residual rating is
unacceptable is a design change, not a monitoring task.

## Register

| # | Risk | Like. | Impact | Inherent | Mitigation | Residual | Owner |
|---|---|---|---|---|---|---|---|
| R1 | Feed goes stale between simulation and execution | Likely | High | Critical | `FeedGuard` gate as the first entry, `maxStaleness` set to the heartbeat, boundary-tested in Layer A3 | **Low** | Contracts |
| R2 | Unaudited `FeedGuard` returns a wrong verdict | Possible | Critical | High | Side-effect free, no admin functions, 100% line and branch coverage, address pinned in config | **Moderate** | Contracts |
| R3 | Unaudited `FailSafeExecutor` permits a skipped segment to corrupt a later one | Possible | High | High | Provenance derived on-chain rather than declared; **disabled by default**; Layer B adversarial tests | **Low while disabled** | Contracts |
| R4 | `executeComposableCall` installed as a fallback, exposing the account | Possible | Critical | Critical | Use `executeComposable`. Runbook step 6 verifies the installed selector set | **Low** | Deployment |
| R5 | A feed is manipulated while staying fresh and in-band | Possible | Critical | Critical | No on-chain mitigation exists. Off-chain monitoring only. Stated as an accepted limitation | **High, accepted** | Product |
| R6 | Six verification items unresolved at demo time | Likely | Moderate | High | Pre-flight block in the runbook. Demo has a no-module fallback path | **Low** | Deployment |
| R7 | MEE `2.2.3` unavailable on Base Sepolia | Likely | Low | Moderate | Pin `2.2.2`. Simulation and direct UserOp paths do not depend on MEE | **Low** | Contracts |
| R8 | Base Sepolia DEX lacks liquidity for the demo pair | Likely | Moderate | High | Confirm before rehearsing. Fall back to `MockERC20` transfer pair and adjust the slide copy | **Low** | Demo |
| R9 | Upstream enum reordering changes encoding meaning | Unlikely | Critical | High | Pin the release. Diff `ComposabilityDataTypes.sol` on every upgrade. Tracked as V-10 | **Low** | Contracts |
| R10 | RPC rate limits during the live demo | Possible | Moderate | Moderate | Three providers. Reads fan out, writes pin to one. No blind write retry | **Low** | Infrastructure |
| R11 | User signs a batch they cannot meaningfully review | Possible | Critical | High | Batch decoder renders every step, fetcher and constraint with its operator. `SKIP` shown as unchecked | **Moderate** | Frontend |
| R12 | Double submission after a write timeout | Possible | Moderate | Moderate | Hash computed locally pre-broadcast; receipt and mempool checked before retry | **Low** | Relayer |
| R13 | Demo depends on live market conditions | Likely | Moderate | High | `MockOracle` drives the price from the UI. Rehearse the failure path deliberately | **Low** | Demo |
| R14 | Rajdhani at 13.5 pt is illegible on a projector | Likely | Low | Moderate | Rebuild slide copy at 15 pt minimum, body font swapped, per design tokens | **Low** | Deck |
| R15 | Slide 4 step blocks misaligned, slide 6 orphan bullet | Certain | Low | Low | Corrected in [00-deck-analysis.md](00-deck-analysis.md) revised copy | **Negligible** | Deck |
| R16 | Deployed Nexus does not honour `EXECTYPE_TRY` | Possible | High | High | **RESOLVED.** Bytecode survey confirms the try-execution event topics and `executeFromExecutor` in all four builds. Correct target is `biconomy.nexus.1.3.1` at `0x…9D2` | **Negligible** | Contracts |

## The three that matter

### R16 — try-mode, and why it nearly took the project with it

Worth recording as a process failure rather than a technical one.

`FailSafeExecutor` rests on the account permitting try-mode execution. The `main` branch says it does, at
`Nexus.sol:425`. A view call against the deployed Base Sepolia singleton said otherwise, reverting for
every mode, and the contract self-identified as `v1.2.0` rather than a version with composability. On
that evidence the project's headline component looked unbuildable.

The view call was the wrong instrument. `supportsExecutionMode` exists in `main` and in **none** of the
four deployed dispatchers, so it reverted as an unknown selector. The bytecode survey then showed the
actual situation: every build carries `TryExecuteUnsuccessful`, `TryDelegateCallUnsuccessful` and
`executeFromExecutor`. Try-mode works. And the correct target is `biconomy.nexus.1.3.1` at
`0x0000000020fe2F30453074aD916eDeB653eC7E9D`, which additionally has `executeComposable` natively.

Two lessons, both now enforced in the runbook:

| Lesson | Enforcement |
|---|---|
| Verify the deployed build, not `main` | Survey bytecode selectors and event topics before trusting a source-derived claim |
| The documented address may be the wrong build | Assert `accountId()` matches the expected version before shipping a configuration |

### R5 — manipulated, fresh, in-band

The only High residual rating, and it is accepted rather than mitigated.

`FeedGuard` proves freshness. `answerIfFresh` returns the answer as a single word so an `OR` band can be
applied to the price itself, which proves it sits inside a band. Neither proves the price is *true*. A manipulation that lands inside the band, on a
fresh round, passes every check available to LATCH — and to ERC-8211, and to any constraint mechanism.

What can be done, and is not: off-chain anomaly detection on the feed, tighter bands from historical
volatility rather than a fixed value, per-protocol manipulation-resistant oracles, and monitoring with
a pause switch. All are operational, none is on-chain, and none is in scope for this project.

The correct handling is disclosure. A judge who finds this stated in the deck is more impressed than
one who finds it stated in a risk register, and a team that hides it will be asked about it live.

### R2 — unaudited `FeedGuard`

Upstream has been audited three times. LATCH adds two contracts that have not been audited at all, and
`FeedGuard` sits in the path of every gate.

Mitigations that actually reduce the risk: the contract is small enough to read in full; it is
side-effect free so it cannot be misused to hold state; it has no admin functions so there is no
upgrade path to exploit; 100% line and branch coverage is achievable and required; and the address is
pinned in configuration so no network response can substitute a different implementation.

None of that is an audit. The residual rating stays Moderate and the project should say so.

### R3 — unaudited `FailSafeExecutor`

The highest-severity component and the one most likely to be over-claimed, because the deck presents
partial failure as a headline feature.

Its precondition is now verified: the try-execution path is present in the deployed bytecode. Two things
keep it at Low residual:

1. It is **disabled by default**. The default configuration is `REVERT_BATCH` on every segment, so the
   audited upstream path is what the demo exercises.
2. Its provenance tracking is **derived on-chain from the batch itself**, not accepted from the client.
   A client cannot declare a segment as independent of a slot it actually reads.

If the team wants to ship partial failure as the default, R3's residual rating rises to High and the
claim in `adr/0001` has to be withdrawn. That is a legitimate choice; it just has to be a deliberate
one.

## Claims that were downgraded

The deck asserted these as properties. Each is a real limitation, recorded so nobody re-claims it.

| Deck claim | Actual status |
|---|---|
| "SKIP_CALL allows multi-call batches to skip invalid steps" | Not available in the audited module. Available through `FailSafeExecutor`, off by default, unaudited |
| "Runtime formula evaluation: `minAmountOut = price * (1 - slippage)`" | No arithmetic in ERC-8211. Delivered via `QuoterGuard`, an unaudited helper |
| "Automatically checks timestamps on-chain to reject outdated or manipulated price data" | Freshness via `FeedGuard`. Manipulation detection does not exist |
| "Eliminates reliance on centralized keepers by enforcing trustless constraints" | True for constraints. A keeper is still needed to *trigger* conditional batches |
| "Zero extra signatures" | True for parameter adaptation. The 7702 authorization and module installation each need their own signature |
| "Gas overhead minimised by eliminating redundant SLOADs" | The module does read `entryPoints[msg.sender]` once, short-circuited. Not a gas claim that survives measurement |

## Review cadence

| When | Review |
|---|---|
| Before every demo | R6, R8, R13 |
| Before any upgrade of a pinned dependency | R9, and re-read the verification log |
| Before any mainnet deployment | R1, R2, R3, R5, R16, and audit all three of our contracts |
| **Before writing `FailSafeExecutor`** | **R16. A view call is not sufficient evidence** |
| After any incident | The risk that allowed it, plus its neighbours |

## Related documents

| Document | Covers |
|---|---|
| [08](08-security-model.md) | Full threat table |
| [04](04-constraints-and-oracles.md) | `FeedGuard` invariants behind R1 |
| [05](05-failure-semantics.md) | `FailSafeExecutor` limitations behind R3 |
| [12](12-risk-matrix.md) | This file |
| [00](00-deck-analysis.md) | Which slide copy changed as a result |