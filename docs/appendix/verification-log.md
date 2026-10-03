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
| **V-04** | Obtaining a Nexus account for the demo | **`PARTIAL`** | EIP-7702 delegation to the verified account works and is not sufficient. The account rejects composable calls with `InvalidModule(address(0))`. See below |
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
| **V-19** | `supportsExecutionMode(bytes32)` as a capability probe | `VERIFIED UNUSABLE` | Selector `0xd03c7914` **is** deployed on both Nexus builds and returns `true` for every mode, including on the 1.2.0 build that has no `executeComposable`. Never use it as a probe: see below |
| **V-20** | MEE version versus Nexus account version | `VERIFIED` | Different axes. The docs' `2.2.x` is the **MEE deployment** version. The **account** on Base Sepolia is Nexus `1.3.1`. Earlier drafts of this set conflated them |
| **V-21** | Empty `STATIC_CALL` return routed into `VALUE` | `FOUND` | A `STATIC_CALL` fetcher whose target returns no data does not revert, so the fetch succeeds and the empty bytes are then routed into the `VALUE` return type. The observable result is an **empty revert with no error selector**. Real and reachable, but unclassifiable by a caller: there is nothing in the revert data to match against |
| **V-22** | Absurd `returnValues` count in a capture | `FOUND` | A capture asking for more return words than the call actually produced ends in `Panic(uint256)` or an empty revert rather than `InsufficientReturnData` |

### Still open

| ID | Item | Blocks | Confirm by |
|---|---|---|---|
| V-01 | MEE version usable on Base Sepolia | MEE execution path | `createMeeClient` against Base Sepolia staging |
| **V-06** | DEX router address on Base Sepolia | `VERIFIED` | See the DEX table below. Real liquidity confirmed |
| **V-07** | Lending pool address on Base Sepolia | `VERIFIED, WITH A CAVEAT` | See the lending table below. WETH is a listed market; **USDC is not** |
| **V-23** | Quoter for Base Sepolia | `VERIFIED ABSENT` | No deployed contract answers `quoteExactInputSingle`. Uniswap's docs list `0xC529…E27` as the Base Sepolia QuoterV2, but its bytecode is not a QuoterV2. See below |
| **V-24** | The module will not execute composed calls for a codeless caller | `FOUND, CAUSE IDENTIFIED` | Not an encoding bug. Needs a deployed account (V-04). Blocks demo steps 3-6 |
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

**The caveat, and it changes the demo.** `getReservesList()` returns **6** markets. **WETH is one of
them; USDC is not.** `getAToken(USDC)` reverts and `getReserveData(USDC)` reverts, while
`getReserveData(WETH)` on the Pool returns a populated record with non-zero liquidity index and
current liquidity. The list is identical at the pinned block `47_590_000` and at `latest`.

| # | Market |
|---|---|
| 1 | `0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f` |
| 2 | `0x0a215d8ba66387dca84b284d18c3b4ec3de6e54a` |
| 3 | `0x54114591963cf60ef3aa63befd6ec263d98145a4` |
| 4 | `0x4200000000000000000000000000000000000006` **WETH** |
| 5 | `0xd171b9694f7a2597ed006d41f7509aad4b485c4b` |
| 6 | `0x810d46f9a9027e28f9b01f75e2bdde839da61115` |

An earlier reading of this call reported 32 markets. That was a decode error: a dynamic `address[]`
is encoded as `[offset][length][elements]`, and reading word 0 as the length reads the offset, which
happens to be `0x20`. The count of 6 was confirmed by decoding both words at two block heights.
`test_aaveListsWethButNotUsdc` in `test/smoke/LiveSmoke.t.sol` now parses both words, so this
particular mistake cannot recur silently.

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

## V-04, delegation reaches the account but cannot make it composable

V-04 was recorded as VERIFIED on the strength of one line: the singleton "is the EIP-7702 delegation
target". Nothing had demonstrated that delegation reaches it. It does -- and that turned out to be the
easy half.

