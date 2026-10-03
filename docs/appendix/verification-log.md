---
title: Verification log
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md
---

# Verification log

The register of values confirmed or still outstanding for Base Sepolia. Rule C2 in
[README.md](../../README.md) forbids asserting an unconfirmed value in a runbook, a slide, or a code
comment. Values live here, and only here, with a confirmation method.

Nothing in this file is a defect. It is the mechanism that prevents a wrong address from becoming a
shipped bug, and it has already caught four.

## Confidence vocabulary

| Level | Meaning |
|---|---|
| `VERIFIED` | Read from primary source or queried on chain. Reproducible. |
| `DOCUMENTED` | Stated by the vendor. Trustworthy, not independently confirmed. |
| `PARTIAL` | Partially established. A specific gap remains. |
| `UNVERIFIED` | Inferred or expected. Must be confirmed before it is relied upon. |

## Verification round 1 — 2026-10-02

Base Sepolia, chain ID `0x14a34` (84532), confirmed against three independent providers:
`base-sepolia.publicnode.com`, `sepolia.base.org`, `base-sepolia.gateway.tenderly.co`.

### Resolved

| ID | Value | Level | Evidence |
|---|---|---|---|
| V-02 | Composability module deployed on Base Sepolia | `VERIFIED` | `eth_getCode` at `0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7` returns 6,510 bytes |
| V-03 | Composable storage deployed on Base Sepolia | `VERIFIED` | `eth_getCode` at `0x00008211dea1Aca67ac55fc44AE3bF88CF41281d` returns 575 bytes |
| V-05 | SDK versions | `VERIFIED` | `@biconomy/abstractjs` 2.0.2, 69 versions, latest 2026-09-01. `@biconomy/smart-batching` **0.1.0, exactly one published version**, 2026-05-25 |

Module identity was confirmed by behaviour, not assumed. Calls against the live contract reproduce the
upstream source exactly:

| Call | Result | Expected from source |
|---|---|---|
| `isModuleType(1)` VALIDATOR | `false` | false |
| `isModuleType(2)` EXECUTOR | **`true`** | true |
| `isModuleType(3)` FALLBACK | **`true`** | true |
| `isModuleType(4)` HOOK | `false` | false |
| `getEntryPoint(address(1))` | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | EntryPoint v0.7 |

`isModuleType` returning true for exactly types 2 and 3, and false for 1 and 4, matches
`return moduleTypeId == TYPE_EXECUTOR || moduleTypeId == TYPE_FALLBACK;` line for line. This also
independently confirms **K-01**, the EntryPoint v0.7 constant.
### Resolved in round 2 — bytecode survey

Rather than funding an account to test try-mode, the deployed bytecode was surveyed directly. A contract
can only contain an event topic if it can emit that event, so the presence of
`TryExecuteUnsuccessful(bytes,bytes)` is decisive evidence that try-execution is implemented.

Event topic: `0xb5282692b8c578af7fb880895d599035496b5e64d1f14bf428a1ed3bc406f662`

| ID | Item | Level | Finding |
|---|---|---|---|
| **V-14** | Does the account honour `EXECTYPE_TRY`? | **`VERIFIED YES`** | All four Nexus builds on Base Sepolia contain the `TryExecuteUnsuccessful` and `TryDelegateCallUnsuccessful` topics **and** the `executeFromExecutor` selector. `FailSafeExecutor`'s mechanism is present |
| **V-16** | Which singleton is the ERC-8211 Nexus? | **`VERIFIED`** | `0x0000000020fe2F30453074aD916eDeB653eC7E9D`, `accountId()` = **`biconomy.nexus.1.3.1`** |
| **V-04** | Nexus singleton for the demo | **`VERIFIED`** | Same address. This is the EIP-7702 delegation target |
| **V-18** | Does the account need the composability module installed? | **`VERIFIED NO`** | The 1.3.1 account contains the `executeComposable` selector itself. It is the spec's native-inheritance shape |

### What the survey found

Thirteen SDK-listed contracts carry code on Base Sepolia. Four are Nexus account implementations:

| Address | `accountId()` | Try-exec | `executeComposable` |
|---|---|---|---|
| `0x000000001964d23C59962Fc7A912872EE8fB3b6A` | `biconomy.nexus.1.0.2` | yes | no |
| `0x000000004F43C49e93C970E84001853a70923B03` | `biconomy.nexus.1.2.0` | yes | no |
| `0x00000000383e8cBe298514674Ea60Ee1d1de50ac` | `biconomy.nexus.1.2.0` | yes | no |
| **`0x0000000020fe2F30453074aD916eDeB653eC7E9D`** | **`biconomy.nexus.1.3.1`** | **yes** | **yes** |

Two selector-presence results decide everything:

| Selector | Function | Module `0x…f0e7` | Nexus 1.3.1 `0x…9D2` |
|---|---|---|---|
| `0x7eba07b8` | `executeComposable(ComposableExecution[])` | present | **present** |
| `0xdcb108bf` | `executeComposableCall(...)` | present | absent |
| `0x48a58db7` | `executeComposableDelegateCall(...)` | present | absent |
| `0x6d61fe70` | `onInstall(bytes)` | present | absent |
| `0x584465f2` | `setEntryPoint(address)` | present | absent |
| `0x5e765374` | `getEntryPoint(address)` | present | absent |

The module carries all three entry points and the full ERC-7579 lifecycle, matching
`ComposableExecutionModule.sol`. The 1.3.1 account carries only `executeComposable`, which is the
`ComposableExecutionBase` inheritance shape — it composes natively and delegates to nothing.

### Three consequences

**1. The module install step disappears.** On Nexus 1.3.1 there is no `installModule`, no
`ModuleEnableMode` signature, and no `onInstall` transaction. The batch arrives as UserOp `callData` and
goes through the account's ordinary signature validation. That is *stronger* authorisation than the
module path, not weaker, because there is no second contract in the trust boundary.

This is the spec's fourth integration shape, native inheritance. It appears on the rejected list in
[03-module-integration.md](../03-module-integration.md) as "requires forking Nexus", which is no longer
true: Biconomy shipped it.

**2. ADR-0003 is satisfied by the native path for free.** Native `_executeComposable` runs inside the
account's own context, so `msg.sender` at the `Storage` call is the account and the namespace is
`keccak256(account, account)` — precisely what ADR-0003 chose, with no configuration required.

**3. The earlier `supportsExecutionMode` revert was a red herring.** That selector, `0xd03c7914`, comes
from `main`, and it is **not in the dispatcher of any deployed Base Sepolia build**. Verifying a deployed
contract against `main` is the mistake; the bytecode survey is the correction.

| ID | Item | Level | Finding |
|---|---|---|---|
| **V-19** | `supportsExecutionMode(bytes32)` on deployed builds | `VERIFIED ABSENT` | Selector `0xd03c7914` appears in `main` but in none of the deployed Base Sepolia dispatchers. Do not use it as a capability probe here |
| **V-20** | MEE version versus Nexus account version | `VERIFIED` | Different axes. The docs' `2.2.x` is the **MEE deployment** version. The **account** on Base Sepolia is Nexus `1.3.1`. Earlier drafts of this set conflated them |
| **V-21** | Empty `STATIC_CALL` return routed into `VALUE` | `FOUND` | A `STATIC_CALL` fetcher whose target returns no data does not revert, so the fetch succeeds and the empty bytes are then routed into the `VALUE` return type. The observable result is an **empty revert with no error selector**. Real and reachable, but unclassifiable by a caller: there is nothing in the revert data to match against |
| **V-22** | Absurd `returnValues` count in a capture | `FOUND` | A capture asking for more return words than the call actually produced ends in `Panic(uint256)` or an empty revert rather than `InsufficientReturnData` |

### Still open

