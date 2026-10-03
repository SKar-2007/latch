---
title: LATCH Blueprint
status: draft
project: LATCH
team: TEAM CHICKEN ROLL
track: Open Innovation
last_reviewed: 2026-10-02
sources: docs/appendix/sources.md
---

# LATCH

**Predicate-gated execution for ERC-8211 composable batches on Biconomy Nexus smart accounts.**

LATCH is an execution layer that runs ERC-8211 "Smart Batching" plans against ERC-7579 modular smart
accounts, ERC-7702 delegated EOAs, and the Biconomy Nexus account on **Base Sepolia**. Users sign a
declarative intent whose parameters resolve on-chain at execution; every resolved value is gated by an
inline constraint, and every oracle-derived value is additionally gated by a freshness check enforced
inside the same atomic batch.

LATCH does not claim the batch encoding. That is [ERC-8211](https://github.com/ethereum/ERCs/pull/1638), a
Standards Track draft authored by Biconomy with the Ethereum Foundation. LATCH claims four verifiable
components:

| Component | Problem it solves | Spec |
|---|---|---|
| `FeedGuard` | Relative oracle staleness is not expressible as an ERC-8211 constraint | [04](docs/04-constraints-and-oracles.md) |
| `QuoterGuard` | Runtime slippage arithmetic does not exist in the spec | [04](docs/04-constraints-and-oracles.md) |
| `FailSafeExecutor` | The audited engine is strictly atomic; no partial-failure mode | [05](docs/05-failure-semantics.md) |
| Batch decoder | Signed batches are unreadable, so users cannot audit them | [06](docs/06-frontend-blueprint.md) |

## Naming

| Element | Value |
|---|---|
| Project | **LATCH** |
| Team | **TEAM CHICKEN ROLL** |
| Track | Open Innovation |
| Network | Base Sepolia, chain ID 84532 |
| Contracts we own | `FeedGuard`, `QuoterGuard`, `FailSafeExecutor`, `MockOracle` |
| Contracts we consume | `ComposableExecutionModule`, `Storage`, Nexus |
| Account | Biconomy Nexus `1.3.1`, native ERC-8211 composition |

LATCH is a product name. It is deliberately not a backronym.

## Read this first

The single most important page for anyone evaluating the project is [BLUEPRINT.md](BLUEPRINT.md). It
opens with a one-paragraph pitch, states plainly what is spec and what is ours, and is written so that
every claim survives one probing question.

If you are checking whether the original slide deck was accurate, read
[00-deck-analysis.md](docs/00-deck-analysis.md) — it carries a six-item corrections register.

## Repository map

```
.
├── BLUEPRINT.md                       master document
├── CHECKLIST.md                       status, gates, readiness
├── README.md                          this file
├── foundry.toml                      build configuration
├── contracts/                        Solidity we own
│   ├── FeedGuard.sol                 oracle freshness, one word
│   ├── QuoterGuard.sol               runtime slippage bound
│   ├── FailSafeExecutor.sol          opt-in partial failure
│   ├── interfaces/
│   └── mocks/                        MockOracle, test doubles
├── test/                             Foundry suites
├── script/                           deployment
└── docs/                             the blueprint
    ├── 00-deck-analysis.md            deck teardown, corrections register, revised copy
    ├── 01-system-architecture.md      trust boundaries, components, sequences
    ├── 02-erc8211-spec-notes.md      the encoding, precisely
    ├── 03-module-integration.md       ERC-7579 / ERC-7702 wiring, namespaces
    ├── 04-constraints-and-oracles.md  constraints, slippage, oracle freshness
    ├── 05-failure-semantics.md        atomicity, FailSafeExecutor
    ├── 06-frontend-blueprint.md       client, signing, batch decoder
    ├── 07-relayer-and-keepers.md      submission paths, retry loops
    ├── 08-security-model.md           threat table
    ├── 09-testing-strategy.md         test matrix, invariants, fuzzing
    ├── 10-deployment-runbook.md       Base Sepolia deploy and verify
    ├── 11-demo-script.md              live demo narrative
    ├── 12-risk-matrix.md              risk register
    ├── 13-composition-patterns.md     canonical flows
    ├── adr/                           architecture decision records
    ├── appendix/                      sources, glossary, design tokens, verification log
    └── technical-reference/           verbatim upstream Solidity, attributed
```

## Build

```bash
forge build     # clean
forge test                    # 146 passing, 0 failing
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test   # includes the fork and smoke suites

cd client && npm install && npm test    # 80 passing: builder, decoder, demo batch, ABI parity
forge snapshot  # gas regression baseline
```

| Contract | Runtime size | Role | Tests |
|---|---|---|---|
| [`contracts/FeedGuard.sol`](contracts/FeedGuard.sol) | 1,950 B | Oracle freshness reduced to one constrainable word | 32 |
| [`contracts/QuoterGuard.sol`](contracts/QuoterGuard.sol) | 1,492 B | Runtime slippage bound, overflow-safe | 24 |
| [`contracts/FailSafeExecutor.sol`](contracts/FailSafeExecutor.sol) | 6,478 B | Opt-in partial failure. **Storage-free**, delegatecall target | 33 |
| `contracts/mocks/` | — | `MockOracle`, `MockQuoter`, `RevertingAggregator` | — |
| [`script/Deploy.s.sol`](script/Deploy.s.sol) | — | Base Sepolia deploy with pre-flight assertions | — |

`FailSafeExecutor` is deployed but not installed by default. See
[adr/0002](docs/adr/0002-fail-safe-executor.md) and
[adr/0001](docs/adr/0001-atomicity.md).

## Documentation conventions

Every file obeys the same rules, so a claim can be traced to its source and an unverified value can
never be mistaken for a verified one.

| ID | Rule |
|---|---|
| C1 | Every normative spec claim carries a source link and a `verified 2026-10-02` marker |
| C2 | Unverified values are never asserted. They live in [verification-log.md](docs/appendix/verification-log.md) |
| C3 | Upstream Solidity is quoted verbatim and attributed, never modified |
| C4 | No emoji. Sentence-case headings. Maximum heading depth of 3. Tables for normative data |
| C5 | Front matter on every file: `title`, `status`, `project`, `last_reviewed` |
| C6 | Status lifecycle is `draft` → `reviewed` → `final`. Everything ships as `draft` |
| C7 | Relative links only. Every file reachable from this `README.md`. Zero orphans |
| C8 | Mermaid for control and data flow. Tables for state and encoding matrices |

### Status legend

| Status | Meaning |
|---|---|
| `draft` | Written, not reviewed by a second pair of eyes |
| `reviewed` | Checked against upstream sources; verification register updated |
| `final` | Frozen. Changes require regenerating dependent files |

### Version stamping

ERC-8211 is an active draft. Unless a statement is pinned to a release, every claim about the reference
implementation is stated as of **MEE v2.2.2**, the release that shipped the audited composability module.
Enum ordering in particular may change upstream.

## Appendix

| Document | Contents |
|---|---|
| [sources.md](docs/appendix/sources.md) | Every source with URL, retrieval date, and what it established |
| [verification-log.md](docs/appendix/verification-log.md) | The verification register. Read before trusting any address |
| [glossary.md](docs/appendix/glossary.md) | Vocabulary for the whole set |
| [design-tokens.md](docs/appendix/design-tokens.md) | Palette, type scale, spacing, from the source deck |

## Upstream reference

Verbatim, attributed Solidity from the audited implementations. Unmodified.

| Reference | Upstream | Licence |
|---|---|---|
| [composability-data-types.md](docs/technical-reference/composability-data-types.md) | `ComposabilityDataTypes.sol` | MIT |
| [composable-execution-lib.md](docs/technical-reference/composable-execution-lib.md) | `ComposableExecutionLib.sol` | MIT |
| [composable-execution-module.md](docs/technical-reference/composable-execution-module.md) | `ComposableExecutionModule.sol`, `Storage.sol`, `IComposableExecution.sol` | MIT, LGPL-3.0-only |
| [nexus-execution-helper.md](docs/technical-reference/nexus-execution-helper.md) | `Nexus.sol`, `ModeLib.sol`, `ExecutionHelper.sol` | MIT |

## Architecture decisions

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-atomicity.md) | Atomic execution is the default and the headline claim |
| [0002](docs/adr/0002-fail-safe-executor.md) | Segment rather than patch. The audited engine is never modified |
| [0003](docs/adr/0003-storage-namespace.md) | Namespace derivation, and which dispatch flow to pin |
| [0004](docs/adr/0004-oracle-freshness.md) | Freshness as a single-word predicate, plus a mandatory price band |
| [0005](docs/adr/0005-account-mode.md) | EIP-7702 primary for the demo, ERC-7579 as the documented fallback |