**Delegation works.** On a Base Sepolia fork, an EOA signs an authorization to
`0x0000000020fe2F30453074aD916eDeB653eC7E9D` and then answers `accountId()` as
`biconomy.nexus.1.3.1`, the build V-04 verified. The EOA is no longer codeless: its code is a 23-byte
`0xef0100 || address` designator. That designator is not a copy of the runtime, which is why an
earlier reading of `code.length` as "delegation failed" was wrong.

**Delegation is not sufficient.** Two distinct refusals, both named rather than inferred:

| Call | Result | Selector |
|---|---|---|
| delegated account, `executeComposable([])` | reverts | `0xac52ccbe` `AccountAccessUnauthorized()` |
| `MODULE.executeComposableCall(approveStep)` | reverts, 36 bytes | `0xb927fe5e` `InvalidModule(address)` |

The second is the decisive one. `InvalidModule(address)` lives in the **account**, not the module
(verified by selector presence in each bytecode), and its argument is `address(0)`. The composability
module is not installed on `0x…7E9D`. Delegating to it does not install it, and that account is not
ours, so we cannot install it ourselves.

So V-04 splits in two. Delegation answers *how the demo's account will execute* — one signed
authorization, no separate deployment. It does not answer *how we obtain an account with the module
installed*. That needs the Nexus factory or bootstrap on Base Sepolia, which Biconomy publishes for
mainnet and which has not yet been located for chain 84532.

Measured by `test/fork/NexusDelegationProbe.t.sol` and the approve-step probe in
`test/fork/DemoBatch.t.sol`. Both report rather than assert where the answer is still open, so neither
can fail while V-04 remains partial.

One methodological note, since this file has been wrong in the same way more than once. An earlier
probe used a codeless address as its control and read the resulting *success* as "the codeless path is
fine". A call to an address with no code cannot fail. It measured nothing, and its name asserted the
opposite of what it checked. `test_codelessCallSucceedsTriviallyAndMeansNothing` keeps the mistake
visible.

## V-25, Uniswap's Quoter cannot be reached from a view function

Found while writing the test V-23 called for. `QuoterGuard._quote` reaches its quoter with a
`staticcall`, and against Uniswap's real Quoter that fails on every chain:

```
StateChangeDuringStaticCall
```

Not a wrong address and not a wrong selector. `Quoter.quoteExactInputSingle` calls
`IUniswapV3Pool.swap`, which emits a `Swap` event, and `LOG` is forbidden inside a static context.
The same applies to `QuoterV2`, since it inherits the same body. Both quoters are therefore usable
from `eth_call` and off-chain tooling only.

Verified both directions on Base Sepolia against Uniswap's own bytecode, deployed from the pinned
v3-periphery v1.0.0 tag:

| Reach | Result |
|---|---|
| `CALL` | **0.095452706967269650 WETH** for 15 USDC against the fee-3000 pool |
| `STATICCALL` | reverts, always |

The tempting fix is to swap `staticcall` for `call`. That is worse than the bug. `QuoterGuard` takes
the quoter address as an *argument*, so a `call` would hand an arbitrary caller-chosen contract the
ability to mutate chain state in the middle of a function that is `view`, and to re-enter while it
does. A quoter is a view surface by definition; letting one write is the vulnerability, not the fix.

So the resolution is architectural, and it is the one this project already leans toward elsewhere:
quote **off-chain**, where the discarded state change is harmless, and enforce the resulting bound
**on-chain**. The demo already carries `amountOutMin` as a signed literal in the batch, so the bound
is present in calldata; the guard's job is to enforce it, which needs no quoter at all. The quoter
read is the redundant half.

Until that split is made, `QuoterGuard` against a real Uniswap Quoter will keep reverting with
`ZeroQuote`. That is recorded here rather than papered over, and
`test_theGuardCannotReadLiveLiquidityAndThatIsDocumented` fails if the situation ever changes, so the
constraint can be revisited when it is genuinely safe to.

