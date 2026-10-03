---
title: Testing strategy
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R1, R2, R4, R12, D1)
---

# Testing strategy

Four layers, ordered by what they prove. Foundry for the contracts, viem for the client, simulation for
the integration, and a live smoke test for the demo.

| Layer | Tool | Proves | Runs in CI |
|---|---|---|---|
| A — Unit | Foundry | Encoding correctness, constraint semantics, helper verdicts | Yes, every commit |
| B — Integration | Foundry, forked | Module and account integration end to end | Yes, every commit |
| C — Property | Foundry invariant + fuzz | Behaviour under arbitrary inputs | Yes, nightly |
| D — Live | Base Sepolia | The demo actually works | On demand |

Layer C is where a project like this finds its real bugs. The encoding has enough footguns
([02](02-erc8211-spec-notes.md)) that a hand-written table of happy-path tests will miss the malformed
cases, and a malformed encoding that passes validation is a critical bug.

## Layer A — unit tests

### A1. Constraint semantics

Every constraint type, against the real `_checkConstraint`, not a reimplementation.

| Test | Input | Expectation |
|---|---|---|
| `EQ` match | value `100`, ref `100` | pass |
| `EQ` mismatch | value `100`, ref `101` | `ConstraintNotMet(EQ)` |
| `GTE` boundary | value `100`, ref `100` | pass |
| `GTE` below | value `99`, ref `100` | `ConstraintNotMet(GTE)` |
| `LTE` boundary | value `100`, ref `100` | pass |
| `IN` inclusive | value `100`, ref `(100, 200)` | pass |
| `IN` reversed bounds | ref `(200, 100)` | `InvalidConstraintRange` |
| `GTE_SIGNED` negative | value `-5` as `bytes32`, ref `bytes32(int256(-10))` | pass |
| `GTE` on negative | same value, unsigned `GTE` | pass, and this is the documented trap |
| `IN_SIGNED` negative range | value `-5`, ref `(-10, 10)` | pass |
| `OR` first branch | children `(EQ 0, GTE 100)`, value `0` | pass |
| `OR` second branch | children `(EQ 0, GTE 100)`, value `100` | pass |
| `OR` no branch | children `(EQ 0, GTE 100)`, value `50` | `ConstraintNotMet(OR)` |
| `OR` nested | child is `OR` | `InvalidConstraintType` |
| `OR` empty | empty sub-array | `EmptyOrSubConstraints` |
| `OR` structure check order | invalid child after a matching child | `InvalidConstraintType`, not pass |
| `SKIP` empty payload | ref `""` | pass |
| `SKIP` non-empty payload | ref `bytes32(0)` | `InvalidReferenceDataLength` |
| Leaf wrong payload length | `EQ` with 31 bytes | `InvalidReferenceDataLength` |

The two tests worth singling out: **`GTE` on a negative value passes**, which is correct behaviour and a
real footgun; and **`OR` rejects a nested `OR` before evaluating any child**, which is what keeps
off-chain rendering consistent with on-chain behaviour.

### A2. Fetcher encoding

| Test | Encoding | Expectation |
|---|---|---|
| `BALANCE` packed 40 bytes | `abi.encodePacked(token, account)` | resolves |
| `BALANCE` ABI-encoded 64 bytes | `abi.encode(token, account)` | `InvalidParameterEncoding("Invalid paramData length")` |
| `BALANCE` native | token `address(0)` | returns `account.balance` |
| `BALANCE` two constraints | 2 constraints | `InvalidSetOfInputParams("BALANCE supports at most 1 constraint")` |
| `BALANCE` with `GTE` | 1 constraint | passes or fails on the value |
| `TARGET` with `BALANCE` | fetcher `BALANCE` | `InvalidParameterEncoding("BALANCE fetcher type is not supported for TARGET param type")` |
| Duplicate `TARGET` | two `TARGET` params | `InvalidSetOfInputParams("TARGET param type can only be set once")` |
| Duplicate `VALUE` | two `VALUE` params | same for `VALUE` |
| `STATIC_CALL` reverting target | target reverts | `ComposableExecutionFailed` |
| `STATIC_CALL` empty return | returns nothing | `InsufficientRawValue` with any constraint |
| `RAW_BYTES` short value | 16 bytes with 1 constraint | `InsufficientRawValue` |

### A3. `FeedGuard`

