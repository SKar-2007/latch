---
title: Sources
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: this file
---

# Sources

Every technical claim in this documentation set traces to one of the entries below. Claims that
trace to no source are defects; report them against `CHECKLIST.md`.

Retrieval date for all entries: **2026-10-02**.

## Standards and specifications

| ID | Source | What it establishes |
|---|---|---|
| S1 | [ethereum/ERCs PR #1638](https://github.com/ethereum/ERCs/pull/1638) | ERC-8211 draft exists, is Standards Track, opened 2026-02-11. Canonical spec text |
| S2 | [erc8211.com](https://www.erc8211.com/) | Project framing, the three primitives, the normative 5-step pipeline, the four integration shapes |
| S3 | [Fellowship of Ethereum Magicians thread](https://ethereum-magicians.org/t/erc-8211-smart-batching/28135) | Design rationale, static-vs-smart batching comparison, cross-chain narrative |
| S4 | [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579) | Module type IDs, `IERC7579Module` lifecycle, mode encoding layout |
| S5 | [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) | EOA delegation to an implementation contract |
| S6 | [EIP-4337 / `IPaymaster.sol`](https://github.com/eth-infinitism/account-abstraction/blob/develop/contracts/interfaces/IPaymaster.sol) | Delivery-layer semantics the ERC-8211 executor sits above |
| S7 | [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) | Wallet-side batch RPC (`wallet_sendCalls`), static parameters only |
| S8 | [OpenZeppelin account modules](https://docs.openzeppelin.com/community-contracts/account-modules) | Call type / exec type values, execution data formats |
| S9 | [erc7579-implementation `IERC7579Account.sol`](https://github.com/erc7579/erc7579-implementation/blob/main/src/interfaces/IERC7579Account.sol) | `Execution` struct, `executeFromExecutor`, `supportsExecutionMode` |
| S10 | [ERC-7579 module registry](https://erc7579.com/modules) | Ecosystem module catalogue; confirms executor/fallback/hook patterns |

## Reference implementations

| ID | Source | What it establishes |
|---|---|---|
| R1 | [`ComposabilityDataTypes.sol`](https://raw.githubusercontent.com/bcnmy/erc8211-contracts/main/contracts/types/ComposabilityDataTypes.sol) | All enums and structs. Enum ordering. SPDX `MIT` |
| R2 | [`ComposableExecutionLib.sol`](https://raw.githubusercontent.com/bcnmy/erc8211-contracts/main/contracts/ComposableExecutionLib.sol) | Fetcher resolution, constraint evaluation, output capture, complete error catalogue. SPDX `MIT` |
| R3 | [`IComposableExecution.sol`](https://raw.githubusercontent.com/bcnmy/erc8211-contracts/main/contracts/interfaces/IComposableExecution.sol) | `executeComposable`, `executeComposableCall`, `executeComposableDelegateCall`. SPDX `LGPL-3.0-only` |
| R4 | [`ComposableExecutionModule.sol`](https://raw.githubusercontent.com/bcnmy/erc8211-contracts/main/contracts/ComposableExecutionModule.sol) | ERC-7579 wrapper, access control, install lifecycle, EntryPoint constant. SPDX `MIT` |
| R5 | [`Storage.sol`](https://raw.githubusercontent.com/bcnmy/erc8211-contracts/main/contracts/Storage.sol) | Namespace and slot derivation, initialisation tracking. SPDX `MIT` |
| R6 | [`bcnmy/erc8211-contracts` README](https://raw.githubusercontent.com/bcnmy/erc8211-contracts/main/README.md) | Contract inventory, the call-vs-delegatecall storage caveat, audit history |
| R7 | [`Nexus.sol`](https://raw.githubusercontent.com/bcnmy/nexus/main/contracts/Nexus.sol) | `supportsExecutionMode` at line 425. Confirms TRY support |
| R8 | [`ModeLib.sol`](https://raw.githubusercontent.com/bcnmy/nexus/main/contracts/lib/ModeLib.sol) | Call type, exec type and mode selector constants |
| R9 | [`ExecutionHelper.sol`](https://raw.githubusercontent.com/bcnmy/nexus/main/contracts/base/ExecutionHelper.sol) | `_tryExecuteSingle`, `_tryExecuteBatch`, `TryExecuteUnsuccessful` |
| R10 | [`Constants.sol`](https://raw.githubusercontent.com/bcnmy/nexus/main/contracts/types/Constants.sol) | Module type IDs, `MODULE_ENABLE_MODE_TYPE_HASH`, ERC-1271 magic value |
| R11 | [`ExecLib.sol`](https://raw.githubusercontent.com/bcnmy/nexus/main/contracts/lib/ExecLib.sol) | `encodeSingle` / `decodeSingle` byte layout |
| R12 | [`TestComposableExecution.t.sol`](https://raw.githubusercontent.com/bcnmy/nexus/main/test/foundry/unit/concrete/accountexecution/TestComposableExecution.t.sol) | Worked example; uses `getNamespace(account, account)` |
| R13 | [`bcnmy/nexus` README](https://raw.githubusercontent.com/bcnmy/nexus/main/README.md) | Disclosed issue note, commit guidance for funded accounts |

## SDK and tooling

| ID | Source | What it establishes |
|---|---|---|
| D1 | [`@biconomy/smart-batching` README](https://raw.githubusercontent.com/bcnmy/smart-batching-sdk/main/README.md) | `createComposableBatch`, runtime values, `check` / `write`, captures, constraint set, `toCalls` / `toCalldata` |
| D2 | [Biconomy docs: ERC-8211](https://docs.biconomy.io/overview/erc-8211) | Deployed module and storage addresses, MEE version gating, quickstart, audit link |
| D3 | [Biconomy docs index (`llms.txt`)](https://docs.biconomy.io/llms.txt) | Account modes, runtime function table, instruction types, error table |
| D4 | [Biconomy docs: supported chains](https://docs.biconomy.io/contracts-and-audits/supported-chains) | MEE versions per chain. Base Sepolia tops out at 2.2.2 |
| D5 | [Biconomy docs: SDK reference, account](https://docs.biconomy.io/sdk-reference/account) | `toMultichainNexusAccount`, EIP-7702 mode via `accountAddress` override |
| D6 | [Biconomy docs: EIP-7702 orchestration](https://docs.biconomy.io/new/getting-started/enable-mee-eoa-7702) | `signAuthorization`, `delegate: true`, Nexus singleton, mandatory `accountAddress` |
| D7 | [Biconomy docs: SDK reference, utilities](https://docs.biconomy.io/sdk-reference/utilities) | `getMEEVersion`, `MEEVersion` enum, `NEXUS_V120_SINGLETON`, default URLs |
| D8 | [Biconomy docs: SDK reference, client](https://docs.biconomy.io/sdk-reference/client) | `createMeeClient` parameters including `isDebugMode` |
| D9 | [Biconomy blog: Weiroll vs Smart Batching](https://blog.biconomy.io/from-scripts-to-programs-how-smart-batching-evolves-on-chain-execution) | Design trade-offs, why inline constraints beat helper contracts |
| D10 | [Eco explainer: what is ERC-8211](https://eco.com/support/en/articles/15230581-what-is-erc-8211-smart-batching-standard-explained-2026) | Draft provenance, authors, use-case taxonomy |
| D11 | [Eco explainer: runtime parameters and predicates](https://eco.com/support/en/articles/15230582-erc-8211-smart-batching-runtime-parameters-and-predicates-explained-2026) | Fetcher use cases, predicate operator list, pipeline detail |
| D12 | [`bcnmy/erc8211-quickstart`](https://github.com/bcnmy/erc8211-quickstart) | Clone-and-run sponsored Base Sepolia example |

## Oracles

| ID | Source | What it establishes |
|---|---|---|
| O1 | [Chainlink price feed addresses](https://docs.chain.link/data-feeds/price-feeds/addresses) | Feed proxy addresses, heartbeat, deviation threshold |
| O2 | [Chainlink RDD bundle: Base Sepolia](https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia-base-1.json) | Authoritative Base Sepolia feed set. Source of the table in `04` |
| O3 | [Chainlink L2 sequencer uptime feeds](https://docs.chain.link/data-feeds/l2-sequencer-feeds) | Base Mainnet sequencer feed `0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`. No Base Sepolia equivalent |

## Reference deck

| ID | Source | What it establishes |
|---|---|---|
| P1 | `Declarative Smart Batching Executor (1).pptx` | 7 slides, 16:9, authored with python-pptx, last modified 2026-09-19, 758 words, no speaker notes |

## Licensing note

Upstream Solidity is quoted verbatim in `docs/technical-reference/` under mixed licences:
`ComposabilityDataTypes.sol`, `ComposableExecutionLib.sol`, `ComposableExecutionModule.sol` and
`Storage.sol` carry `MIT`; `IComposableExecution.sol` carries `LGPL-3.0-only`. Each excerpt file
reproduces the original SPDX header. Nothing here modifies upstream logic.