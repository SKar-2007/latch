---
title: Deck analysis
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (P1, R1, R2, R4, O2)
---

# Deck analysis

Analysis of `Declarative Smart Batching Executor (1).pptx`, what has to change, and drop-in
replacement copy.

Extracted by inspecting the Open XML directly: 7 slides, 13.333 x 7.5 in, every text run and shape
position read, and every colour read as a literal `srgbClr`. Authored with python-pptx, last modified
2026-09-19, 758 words, no speaker notes.

## Rename

| Element | From | To | Why |
|---|---|---|---|
| Project | PARADOX | **LATCH** | Product naming decision |
| Title | Declarative Smart Batching Executor Module | **LATCH: Predicate-Gated Execution Module** | "Declarative" is ERC-8211's own framing. Claiming it invites a standards check |
| Subtitle | ERC-8211 Execution Module for ERC-7579 Modular Smart Accounts & EIP-7702 | ERC-8211 composable execution for ERC-7579 modular smart accounts, EIP-7702 EOAs, and oracle-verified constraints | Names what we actually build |
| Team | TEAM CHICKEN ROLL | Unchanged | — |
| Track | Open Innovation | Unchanged | — |

Team attribution on the title slide becomes `TEAM CHICKEN ROLL presents LATCH`.

## Corrections register

Six claims in the deck do not survive contact with the reference implementation. Each entry states the
claim, the reality with a source, and the encoding that actually achieves the intent.

### C-1 — "Configurable Failure Policies: REVERT_BATCH vs SKIP_CALL"

**Deck, slide 5, with policy chips and the line** *"Grants users absolute control to dictate whether
failed transactions revert or skip"*, and on slide 6 *"Implemented configurable SKIP_CALL versus
REVERT_BATCH boundaries to prevent unexpected rollbacks"*.

**Reality.** Not a configuration flag. ERC-8211 is strictly atomic — the module's loop has no error
handling and every entry is dispatched with `ModeLib.encodeSimpleSingle()`, which is `EXECTYPE_DEFAULT`.
There is no code path in `ComposableExecutionModule` that requests try semantics. Separately,
`ConstraintType.SKIP` does exist but it is a *constraint* that unconditionally returns true, with a
mandatory empty payload. It exists to ignore one 32-byte field while later fields are still checked at
fixed positions. It has nothing to do with skipping a call.

Sources: `ComposableExecutionLib.sol`, `ComposableExecutionModule.sol`,
`ComposabilityDataTypes.sol`. Verified 2026-10-02.

**Correct encoding.** Partial failure is available, but it is a component we would write, not a flag we
would set. Nexus's `supportsExecutionMode` returns true for both exec types, so `FailSafeExecutor` can
drive the unmodified audited module under `EXECTYPE_TRY`, segment by segment. The two policy names become
real: `REVERT_BATCH` is `EXECTYPE_DEFAULT`, `SKIP_CALL` is `EXECTYPE_TRY`. The provenance invariant makes
it safe: if a skipped segment would have written a storage slot that a later segment reads, the whole
batch reverts.

**Deck change.** Reframe from "configurable failure policies" to "opt-in partial-failure semantics via
segment execution, off by default", and remove the policy chips from slide 5. Full design in
[05-failure-semantics.md](05-failure-semantics.md).

### C-2 — "Runtime Formula Evaluation: parameters resolve dynamically via signed formulas such as `minAmountOut = price * (1 - slippage)`"

**Deck, slide 5, with the formula rendered in a monospace chip.**

**Reality.** ERC-8211 has no arithmetic. `InputParam` has no expression, operator or formula field.
Fetchers are exactly three: `RAW_BYTES` returns literal bytes, `STATIC_CALL` returns a contract's raw
return data, `BALANCE` returns a balance. There is no way to express `price * (1 - slippage)`.

Sources: `ComposabilityDataTypes.sol`, `ComposableExecutionLib.sol`. Verified 2026-10-02.

**Correct encoding.** Two honest options.

| Option | Mechanism | Trade-off |
|---|---|---|
| A | Compute the bound off-chain at signing, encode as a literal `GTE` on the output balance | Bound is fixed at signing |
| B | `STATIC_CALL` to a `QuoterGuard.minAmountOut(quoter, router, tokenIn, tokenOut, amountIn, fee, slippageBps)` view that performs the arithmetic and returns the bound | Bound is computed at execution; the slippage tolerance is inside the signed payload |

Both are real. Option B is what actually realises the deck's formula on-chain, and it is the more
honest realisation of the stated intent. Design in
[04-constraints-and-oracles.md](04-constraints-and-oracles.md).