| Test | Setup | Expectation |
|---|---|---|
| Fresh round | `updatedAt = block.timestamp` | `1` |
| Exact boundary | `updatedAt = block.timestamp - maxStaleness` | `1`, inclusive |
| One second past | `updatedAt = block.timestamp - maxStaleness - 1` | `0` |
| Zero timestamp | aggregator returns zeros | `0` |
| Zero answer | `answer = 0` | `0` |
| Negative answer | `answer = -1` | `0` |
| Future timestamp | `updatedAt = block.timestamp + 1` | `0` |
| Unanswered round | `answeredInRound = roundId - 1` | `0` |
| Live heartbeat | `vm.warp` past 1200s, mock updates | `1` |
| No state written | run, then assert storage unchanged | Pass |
| `answerIfFresh` stale | stale feed | reverts `StaleFeed`
| `answerIfFresh` returns one word | any feed | `abi.encode` length is exactly 32 |
| `answerIfFresh` fresh | current round | equals `latestRoundData().answer` |
| Sequencer down (mainnet) | sequencer answer `1` | `0` |
| Sequencer grace period | sequencer just came up | `0` |

### A4. `QuoterGuard`

| Test | Setup | Expectation |
|---|---|---|
| Slippage applied | quote `1000`, 50 bps | `995` |
| Zero slippage | quote `1000`, 0 bps | `1000` |
| Rounding down | quote `999`, 1 bps | `998`, never `999` |
| Slippage above 100% | `slippageBps = 10001` | reverts on the subtraction |
| Zero quote | amountOut `0` | reverts `StaleQuote` |

### A5. Slot derivation

| Test | Expectation |
|---|---|
| `valueSlot(i)` for `i` in 0..n | matches `keccak256(abi.encodePacked(baseSlot, uint256(i)))` |
| Namespace | `getNamespace(account, account)` equals the expected constant |
| Two accounts, same base slot | different final slots |
| Uninitialised read | reverts `SlotNotInitialized` |

## Layer B — integration tests

Forked Base Sepolia or a local Nexus deployment.

| Test | Proves |
|---|---|
| Install module as executor, verify `isInitialized` | Installation flow |
| Install as fallback, verify selector routing | `executeComposable` is reachable |
| `executeComposableCall` absent from fallback selectors | T4 mitigation |
| Two-entry batch, second reads the first's `BALANCE` | Core primitive |
| Captured return value read via `STATIC_CALL` `readStorage` | Capture channel |
| Post-write `staticCall` capture sees new state | `STATIC_CALL` output fetcher |
| Batch with a failing constraint in entry 3 | Entire batch reverts. Assert no state changed anywhere |
| Fetcher reverting mid-batch | Whole batch reverts |
| Namespace identical from two distinct senders | T8 mitigation |
| Uninstall, then attempt a batch | Batch unreachable, no funds stranded |
| `FailSafeExecutor`: skipped segment with no dependent reader | Batch completes |
| `FailSafeExecutor`: skipped segment with a dependent reader | Whole batch reverts. T12 mitigation |
| `FailSafeExecutor`: predicate entry marked `SKIP_CALL` | Rejected at validation |
| Gas snapshot | Regression visibility |

The "assert no state changed anywhere" assertion is the one most often skipped and the most important.
Snapshot every relevant balance and storage slot before, and compare after any expected revert.

## Layer C — property and fuzz tests

| Target | Invariant |
|---|---|
| Fetcher encoding | No `paramData` length other than the three valid forms resolves successfully |
| Constraints | A reverted constraint never leaves partial state |
| `FeedGuard` | `isFresh` never reverts on a well-formed aggregator |
| `FeedGuard` | `isFresh` returns only `0` or `1` |
| Slot derivation | Distinct `(account, baseSlot, index)` triples never collide across 10k samples |
| Builder | A batch with more than `MAX_ENTRIES` is rejected client-side |
| Decoder | For any valid batch, the decoder renders every constraint with its operator |
| ABI codec | The TypeScript encoder is byte-identical to Solidity's `abi.encode` over the same struct |

### As built

`forge 1.8.4`, full suite **0 failures**. The count moves as suites are added; `forge test` prints
it on the last line of every run, so read it there rather than from this page.