## V-23, the documented QuoterV2 is not a QuoterV2

**Corrected twice.** The entry previously recorded `0xC5290058841028F1614F3A6F0F5816cAd0df5E27` as
"codeless". Both parts of that were wrong. It has 8,273 bytes of code, and Uniswap's own Base
deployments page lists that address as the Base Sepolia **QuoterV2**.

It is not one. Selectors, computed rather than recalled:

| Selector | Function | Present in `0xC529…` |
|---|---|---|
| `0x1296323f` | `quoteExactInputSingle(address,address,uint256,uint24,uint160)` | **no** |
| `0x9b5e78b7` | `quoteExactInput(bytes,uint256[])` | **no** |
| `0xcdca1753` | `quoteExactInput(bytes,uint256)` — not a Uniswap signature | yes |

So the only match is a function name Uniswap does not have, while both real entry points are absent.
The EIP-1967 implementation slot is zero, so it is not a proxy pointing at the real thing, and 8,273
bytes is roughly a third of the ~24 KB a genuine QuoterV2 occupies. Calling it reverts.

Two corrections of method are worth more than the finding:

An earlier revision of this log asserted that `quoteExactInput` had selector `0xcdca1753`. That
selector was computed from `quoteExactInput(bytes,uint256)` — the wrong parameter type. The real
signature takes `uint256[]`. A selector quoted from memory rather than `cast sig` is a guess wearing a
hex literal's clothing, and it is what made this address look plausible in the first place.

`grep` for a selector in `eth_getCode` output must lowercase the hex first. `cast code` returns
checksummed hex, so a lowercase selector silently never matches, and the resulting "absent" reading is
indistinguishable from a genuine absence. Both faults reported a false negative, and a false negative
here is the dangerous direction: it made a live, reachable contract look like empty code.

`IQuoterV2` in this repository declares `quoteExactInputSingle`, which no contract on Base Sepolia
implements. Either the interface moves to the bytes API or LATCH deploys its own quoter. Until then
`QuoterGuard` cannot read live liquidity, and the guard's own docstring already says a quoter view is
not a guarantee anyway — so this is a real gap in the demo, not a cosmetic one.

## V-19, supportsExecutionMode is worse than absent

**Corrected.** An earlier revision of this entry recorded the selector `0xd03c7914` as absent from
every deployed Base Sepolia dispatcher, on the grounds that it appears only in `main`. Both halves of
that were wrong. Re-checked against the chain:

| Address | `supportsExecutionMode` in bytecode | `executeComposable` in bytecode |
|---|---|---|
| Nexus 1.3.1 `0x…7E9D` | **present** | present |
| Nexus 1.2.0 (wrong build) `0x…23B03` | **present** | **absent** |
| Composability module | absent | present |

And it is not merely present but useless. `supportsExecutionMode(bytes32)` returns `true` for every
mode tested, `0` through `3`, on **both** builds:

```
Nexus 1.3.1   mode 0 true   mode 1 true   mode 2 true   mode 3 true
Nexus 1.2.0   mode 0 true   mode 1 true   mode 2 true   mode 3 true
```

So the conclusion survives — do not use it as a capability probe — but the reason is the opposite of
what was recorded, and the new reason is worse.

An absent selector fails loudly: the call reverts, which a client can handle. This one succeeds and
lies. A client that trusted it would conclude the 1.2.0 account supports composable execution, sign a
batch against it, and watch it fail on-chain. A probe that returns `true` for a capability the build
does not have is more dangerous than no probe at all, because it converts an unknown into a false
positive.

The correct probe is `executeComposable(ComposableExecution[])` itself: selector `0x7eba07b8`, present
on 1.3.1 and absent on 1.2.0. It is checked in the deploy script's pre-flight, which is why that
script refuses the wrong build.

## V-24, the approve step does nothing visible