**Deck change.** Replace "signed formulas" with "runtime-resolved values via Chainlink and DEX quotes,
bounded by inline constraints". If the formula chip stays, label it `QuoterGuard.minAmountOut` and mark
it as our code.

### C-3 — "Oracle Freshness Verification: automatically checks timestamps on-chain to reject outdated or manipulated price data"

**Deck, slide 5, with a `maxStaleness` chip.**

**Reality.** Half right, and the wrong half is the important one. Constraints compare a resolved
32-byte word against a **static literal** chosen at signing. Nothing in the pipeline can read
`block.timestamp`. So `block.timestamp - updatedAt <= maxStaleness` is inexpressible. The `updatedAt`
field at word 3 of `latestRoundData()` can be bounded only absolutely — by a number computed off-chain
at signing, which verifies that a human once had a clock.

Source: `ComposableExecutionLib.sol`, `_checkConstraint`. Verified 2026-10-02.

**Correct encoding.** `FeedGuard.isFresh(address aggregator, uint256 maxStaleness) returns (uint256)`
returning one word, gated with `constraint: { eq: 1n }`. The relative check happens inside the helper,
where `block.timestamp` is available. `EQ` rather than `GTE` so a return-type change fails closed.

And the word **manipulated** has to go. A fresh, in-band, manipulated price passes every check LATCH can
make, and every check ERC-8211 can make. Staleness is enforceable; manipulation is not.

**Deck change.** "Reject outdated price data" becomes defensible. "Or manipulated" does not. The
`maxStaleness` chip becomes `FeedGuard.isFresh`, with the default shown as 1200s for Base Sepolia.

### C-4 — "Inline constraints: EQ, GTE, LTE, IN operators"

**Deck, slide 1 body and slide 5.**

**Reality.** Incomplete. The shipped audited set is nine: `EQ`, `GTE`, `LTE`, `IN`, `GTE_SIGNED`,
`LTE_SIGNED`, `IN_SIGNED`, `OR`, `SKIP`.

Also undocumented and easy to get wrong: the constraint array is **ANDed** and indexed by 32-byte word,
so `constraints[i]` checks word *i*. Two constraints on one parameter do not form a range. And `BALANCE`
accepts at most one constraint.

Sources: `ComposabilityDataTypes.sol`, `ComposableExecutionLib.sol`. Verified 2026-10-02.

**Correct encoding.** Use the full nine-operator list, and state the word-indexing rule once, because it
is the property that makes multi-field validation possible at all.

**Deck change.** List all nine. If space is tight, `EQ / GTE / LTE / IN` plus "and signed, OR and skip
variants".

### C-5 — "ERC-8211 Execution Module"

**Deck, title and throughout.**

**Reality.** ERC-8211 is a Standards Track **draft**, opened as ethereum/ERCs PR #1638 on 2026-02-11,
authored by Biconomy engineers with Ethereum Foundation sponsorship. It is not final. And "the ERC-8211
module" is one of four possible integration shapes: an ERC-7579 executor module, an ERC-6900 plugin, native
inheritance by an account, or an ERC-7702 delegation target.

Sources: PR #1638, erc8211.com. Verified 2026-10-02.

**Correct encoding.** Say "draft" once. Name the shape being used: "ERC-7579 executor and fallback module
inside a Nexus account", which also demonstrates you understand the integration rather than assuming
ERC-8211 ships a module.

**Deck change.** Add "draft" to the ERC-8211 mention on slide 1. This costs nothing and buys
credibility.

### C-6 — Implicit claim that the primitives work as described

**Deck, throughout.** Six encoding footguns that break a naive integration:

| Footgun | Failure |
|---|---|
| `BALANCE` `paramData` must be `abi.encodePacked`, exactly 40 bytes | ABI encoding reverts `InvalidParameterEncoding` |
| `BALANCE` accepts at most one constraint | Two constraints revert `InvalidSetOfInputParams` |
| `TARGET` rejects the `BALANCE` fetcher | Reverts `InvalidParameterEncoding` |
| `executeComposableCall` has **no** access control | Installing it as a fallback lets anyone execute against the account |
| Storage namespace is `keccak256(account, caller)` | Mixing call and delegatecall flows writes to different slots |
| Enum ordering is part of the encoding | An upstream reorder silently changes meaning |

**Deck change.** None of these belong on a slide. They belong in
[02-erc8211-spec-notes.md](02-erc8211-spec-notes.md), which is where they now are. But the fourth one
must reach the risk slide, because it is the only footgun here that is a critical vulnerability rather
than a bug.