| Suite | File | What it proves | Result |
|---|---|---|---|
| `FeedGuard` | `test/property/FeedGuard.invariant.t.sol` | Verdict is only `0` or `1`; verdict equals the round's fields recomputed independently; verdict form never reverts; value form is exactly one word; both forms agree; reading the guard writes no state | 6 invariants, 3,072 calls, 0 reverts |
| `FailSafeExecutor` | `test/property/FailSafeExecutor.invariant.t.sol` | Account storage is never corrupted; the EntryPoint never moves; a direct call is always refused | 3 invariants, 3,072 calls, 0 reverts |
| `QuoterGuard` | `test/property/QuoterGuard.invariant.t.sol` | Basis-point scaling never overflows, including at `type(uint256).max`; a tighter tolerance never loosens the bound; the bound never exceeds the quote; the return is one word | 4 invariants, 3,072 calls |
| Slot derivation | `test/property/SlotDerivation.t.sol` | The native key never equals a module key; distinct modules and distinct accounts are separated; poison slots are distinct; `abi.encodePacked` cannot be confused for `abi.encode`, nor an address for a `uint256` | 10 tests |
| Live encoding | `test/fork/EncodingFuzz.t.sol` | Every fuzzed encoding either resolves or reverts for an understood reason | 18 tests |

Offline, the fork suite **skips** rather than fails, so `forge test` remains useful without an
endpoint. Run the fork suite with `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test`.

### Two invariants that were wrong before they were right

Both are recorded because both were faults in the *tests* rather than in the contracts, and both
produced failures that pointed squarely at the contract.

**1. A handler call counter proved nothing.** `invariant_handlerActuallyPushes` asserted
`handler.pushes() > 0`. The counter read `0` after 3,072 reported calls, while the handler behaved
correctly whenever it was driven directly. The counter was measuring the wrong thing entirely.
It was replaced by `test_bothVerdictsAreReachable`, which asserts that one scripted walk produces
verdicts `1`, `0`, and `0` for a fresh, a stale, and an uninitialised feed. Non-vacuity *by
construction* beats non-vacuity *by measurement*.

The same test also had a second, subtler fault: it compared the guard's verdict against a copy of the
round that the handler had recorded earlier. That copy goes stale as soon as the handler resets or the
clock moves, so it reported a guard bug that did not exist. The invariant now reads the oracle live,
exactly as the guard does.

**2. Every randomised action was reverting at the door, and the invariants still passed.** The
`FailSafeExecutor` handler is neither the EntryPoint nor the account, so `account.execute` refused
every call. The invariants were green over a run in which nothing had executed. Fixed by having the
handler impersonate EntryPoint v0.7, so actions enter through the same authorisation path a real UserOp
takes.

A green invariant suite over a run in which every action reverted is the single most dangerous outcome
in this document, and it is not detectable by reading the output. Every handler therefore asserts its
own postconditions after each action, and `FailSafeHandler._dispatch` checks that a reverted batch
unwound every target.

### An independent reference for the arithmetic

`test/helpers/FullMath.sol` implements a wide `mulDiv` for the `QuoterGuard` invariants. It
deliberately shares no logic with `QuoterGuard._scaleByBps`: it splits the *multiplicand* into 128-bit
halves where the contract decomposes on the *divisor*. A reference implementation that reused the
contract's decomposition would have agreed with a bug in that decomposition, which is the whole thing
the invariant exists to rule out.

### The client, and why it has its own ABI codec

`client/` holds the builder and decoder. They have **80 tests**, and one of them matters more than the
other seventy-nine combined.

The client cannot encode `ComposableExecution[]` with `viem`. `encodeAbiParameters` routes a nested
tuple into its `bytes` encoder, and that encoder's `size()` helper returns `value.length` for anything
that is not a hex string. A three-field `ComposableExecution` therefore measures as a 3-byte `bytes4`
and the call throws. This is not a fixable declaration: `bytes32` fails identically, and the shape
cannot be avoided, because every `InputParam` carries `bytes` plus `Constraint[]` and every
`ComposableExecution` carries two arrays of those.

So `client/src/abiCodec.ts` is a hand-written codec. And a hand-written codec tested only against
itself proves nothing, because the builder's tests encode and decode with the same code on both sides
and would agree on any layout, right or wrong. Three things had to be true for the codec to be
trustworthy, and each was a real bug found by the check rather than by inspection:

| Layout rule | What happens if you get it backwards |
|---|---|
| An array of **dynamic** tuples encodes `[len][off…][elem…]`, one offset per element | Every subsequent offset shifts. The batch validates, encodes, and fails on-chain |
| Element offsets are measured from **after** the length word | Element 0 lands one word early, on top of the second offset |
| `bytesN` pads on the **right**; `address` pads on the **left** | Both stay 32-byte aligned and both decode, just to the wrong value. A right-padded selector reads back as `0x00000000` |

The guarantee is a committed fixture. `contracts/mocks/ParityBatch.sol` builds one deliberately awkward
batch, `script/EmitAbiFixture.s.sol` writes Solidity's own `abi.encode` of it to
`client/test/fixtures/batch.abi.json`, and three implementations have to agree on those bytes:

| Implementation | Checked by |
|---|---|
| Solidity's encoder | `test/parity/AbiParity.t.sol`, which refuses to regenerate the fixture so a stale one fails |
| The TypeScript encoder | `client/test/abiParity.test.ts` |
| The TypeScript decoder | Same file, by re-encoding what it decoded |

The fixture is written by an explicit script rather than by a test run, because a test that regenerates
its own fixture always passes and leaves the working tree dirty, which would make a change in the wire
format invisible in review.

That fixture also caught a bug in itself. The `OR` payload was first generated as
`abi.encode(c1, c2)` — a two-field tuple — while `ComposableExecutionLib` does
`abi.decode(referenceData, (Constraint[]))`, which expects a length word. Both encode, both decode as
*something*, and neither is rejected. A batch built from that fixture would have taught the client the
wrong layout for every `OR` it ever produced.

Two invariants from the table above are now real tests: `MAX_ENTRIES` (four tests, including that the
limit holds for any value rather than only the default) and "the decoder renders every constraint",
asserted by counting declared constraints against rendered gates so a bound cannot exist in the batch
while being invisible on screen.

The decoder's remaining rules come from `06-frontend-blueprint.md` and are each a test: `SKIP` renders
as `not-checked` rather than `checked`, so a green tick never appears on a field that was never
validated; every operator renders distinctly, so `GTE 100` and `≤ 100` cannot collapse into one tick;
and a `STATIC_CALL` renders as the call that will produce the value, never as a value the client
happens to hold from a simulation.

### Fuzzing the encoding specifically

The most valuable fuzz target in this project: generate arbitrary `paramData` for each fetcher and
assert the contract either resolves correctly or reverts with a documented error. Any *undocumented*
revert is a finding.

```solidity
function testFuzz_BalanceParamData(bytes memory junk) public {
    InputParam memory p = InputParam({
        paramType: InputParamType.CALL_DATA,
        fetcherType: InputParamFetcherType.BALANCE,
        paramData: junk,
        constraints: new Constraint[](0)
    });
    // Expect either success with a 32-byte result, or InvalidParameterEncoding.
    try this.externalProcessInput(p) returns (bytes memory out) {
        assertEq(out.length, 32);
    } catch (bytes memory err) {
        assertEq(bytes4(err, 0), InvalidParameterEncoding.selector);
    }
}
```

Same shape for `STATIC_CALL` and for constraint `referenceData` lengths.

## Layer D — live smoke test on Base Sepolia

Run from [10-deployment-runbook.md](10-deployment-runbook.md). Each step names a command and an
expected observable.

| Step | Observable |
|---|---|
| Deploy `FeedGuard` | Address logged, code present via `eth_getCode` |
| `isFresh` on ETH/USD | Returns `1` |
| `isFresh` after `MockOracle` push out of band | Returns `0` |
| Build the demo batch | Client renders six steps with visible gates |
| `eth_call` simulate | Success, gas estimate returned |
| Simulate with an out-of-band bound | `ConstraintNotMet` |
| Submit | Hash returned |
| Receipt | Status `1`, expected events |
| Verify on the explorer | Six entries, gate events present |
| Namespace check | Slot matches the off-chain computation |

### As built

`test/smoke/LiveSmoke.t.sol`, 13 tests, all against Base Sepolia at block `47_590_000`.

Layer C proves the contracts behave. Layer D proves the *document* is true. Every other layer runs
against mocks, so a wrong address in this repository would pass every test we have and still fail
the demo.
That is the specific failure this layer exists to catch, and it is why three of these tests assert
things that look like defects:

| Test | Asserts |
|---|---|
| `test_liveFeedSatisfiesTheGuardsOwnConditions` | The live ETH/USD round satisfies every condition the guard checks, and pins the round's timestamp and age so the other tests cannot drift onto different data |
| `test_isFreshReturnsOneOnTheLiveEthUsdFeed` | The verdict is `1` |
| `test_isFreshReturnsZeroWhenTheHeartbeatIsTighterThanTheFeedAge` | And `0` for a 30 s heartbeat against a 40 s-old feed, so the first result is not a constant |
| `test_answerIfFreshReturnsExactlyOneWord` | The live return is 32 bytes |
| `test_namespaceMatchesOffChainComputation` | The on-chain namespace matches the local derivation |
| `test_engineResolvesALiveBatch` | A real `BALANCE` batch resolves to the true `balanceOf` |
| `test_outOfBandBoundTripsConstraintNotMet` | A `GTE` bound no account could meet reverts with `ConstraintNotMet` |
| `test_dexAddressesAreCrossConsistentAndLiquid` | V-06: the router points at the factory this repo names, and the pool has liquidity |
| `test_aavePoolIsLiveAndProviderAgrees` | V-07: the provider's `getPool()` returns the pool this repo names |
| `test_aaveListsWethButNotUsdc` | V-07's caveat: WETH is a market, USDC is not |
| `test_baseSepoliaQuoterIsNotQuoterV2` | V-23 still holds: the documented address lacks the interface |
| `test_quoterGuardCannotUseTheBaseSepoliaQuoterYet` | And the practical consequence for the guard |