**Not an encoding bug.** An earlier revision of this entry left the cause open between two candidates.
A fork experiment narrowed it, and the answer is neither: the module will not execute composed calls
on behalf of an address with no code.

### What was measured

All at block `47_590_000`, called as `ACCOUNT = 0x1234…7890`, which has **no code** on the fork:

| Entry | Shape | Result |
|---|---|---|
| Demo step 1 | `STATIC_CALL` on `FeedGuard`, no TARGET | Executes. Freshness gate returns 1 |
| Demo step 2 | `BALANCE`, no TARGET | Executes. USDC balance gate passes |
| Demo step 3 | TARGET `USDC`, `CALL_DATA`, `STATIC_CALL` | **Reports success, creates no allowance** |
| Probe | TARGET a freshly deployed recorder, `CALL_DATA` | **Reverts with empty return data**, `calls == 0` |

The last two rows are the informative ones. An unknown target reverts *before* composing anything --
the recorder's call count stays 0, so no composed call was attempted. A known token target reports
success and still moves nothing. Both are consistent with the module needing a real account to
dispatch through, and neither is consistent with a malformed batch.

### What this rules out

- **Not the encoding.** `ACCOUNT` lacking code is independent of the bytes. Every structural check in
  `ComposableExecutionLib` passed, the `STATIC_CALL` resolved correctly, and the composed calldata was
  assembled without a revert.
- **Not V-23.** The quoter plays no part in step 3; the amount comes from `balanceOf`.

### What it means

The demo needs a **deployed account** with the composability module installed, which is the first row
of CHECKLIST's deployment table and is blocked on V-04 plus a funded key. Until one exists, steps 3
through 6 cannot be demonstrated on this chain, and no amount of client work changes that.

`test_knownBlocker_approveCreatesNoAllowance` asserts only what is true: no allowance was created and no
value moved. It is deliberately not asserting that the step works. A test asserting a bug would be
worse than no test, because it would fail the moment the bug was fixed and read as a regression.

### How to confirm

Deploy a Nexus 1.3.1 account on Base Sepolia with the module installed, then re-run
`test/fork/DemoBatch.t.sol` against it. The three hypotheses to expect, in order of likelihood: the
module dispatches through the account and there is no account here; the module requires the caller to
be a registered account type; or the account must hold an ERC-4337 entry point configured. All three
resolve by getting a real account onto the chain, which is why that is now the recommendation rather
than further bytecode reading.

## Three bugs the live module found that no client-side test could

Every test in `client/` passed throughout, because every one of them encodes and decodes with the same
code on both sides of the comparison. Running the batch against the deployed module was the only thing
that could catch these:

| Bug | Client-side appearance | On-chain effect |
|---|---|---|
| `words()` returned a `0x`-prefixed string concatenated after a selector | Encodes, validates, round-trips | A literal `0x` in the middle of the calldata |
| The selector was placed in the `CALL_DATA` param instead of `functionSig` | Encodes, validates, round-trips | A call to selector `0x00000000` |
| `target()` emitted a 20-byte address instead of a 32-byte word | Encodes, validates, round-trips | `abi.decode(paramData, (address))` reverts, with empty return data |

And one design error, which no bug could catch because it was a misreading of the encoding:

| Design error | Why it matters |
|---|---|
| A constraint on a `RAW_BYTES` param is checked against the *literal bytes the signer supplied*, not against a call result. The freshness gate therefore had to be a `STATIC_CALL` | `callData(isFresh(...), [eq(1)])` compares `1` against the feed's own address, fails every time, and reports a perfectly fresh feed as stale |

A batch can be byte-perfect, pass every structural check, satisfy every documented length rule, and
still mean the wrong thing. Only executing it settles what it does.

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
| **V-25** | Reading Uniswap liquidity from `QuoterGuard` on-chain | `VERIFIED IMPOSSIBLE** | Uniswap's Quoter emits an event via `pool.swap`, so `STATICCALL` can never reach it. See below |