## Layout defects

Three, all confirmed by coordinate inspection.

### D-1 — Slide 4, STEP 2 block is misaligned

| Element | Left | Top | Heading top |
|---|---|---|---|
| STEP 1 | 0.76 | 2.13 | 2.38 |
| **STEP 2** | 3.79 | **2.04** | **2.47** |
| STEP 3 | 6.82 | 2.13 | 2.38 |
| STEP 4 | 9.84 | 2.13 | 2.38 |

Descriptions follow the same offset: STEP 2 at 2.81, the others at 2.71. All three arrow images sit at
2.67, so the STEP 2 arrow bisects its own card's text block rather than centring on it.

**Fix.** Set STEP 2 to 2.13, 2.47, 2.71.

### D-2 — Slide 6, orphaned bullet marker

A `-` text box at top 7.41 in with height 0.09 in, containing only the hyphen and no text. Its
containing card ends at 7.50 in, so it is inside the card but below the last real bullet, which ends at
7.24.

**Fix.** Delete it. It reads as a seventh bullet with missing content.

### D-3 — Slide 5, empty trailing bullet box

A `-` marker at 6.63 in with no accompanying text box, following the sixth bullet. Slide 3's equivalent
box has text; slide 5's does not.

**Fix.** Delete it, or add the seventh bullet the deck was reaching for.

## Typography risk

Every text run overrides to **Rajdhani** while the theme's fonts are Calibri. Rajdhani is a condensed
display face; at 13.5 pt — the slide 4 step body size — it is close to illegible on a projector. The
package contains a single `.fntdata` blob, so it is unclear Rajdhani is embedded at all, which would
substitute a system font unpredictably.

**Fix, in order of preference.**

1. Raise the slide 4 step body to 15 pt.
2. Keep Rajdhani for headings, move body to Calibri or Inter.
3. Embed the font, or accept substitution deliberately.

## Missing from the deck

Worth adding, because each is a strength the current deck does not claim.

| Addition | Slide | Why |
|---|---|---|
| Base Sepolia named explicitly | 1 or 7 | Specificity. Every deployment claim is testnet-scoped |
| Chainlink feed address and heartbeat | 5 | `0x4aDC…c7cb1`, 1200s. Shows the freshness bound is grounded |
| Batch decoder | 3 or 7 | Users can read what they sign. A differentiator and an honest UX argument |
| What the project does *not* prevent | 7 | See below |
| Draft status of ERC-8211 | 1 | Credibility |

The fourth is the important one. A slide titled "Limits" containing one line — *a fresh, in-band,
manipulated price passes every on-chain check; this requires off-chain monitoring* — is worth more than
any additional feature claim, because it is the question a competent judge will ask and the answer
should be volunteered.

## Revised slide copy

Drop-in replacements.

### Slide 1 — title

```
TEAM CHICKEN ROLL presents LATCH

LATCH: Predicate-Gated Execution Module

ERC-8211 composable execution for ERC-7579 modular smart accounts,
EIP-7702 EOAs, and oracle-verified constraints

Track: Open Innovation
```

### Slide 2 — problem

Eyebrow: **Problem and vision**
Headline: **The limitation of static smart account batching**

Left card, **Static calldata fails**
Traditional batches freeze every parameter at signing. Step *n* cannot consume step *n-1*'s output,
because that output is not known when the signature is produced. Swap then supply reverts whenever
price impact makes the deposit smaller than the signed amount.

Right card, **Declarative values fail**
Resolve the value at execution instead, and the batch no longer depends on a guess at signing time.
The remaining problem is that a resolved value needs a bound, and the bound must be checked on-chain by
something that cannot be talked into it.

### Slide 3 — architecture

Eyebrow: **Architecture and pipeline**
Headline: **System architecture and data flow**

Four step cards, as before, with STEP 2 realigned:

| Step | Label | Heading | Body |
|---|---|---|---|
| 1 | STEP 1: USER INTENT | React and Viem client | User signs a declarative plan. Only literals and fetcher tags are fixed. |
| 2 | STEP 2: ACCOUNT ROUTER | Nexus, ERC-7579 / ERC-7702 | Modular account dispatches `executeComposable` through the composability module. |
| 3 | STEP 3: RUNTIME EVAL | FeedGuard and constraints | Fetchers resolve on-chain. Every value passes an inline constraint before it moves. |
| 4 | STEP 4: EXECUTION | Target protocol | The batch executes atomically, or reverts in full. |