## Quick reference: verified constants

Checked on Base Sepolia on 2026-10-02 against three independent providers.

| Constant | Value | Confidence |
|---|---|---|
| Composability module | `0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7` | **Verified on chain.** 6,510 bytes. `isModuleType` true for 2 and 3 only |
| Composable storage | `0x00008211dea1Aca67ac55fc44AE3bF88CF41281d` | **Verified on chain.** 575 bytes |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | **Verified on chain** via `getEntryPoint` |
| Chainlink ETH/USD (Base Sepolia) | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | **Verified on chain.** 1200s heartbeat, **8 decimals** |
| **Nexus 1.3.1 — use this** | `0x0000000020fe2F30453074aD916eDeB653eC7E9D` | **Verified.** `accountId()` = `biconomy.nexus.1.3.1`. Native `executeComposable` and try-exec |
| Nexus 1.2.0 — documented, wrong build | `0x000000004F43C49e93C970E84001853a70923B03` | Deployed, but **no `executeComposable`**. Do not delegate here |
| SDK | `@biconomy/abstractjs` 2.0.2, `@biconomy/smart-batching` 0.1.0 | **Verified** on npm |

### The finding worth reading

Round 1 concluded that the deployed account did **not** support `EXECTYPE_TRY`, which would have
invalidated `FailSafeExecutor`. That conclusion came from `supportsExecutionMode` — a function that
exists in the `main` branch and in **none** of the four deployed Base Sepolia builds, so it reverted as
an unknown selector.

A bytecode survey showed the opposite: every build carries `TryExecuteUnsuccessful`,
`TryDelegateCallUnsuccessful` and `executeFromExecutor`. It also showed the address in Biconomy's
documentation is an older `1.2.0` account with no composability, while
`0x0000000020fe2F30453074aD916eDeB653eC7E9D` is `1.3.1` and implements `executeComposable` natively — so
no module installation is needed at all.

**Verify the deployed build, not the source branch.** Full detail in
[verification-log.md](docs/appendix/verification-log.md).