Two design notes.

**A finding encoded as a test.** `test_baseSepoliaQuoterIsNotQuoterV2` fails if someone deploys a real
`QuoterV2` at the documented address. That is the point. A finding recorded only in prose stops being
true the moment the code changes, and the test's failure message says what to do about it.

**Nothing is submitted.** Every test is read-only or a fork-local deployment, so the suite runs
against a public endpoint with no credentials. It skips cleanly when `BASE_SEPOLIA_RPC_URL` is unset.

With `BASE_SEPOLIA_RPC_URL` set, `forge test` reports 0 failed. Without it the fork and smoke suites
skip themselves rather than failing; [CHECKLIST](../CHECKLIST.md) records the split.

## The web client

`web/` has its own suite, run by vitest against jsdom. It tests the frontend's behaviour rather than
its arithmetic: the decoder's three misleading-rendering rules, the state machine's rejection of
illegal moves, and the ten honesty rules from
[06](06-frontend-blueprint.md) as they apply above the contract.

| Area | What is asserted |
|---|---|
| Decoder | `SKIP` never renders as a pass; the operator is shown; a `STATIC_CALL` shows the call, not a value |
| State machine | Every illegal transition is rejected; editing a preview clears its simulation |
| Chain clients | The write client has no rotating transport and never broadcasts; the two broadcast sites are the injected wallet |
| Pinned addresses | No address literal exists in `src/` outside `core/addresses.ts` |
| Intent signing | The EIP-712 domain binds this app, this chain and this account; a refusal produces a sentence, not a code |

Four gates run before a change leaves `web/`: `npm run typecheck`, `npm test`, `npm run build`, and
`cd ../client && npm test`. The last one is a guard: the frontend must not touch `client/`.

## Coverage targets

| Component | Line | Branch | Note |
|---|---|---|---|
| `FeedGuard` | 100% | 100% | Small enough to be exhaustive. Every branch is a verdict |
| `QuoterGuard` | 100% | 100% | Same |
| `FailSafeExecutor` | 95% | 90% | The unaudited component gets the most scrutiny |
| Builder and decoder | 95% | 90% | A decoder bug misleads users |
| Relayer retry logic | 90% | 85% | Branch-heavy, and a wrong branch burns quota |

Coverage is a floor, not a goal. The boundary tests in A3 and the state-diff assertions in B matter more
than any percentage.

## CI

| Pipeline | Runs |
|---|---|
| `forge build && forge test` | Every commit. Layers A and B |
| `forge test --nmt` + invariant suite | Nightly. Layer C |
| `forge snapshot --check` | Every commit. Gas regression gate |
| Type check and lint | Every commit |
| `cd web && npm run typecheck && npm test && npm run build` | Every commit. Frontend |
| Deploy and smoke | On merge to `main`, Base Sepolia |

The gas snapshot check is the one teams skip and later regret. Constraint and fetcher changes alter gas
silently.

## What we are deliberately not testing

| Skipped | Reason |
|---|---|
| Every protocol integration | We do not control them. Mock the target |
| Real Chainlink behaviour | Mock the aggregator. The feed's correctness is Chainlink's problem |
| Cross-chain execution | Out of scope for the demo. Documented in pattern 6 |
| Formal verification | Not feasible in the time available. Layer C is the substitute |

## Related documents

| Document | Covers |
|---|---|
| [02](02-erc8211-spec-notes.md) | Semantics under test |
| [04](04-constraints-and-oracles.md) | `FeedGuard` invariants |
| [05](05-failure-semantics.md) | `FailSafeExecutor` cases |
| [10](10-deployment-runbook.md) | Layer D commands |
| [06](06-frontend-blueprint.md) | The rules the web suite enforces |
| [11](11-demo-script.md) | The flow the smoke test validates |