Lower band, **Three gates, not one.** Runtime resolution · inline constraints · oracle freshness.

### Slide 4 — mechanics

Eyebrow: **Core mechanics**
Headline: **Dynamic resolution and failure semantics**

| Claim | Corrected copy |
|---|---|
| Runtime formula evaluation | **Runtime value resolution.** Parameters resolve at execution through `BALANCE`, `STATIC_CALL` or `RAW_BYTES`. Arithmetic lives in audited helpers. |
| `minAmountOut = price * (1 - slippage)` | `QuoterGuard.minAmountOut(..., slippageBps)` — our helper, one audited view, bound computed at execution |
| Oracle freshness verification | **Oracle freshness verification.** `FeedGuard.isFresh` reduces staleness to one word gated by `EQ 1`. Default 1200s, the ETH/USD heartbeat on Base Sepolia |
| Configurable failure policies | **Atomic by default.** `REVERT_BATCH` throughout. `SKIP_CALL` exists through `FailSafeExecutor`, opt-in, and off by default |
| Trustless price bounds | **On-chain bounds.** No keeper decides whether a batch executes. A keeper may only *trigger* a conditional one |
| Zero extra signatures | **One signature.** No re-signing when parameters adapt. The 7702 authorization and module install each need their own |

### Slide 5 — risk

Eyebrow: **Risk management**
Headline: **Risk matrix and mitigations**

Six rows, from [12-risk-matrix.md](12-risk-matrix.md), with residual ratings:

| Risk | Mitigation | Residual |
|---|---|---|
| Stale feed between simulate and execute | `FeedGuard` gate first, heartbeat-bounded, boundary-tested | Low |
| Unaudited `FeedGuard` | Side-effect free, no admin functions, full branch coverage, pinned address | Moderate |
| Unaudited `FailSafeExecutor` | Provenance derived on-chain; **disabled by default** | Low |
| No access control on `executeComposableCall` | Install `executeComposable`; verify selectors after install | Low |
| **Manipulated but fresh, in-band feed** | **No on-chain mitigation exists. Off-chain monitoring** | **High, accepted** |
| Slide copy outrunning the implementation | Every claim traced to a spec section in this blueprint | Low |

### Slide 6 — summary

Eyebrow: **Summary and impact**
Headline: **What LATCH delivers**

- **ERC-7579 native.** Installs into an existing Nexus account. No account migration, no fork.
- **Nine constraint types.** `EQ`, `GTE`, `LTE`, `IN`, signed variants, `OR`, `SKIP` — evaluated on-chain.
- **Oracle-verified.** Freshness is enforceable, which ERC-8211 alone cannot do. Arithmetic lives in two audited helpers.
- **Atomic by default.** All or nothing. Partial failure is opt-in and comes with a provenance invariant.
- **EIP-7702.** A standard EOA delegates and runs the plan. No deployment, no pre-funding.
- **Auditable by users.** The signed batch renders as a readable plan. A skipped constraint shows as unchecked, not as passing.

### Slide 7 — limits and next steps

Eyebrow: **Honest limits**
Headline: **What this does not do**

- It does not detect oracle manipulation. A fresh, in-band, manipulated price passes every on-chain check ERC-8211 offers.
- It does not park a failed batch. A failed constraint reverts; it does not wait. Triggering a conditional batch still needs a relayer.
- It does not remove `FailSafeExecutor`'s audit requirement. Two of our three contracts are unaudited, and we say so.

Closing line: **Base Sepolia · six steps · one signature · every value gated on-chain.**

## Verification checklist before the deck is presented

| Check | Where |
|---|---|
| No slide claims `SKIP_CALL` as a module feature | Slide 4 copy |
| No slide claims manipulation detection | Slide 4, slide 5 |
| ERC-8211 marked as draft | Slide 1 |
| Base Sepolia named | Slides 1, 7 |
| STEP 2 realigned, orphan bullets removed | Slides 4, 5, 6 |
| Body copy at 15 pt minimum | All slides |
| The limits slide exists | Slide 7 |

## Related documents

| Document | Covers |
|---|---|
| [design-tokens.md](appendix/design-tokens.md) | Palette, type scale, geometry |
| [02](02-erc8211-spec-notes.md) | Sources for every correction |
| [05](05-failure-semantics.md) | The `FailSafeExecutor` design behind C-1 |
| [12](12-risk-matrix.md) | Slide 5 content |
| [BLUEPRINT.md](../BLUEPRINT.md) | The argument the deck supports |