---
title: LATCH
status: draft
project: LATCH
team: TEAM CHICKEN ROLL
tracks: Web3, Open Innovation
last_reviewed: 2026-10-03
sources: docs/appendix/sources.md
---

# LATCH

**Predicate-gated execution for ERC-8211 composable batches on Biconomy Nexus smart accounts.**

LATCH is an execution layer that runs [ERC-8211](https://github.com/ethereum/ERCs/pull/1638) "Smart
Batching" plans against ERC-7579 modular smart accounts, ERC-7702 delegated EOAs, and the Biconomy
Nexus account on **Base Sepolia**.

A user signs a declarative intent. Its parameters do not resolve when the intent is signed — they
resolve **on-chain, at execution time**, inside the same atomic batch. Every resolved value is gated by
an inline constraint. Every oracle-derived value is additionally gated by a freshness check enforced in
the same transaction. Nothing is checked twice, and nothing is checked off-chain.

The problem this addresses is narrow and real. A batch that freezes its parameters at signing time
reverts the moment the world moves underneath it: a swap returns less than expected, a feed goes stale, a
balance shifts. A batch that re-checks off-chain reintroduces a race between the check and the
execution. LATCH's position is that the check belongs inside the batch, as a predicate, where it cannot
be skipped.

## Tracks

This project is entered in **two** tracks. They are not two framings of one pitch; they are two
different questions, and the work satisfies each in a different way.

| | **Web3** | **Open Innovation** |
|---|---|---|
| The question | Can it run safely on real account infrastructure? | Does it make a protocol meaningfully more useful? |
| What is judged | Correctness against a live chain, security posture, integration fidelity | Novelty, leverage, what becomes possible that did not |
| Our answer | 167 tests including fork tests against live Base Sepolia state, a pinned-account security model, and an auditable verification register | Three primitives the reference spec does not have, and a decoder that makes signed batches human-auditable |
| Strongest evidence | [verification-log.md](docs/appendix/verification-log.md) | [04](docs/04-constraints-and-oracles.md), [05](docs/05-failure-semantics.md) |
| Honest weakness | Demo steps 3–6 are blocked on account provisioning (V-04) | The primitives are unproven at mainnet scale, by definition |

Under **Web3**, the interesting part is not the Solidity. It is that this repository contains a register
of its own wrong answers, several of them found and corrected by hand, and a stated limit on what its
own test suite can prove.

Under **Open Innovation**, the contribution is that relative oracle staleness, runtime slippage
arithmetic, and partial-failure semantics are all expressible as *predicates* inside an existing batch
format — no new encoding, no engine fork, no change to the standard.

## What is spec and what is ours

LATCH does not claim the batch encoding. ERC-8211 is a Standards Track draft authored by Biconomy with
the Ethereum Foundation, and the reference implementation is theirs. LATCH claims four verifiable
components:

| Component | Problem it solves | Spec |
|---|---|---|
| `FeedGuard` | Relative oracle staleness is not expressible as an ERC-8211 constraint | [04](docs/04-constraints-and-oracles.md) |
| `QuoterGuard` | Runtime slippage arithmetic does not exist in the spec | [04](docs/04-constraints-and-oracles.md) |
| `FailSafeExecutor` | The audited engine is strictly atomic; there is no partial-failure mode | [05](docs/05-failure-semantics.md) |
| Batch decoder | Signed batches are unreadable, so users cannot audit what they are signing | [06](docs/06-frontend-blueprint.md) |

Two design commitments follow from that split, and they are the ones a reviewer should press on:

1. **The audited engine is never modified.** `FailSafeExecutor` is a separate delegatecall target, not a
   patch. See [adr-0002](docs/adr/0002-fail-safe-executor.md).
2. **A quoter view is not a guarantee.** `QuoterGuard`'s own docstring says so. A quote reflects pool
   state at one block and is not a fill guarantee. See [08](docs/08-security-model.md).

## Status

Stated plainly, because a README that hides its blockers is worth less than one that names them.

| Area | State |
|---|---|
| `FeedGuard`, `QuoterGuard`, `FailSafeExecutor` | Complete. Unit, property, invariant and fork tested |
| Batch decoder and builder (`client/`) | Complete. 80 tests, ABI-parity checked against Solidity |
| Web client (`web/`) | Complete. 115 tests across 11 files |
| Deployment to Base Sepolia | Ready and pre-flighted, **not yet broadcast** |
| Live demo steps 1–2 (assertion gates) | Passing against the live engine |
| Live demo steps 3–6 (approve, swap, supply) | **Blocked** — see V-04 and V-27 |
| On-chain liquidity reads | **Not possible** — see V-25 |

The last two are the honest ones, and both are consequences of the reference implementation rather than
of this project. V-25: Uniswap's `Quoter` cannot be reached through a `staticcall`, so a `view` guard
cannot read live liquidity. V-27: a composable batch must be routed through the *account's* fallback
handler, so the account has to be provisioned correctly before any batch runs against it.

## Quick start

```bash
forge build
forge test                                                       # 167 offline, no RPC needed
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test          # 167, adds fork and smoke suites

cd client && npm install && npm test        # 80: builder, decoder, demo batch, ABI parity
cd web    && npm install && npm test        # 115
```

Requires Foundry and Node. Copy `.env.example` to `.env` for deployment; it is gitignored and its
private key must never be committed.

### Deploying

`script/Deploy.s.sol` deploys `FeedGuard`, `QuoterGuard`, `FailSafeExecutor`, `MockOracle`, and Uniswap's
own `Quoter` from pinned v3-periphery v1.0.0 bytecode. It pre-flights every external assumption against
the chain and aborts if any is false — the composability module, the composable storage, the Nexus build
identity, and the presence of `executeComposable` in the account's dispatcher.

```bash
forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org   # dry run, free
forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast --private-key $DEPLOYER_KEY
```

`FailSafeExecutor` is deployed but deliberately **not installed**. See
[adr-0002](docs/adr/0002-fail-safe-executor.md).

## How a batch executes

```
        user signs                account                        same transaction
   ─────────────────   ──────────────────────────────   ────────────────────────────────
   intent              fallback handler                  FeedGuard.isFresh  -> 1
   (no values)   ──►   routes selector to        ──►   constraint: balance >= amount
                       the composability module        QuoterGuard slippage    -> ok
                                                             │
                                                             ▼
                                                        swap executes
```

Step 1 of the demo is a predicate, not a target: the guard is reached by `STATIC_CALL`, and the
constraint is what gates the batch. Every subsequent step consumes values resolved in the same
transaction. Full narrative in [11-demo-script.md](docs/11-demo-script.md).

## Repository map

```
.
├── README.md                          this file
├── BLUEPRINT.md                       master document
├── CHECKLIST.md                       status, gates, readiness
├── foundry.toml                      build, compiler profiles, fs permissions
├── contracts/                         Solidity we own
│   ├── FeedGuard.sol                  oracle freshness, one constrainable word
│   ├── QuoterGuard.sol                runtime slippage bound
│   ├── FailSafeExecutor.sol           opt-in partial failure, storage-free
│   ├── interfaces/                    IQuoterV2, IERC20Probe, ERC-8211 types
│   └── mocks/                         MockOracle, MockQuoter, RevertingAggregator
├── test/
│   ├── unit/                          per-contract
│   ├── property/                      encodings, slot derivation, constraints
│   ├── invariant/                     3,072-call stateful runs
│   ├── fork/                          live chain: encoding fuzz, demo batch, Nexus probes
│   ├── smoke/                         live smoke against verified addresses
│   ├── parity/                        Solidity-generated ABI fixture
│   └── interface/                     selector pins
├── script/                            Deploy.s.sol, ABI fixture emitter
├── quoter/                            Uniswap Quoter, pinned bytecode + provenance
├── client/                            pure logic, no framework: 80 tests
├── web/                               React client: 115 tests
├── lib/                               forge dependencies (forge-std, v3-core, v3-periphery)
└── docs/                              the blueprint
    ├── 00-deck-analysis.md            deck teardown, corrections register
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
    ├── identity.md                    name, voice, marks, copy deck
    ├── adr/                           0001–0005
    ├── appendix/                      sources, glossary, tokens, verification log
    └── technical-reference/           verbatim upstream Solidity, attributed
```

## Testing

167 Solidity tests, 80 client tests, 115 web tests.

| Contract | Runtime size | Role |
|---|---|---|
| [`contracts/FeedGuard.sol`](contracts/FeedGuard.sol) | 1,610 B | Oracle freshness reduced to one constrainable word |
| [`contracts/QuoterGuard.sol`](contracts/QuoterGuard.sol) | 1,204 B | Runtime slippage bound, overflow-safe |
| [`contracts/FailSafeExecutor.sol`](contracts/FailSafeExecutor.sol) | 5,557 B | Opt-in partial failure. **Storage-free**, delegatecall target |

| Suite | Count | What it establishes |
|---|---|---|
| `unit/` | 57 | Per-contract behaviour, error selection, arithmetic edges |
| `fork/` | 42 | Live Base Sepolia state: encoding fuzz, demo batch, Nexus delegation and provisioning |
| `invariant/` | 33 | Stateful runs of 3,072 calls against the two guards and the executor |
| `property/` | 16 | Encoding and slot-derivation properties, plus guard invariants |
| `smoke/` | 13 | Live smoke against the verified addresses below |
| `interface/` | 4 | Selectors pinned to the signatures the spec defines |
| `parity/` | 2 | Client output is byte-identical to a Solidity-generated fixture |

Without `BASE_SEPOLIA_RPC_URL` the fork and smoke suites skip and the total is unchanged at 167, so a
green offline run is not weaker evidence than a green fork run.

Three suites run at the chain head and can flake if it moves mid-run; the rest pin a block. One such
flake was observed and did not reproduce across three subsequent full runs.

`parity/` deserves a note. It writes a fixture from Solidity and reads the same bytes from TypeScript,
so a divergence in the hand-written ABI codec fails a test rather than producing a wrong signature on a
live chain.

## Verification discipline

Documentation conventions are listed in full in [docs/appendix/verification-log.md](docs/appendix/verification-log.md).
The load-bearing ones:

| ID | Rule |
|---|---|
| C1 | Every normative spec claim carries a source link and a `verified` marker |
| C2 | Unverified values are never asserted. They live in the verification register |
| C3 | Upstream Solidity is quoted verbatim and attributed, never modified |
| C6 | Status lifecycle is `draft` → `reviewed` → `final`. Everything ships as `draft` |

The register currently holds **21 findings**, numbered V-01 to V-27 with gaps — the numbering is
chronological, not dense, and unused numbers were retired rather than reused. It is worth reading before
trusting any address in this repository.

### Findings that changed the project's conclusions

Three are worth surfacing here, because each one was wrong in the same direction — a probe that could
not fail, and so reported success.

**A selector quoted from memory instead of computed.** `IQuoterV2` declared
`quoteExactInputSingle(tokenIn, tokenOut, amountIn, fee, limit)`. The spec declares
`(tokenIn, tokenOut, fee, amountIn, limit)`. Both compile; both typecheck; the mock quoter was written
from the same mistaken interface, so the unit suite agreed with itself and disagreed with every real
Uniswap contract. The guard would have reverted against a correctly deployed quoter. `interface/` now
pins the selector and derives it from the signature string.

**A test that proved nothing.** The smoke test asserting a quoter was absent scanned bytecode for the
selector *this repository* declared — one that appears in no Uniswap contract. It passed for every
contract on earth, including a genuine `Quoter`. It could not have detected the thing it was looking
for.

**A capability probe that returns true for a capability the build lacks.** `supportsExecutionMode` is
present on both Nexus builds and returns `true` for every mode, including on a build with no
`executeComposable` at all. An absent selector fails loudly; this one succeeds and lies.

The pattern is worth naming: **a check that cannot fail is worse than no check**, because it converts an
unknown into a false positive. `test/interface/SelectorPin.t.sol` exists to make that specific mistake
unrepeatable.

## Verified constants

Checked on Base Sepolia. Read [verification-log.md](docs/appendix/verification-log.md) before trusting
any of them; two entries below have already been corrected once.

| Constant | Value | State |
|---|---|---|
| Composability module | `0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7` | Verified. 6,510 B. `isModuleType` true for 2 and 3 only |
| Composable storage | `0x00008211dea1Aca67ac55fc44AE3bF88CF41281d` | Verified |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Verified via `getEntryPoint` |
| Chainlink ETH/USD | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | Verified. 1200 s heartbeat, 8 decimals |
| Uniswap V3 factory | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | Verified. `feeAmountTickSpacing(3000) == 60` |
| SwapRouter02 | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` | Verified. `factory()` agrees |
| Aave V3 pool | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` | Verified. Six markets, WETH listed |
| Nexus 1.3.1 implementation | `0x0000000020fe2F30453074aD916eDeB653eC7E9D` | Verified `accountId()`. **Implementation, not an account** — all EIP-1967 slots are zero |
| Nexus account factory | `0x0000b1C08f1418dA76B5E99c1Bf5718486cf8c53` | Verified against source. **Deploys 1.3.3**, not 1.3.1 |
| Documented QuoterV2 | `0xC5290058841028F1614F3A6F0F5816cAd0df5E27` | **Not a QuoterV2.** Lacks both real selectors; documented as one upstream |

Two entries deserve emphasis because the intuitive reading is wrong. `0x…7E9D` is the Nexus
*implementation*, not a deployed account — delegating to it is a valid pattern, but delegating is not
the same as owning a provisioned account. And the address Biconomy documents as the Base Sepolia
`QuoterV2` is not one: it is 8,273 bytes, answers to a selector Uniswap does not define, and reverts.

## Known blockers

Named so they are not discovered during a demo.

| ID | Blocker | Effect |
|---|---|---|
| **V-04** | No Nexus account with the composability module registered could be provisioned. The deployed bootstrap's selector set differs from its published source, and initialization reverts on an unidentified inner error `0x1425ea42` | Blocks demo steps 3–6 |
| **V-25** | Uniswap's `Quoter` cannot be reached from a `staticcall`; `LOG` is illegal in a static context and the pool emits a `Swap` event | `QuoterGuard` cannot read live liquidity on-chain |
| **V-27** | A batch must be routed through the *account's* fallback handler. Calling the module directly makes `msg.sender` the EOA, so the batch operates on the wrong account | Explains the original V-24 symptom |

V-25 has a deliberate non-fix. Switching `QuoterGuard` to a plain `call` would let an arbitrary
caller-supplied contract mutate state during a `view` function. A quoter is a view surface by
definition; letting one write is the vulnerability, not the fix. Quote off-chain, enforce the bound
on-chain.

## Naming

| Element | Value |
|---|---|
| Project | **LATCH** |
| Team | **TEAM CHICKEN ROLL** |
| Tracks | Web3, Open Innovation |
| Network | Base Sepolia, chain ID 84532 |
| Contracts we own | `FeedGuard`, `QuoterGuard`, `FailSafeExecutor`, `MockOracle` |
| Contracts we consume | `ComposableExecutionModule`, composable storage, Nexus, Uniswap `Quoter` |
| Demo batch | 6 entries, 15 USDC |

LATCH is a product name. It is deliberately not a backronym.

## Documentation

| Document | Contents |
|---|---|
| [BLUEPRINT.md](BLUEPRINT.md) | Master document: pitch, ownership boundaries, what survives a probing question |
| [sources.md](docs/appendix/sources.md) | Every source with URL, retrieval date, and what it established |
| [verification-log.md](docs/appendix/verification-log.md) | The register. Read before trusting any address |
| [glossary.md](docs/appendix/glossary.md) | Vocabulary for the whole set |
| [identity.md](docs/identity.md) | Name, voice, marks, colour, copy deck |
| [00-deck-analysis.md](docs/00-deck-analysis.md) | Original deck teardown and corrections register |

### Architecture decisions

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-atomicity.md) | Atomic execution is the default and the headline claim |
| [0002](docs/adr/0002-fail-safe-executor.md) | Segment rather than patch. The audited engine is never modified |
| [0003](docs/adr/0003-storage-namespace.md) | Namespace derivation, and which dispatch flow to pin |
| [0004](docs/adr/0004-oracle-freshness.md) | Freshness as a single-word predicate, plus a mandatory price band |
| [0005](docs/adr/0005-account-mode.md) | EIP-7702 primary for the demo, ERC-7579 as the documented fallback |

### Upstream reference

Verbatim, attributed Solidity from the audited implementations. Unmodified.

| Reference | Upstream | Licence |
|---|---|---|
| [composability-data-types.md](docs/technical-reference/composability-data-types.md) | `ComposabilityDataTypes.sol` | MIT |
| [composable-execution-lib.md](docs/technical-reference/composable-execution-lib.md) | `ComposableExecutionLib.sol` | MIT |
| [composable-execution-module.md](docs/technical-reference/composable-execution-module.md) | `ComposableExecutionModule.sol`, `Storage.sol`, `IComposableExecution.sol` | MIT, LGPL-3.0-only |
| [nexus-execution-helper.md](docs/technical-reference/nexus-execution-helper.md) | `Nexus.sol`, `ModeLib.sol`, `ExecutionHelper.sol` | MIT |

### Version stamping

ERC-8211 is an active draft. Unless a statement is pinned to a release, claims about the reference
implementation are stated as of **MEE v2.2.2**, the release that shipped the audited composability
module. Enum ordering in particular may change upstream; if it does, every previously signed batch
decodes differently. That dependency is tracked as V-10.