| ID | Item | Blocks | Confirm by |
|---|---|---|---|
| V-01 | MEE version usable on Base Sepolia | MEE execution path | `createMeeClient` against Base Sepolia staging |
| **V-06** | DEX router address on Base Sepolia | `VERIFIED` | See the DEX table below. Real liquidity confirmed |
| **V-07** | Lending pool address on Base Sepolia | `VERIFIED, WITH A CAVEAT` | See the lending table below. WETH is a listed market; **USDC is not** |
| **V-23** | The address Uniswap labels `QuoterV2` on Base Sepolia is not a `QuoterV2` | `FOUND` | See below. Blocks the live slippage demo |
| V-10 | Enum ordering stable across MEE versions | Encoding correctness | Diff `ComposabilityDataTypes.sol` on upgrade |
| V-17 | Storage address matches the SDK constant | Capture correctness | One-line comparison |

## Promotion procedure

1. Confirm the value against primary source or an on-chain query.
2. Move the row to the resolved table, set the level, cite the evidence.
3. Update every file that references it. `grep` for the old value.
4. Record the confirmation in the commit that made it.

Downgrading is equally allowed. If a promoted value proves wrong, move it back and note what misled us.
That note is worth more than the value was.

## V-06, DEX on Base Sepolia

All three cross-checks pass, so the addresses are not merely present but mutually consistent.

| Contract | Address | Evidence |
|---|---|---|
| `UniswapV3Factory` | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `eth_getCode` returns 49,073 B |
| `SwapRouter02` | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` | 48,997 B, and `factory()` returns the factory above |
| `QuoterV2` (as labelled) | `0xC5290058841028F1614F3A6F0F5816cAd0df5E27` | 16,549 B, and `factory()` returns the factory above. **But see V-23** |

WETH is `0x4200000000000000000000000000000000000006` and USDC is `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (V-09).
Pools exist for every standard fee tier, with non-zero liquidity:

| Fee | Pool | `liquidity()` | `slot0` sqrt price |
|---|---|---|---|
| 500 | `0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0` | 4.48e11 | 6.275e33 |
| 3000 | `0x46880b404CD35c165EDdefF7421019F8dD25F4Ad` | 3.11e14 | 6.154e33 |
| 10000 | `0x4664755562152EDDa3a3073850FB62835451926a` | 5.77e10 | 3.392e32 |

The 3000 pool reports `token0` USDC, `token1` WETH, `fee()` 3000 and `tickSpacing()` 60, and the
factory agrees with `feeAmountTickSpacing(3000) == 60`. So the DEX leg of the demo has real liquidity
and **V-06 is closed**. No `MockERC20` pair is needed.

## V-07, lending on Base Sepolia

Aave V3 *is* deployed on Base Sepolia, from the canonical `aave-address-book` entry
`AaveV3BaseSepolia.sol`, and the provider agrees with the pool:

| Contract | Address | Evidence |
|---|---|---|
| `PoolAddressesProvider` | `0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00` | 6,698 B |
| `Pool` | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` | 1,854 B, and `getPool()` on the provider returns exactly this |
| `AaveOracle` | `0x943b0dE18d4abf4eF02A85912F8fc07684C141dF` | 2,663 B |
| `PoolDataProvider` | `0xBc9f5b7E248451CdD7cA54e717a2BFe1F32b566b` | 7,436 B |

**The caveat, and it changes the demo.** `getReservesList()` returns 32 markets. **WETH is one of
them; USDC is not.** `getAToken(USDC)` reverts and `getReserveConfigurationMap(USDC)` reverts, while
`getReserveData(WETH)` on the Pool returns a populated record with non-zero liquidity index and
current liquidity.

| Asset | Listed market | Supply step usable |
|---|---|---|
| WETH `0x4200…0006` | Yes | Yes |
| USDC `0x036C…dCF7e` | No | No |

So the demo supply step must fund and supply **WETH**, not USDC. Any runbook text that supplies USDC
will revert with Aave's `RESERVE_NOT_EXIST`, and that is a configuration mistake rather than a bug.

Also note: the frequently cited `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` is Aave's **Base mainnet**
Pool. It has no code on Base Sepolia, so reusing it here would fail.

## V-23, the Base Sepolia "QuoterV2" is not a `QuoterV2`

Uniswap's Base deployments table lists `0xC5290058841028F1614F3A6F0F5816cAd0df5E27` as `QuoterV2`.
The deployed bytecode disagrees. Checking the dispatch table directly:

| Signature | Selector | In code |
|---|---|---|
| `quoteExactInputSingle(address,address,uint256,uint24,uint160)` | `0x1296323f` | **no** |
| `quoteExactInputSingle(address,address,uint256,uint160)` | `0x2d9ebd1d` | no |
| `quoteExactInputSingle(address,address,uint24,uint256,uint160)` | `0xf7729d43` | no |
| `quoteExactInput(bytes,uint256)` | `0xcdca1753` | **yes** |

So it is a `Quoter` in the older shape. Worse, calling `quoteExactInput` reverts with
`call to non-contract address 0x1015857bF71E7C0C4a9389654c63F2C5728e2593`: the older quoter derives the
pool address by `CREATE2` from a hard-coded init-code hash, and Base Sepolia's pools were deployed
from a different one, so it computes an address with no code. `0x1015857b…` has `eth_getCode == 0x`.

**Consequence.** `QuoterGuard` calls `quoteExactInputSingle(address,address,uint256,uint24,uint160)`,
which is the correct `IQuoterV2` interface. Against Base Sepolia today that call does not exist, so
the guard cannot be pointed at real liquidity yet. This does **not** affect the guard's correctness,
which is covered by 24 unit tests and 4 invariants against `MockQuoter`; it affects only whether the
demo can compute a live slippage bound on this chain. Options, in order of preference:

1. Point the guard at a quoter that really is V2. None is verified on Base Sepolia yet, so this needs
   a fresh check rather than an assumption.
2. Deploy a `QuoterV2` against the existing factory. The init-code hash then matches the pools by
   construction, and the guard's interface is unchanged.
3. Keep `MockQuoter` for the demo and state plainly that the slippage bound is not live.

Option 2 is the one that preserves the property the project exists to demonstrate, and it is the
reason this finding matters beyond the demo.

## What the fuzzer classifies as a pass

`test/fork/EncodingFuzz.t.sol` accepts three outcomes: a resolved execution, a revert carrying one of
the twelve documented errors, and an "understood failure", which is `Panic(uint256)` or an empty
revert.

That third bucket started as a convenience and turned out to be load-bearing. **V-21** and **V-22** are
the two cases that actually land in it, and they are the reason it is not a loophole:

| Outcome | Meaning |
|---|---|
| Resolved | The engine composed an `Execution` consistent with its own rules |
| One of twelve documented errors | A failure mode the SDK surfaces with a usable message |
| `Panic(uint256)` or empty revert | Understood, but **not** attributable. Counted and named separately, never as a clean pass |

Any revert outside those three is a finding. Keeping the third bucket explicit is the point: a suite
that silently treats every unexpected revert as acceptable would have passed both V-21 and V-22 and
reported nothing.

## Reusable probe

```bash
RPC=https://base-sepolia.publicnode.com   # or sepolia.base.org

code(){ curl -s -m 12 -X POST "$RPC" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$1\",\"latest\"]}" \
  | python3 -c 'import json,sys;c=json.load(sys.stdin)["result"];print("MISSING" if c=="0x" else str((len(c)-2)//2)+"B")'; }

call(){ curl -s -m 12 -X POST "$RPC" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$1\",\"data\":\"$2\"},\"latest\"]}"; }
```

Selectors used in this round, computed locally and confirmed against the live contracts:

| Signature | Selector |
|---|---|
| `isModuleType(uint256)` | `0xecd05961` |
| `getEntryPoint(address)` | `0x5e765374` |
| `getNamespace(address,address)` | `0x882694b4` |
| `latestRoundData()` | `0xfeaf968c` |
| `decimals()` | `0x313ce567` |
| `supportsExecutionMode(bytes32)` | `0xd03c7914` |
| `getEntryPoint()` | `0x0a664dba` |
| `accountId()` | `0x9cfd7cff` |
| `isValidSignature(bytes32,bytes)` | `0x1626ba7e` |

`isValidSignature(bytes32,bytes)` hashing to `0x1626ba7e` matches `ERC1271_MAGICVALUE` in Nexus's
`Constants.sol`, which is an independent check that the selector computation was correct.