---
title: ERC-8211 spec notes
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R1, R2, R4, S1, S2, D1, D2)
---

# ERC-8211 spec notes

The precise behaviour of ERC-8211 "Smart Batching" as implemented in the audited reference
implementation, and the seven encoding footguns that determine how LATCH must be built.

Everything here is stated as of **MEE v2.2.2**, the release that shipped the audited module.
Verified 2026-10-02. Where the upstream draft and the shipped implementation differ, the
implementation is treated as normative, because that is what LATCH will actually call.

## Status

| Property | Value |
|---|---|
| Number | ERC-8211 |
| Title | Smart Batching |
| Track | Standards Track, **draft** |
| Spec source | [ethereum/ERCs PR #1638](https://github.com/ethereum/ERCs/pull/1638), opened 2026-02-11 |
| Authors | Mislav Javor, Filip Dujmušić, Filipp Makarov, Venkatesh Rajendran (Biconomy) |
| Sponsorship | Biconomy with the Ethereum Foundation |
| Audits | Pashov Audit Group, March 2025 and May 2026; Zenith, March 2025. All May 2026 findings resolved |
| Relationship | Layers **above** ERC-4337 or EIP-5792. Not a competitor to them |

## The three primitives

| Primitive | What it does | Spec surface |
|---|---|---|
| Runtime parameter injection | A parameter declares how to obtain its value at execution time | `InputParamFetcherType` |
| Inline constraints | Each resolved value carries bounds checked before it is routed | `ConstraintType` |
| Multi-call context | A shared `Storage` contract carries values between entries and transactions | `OutputParam`, `Storage.sol` |

## Data model

Three enums and four structs, defined verbatim in
[composability-data-types.md](technical-reference/composability-data-types.md). In summary:

```solidity
struct ComposableExecution {
    bytes4 functionSig;
    InputParam[] inputParams;
    OutputParam[] outputParams;
}

struct InputParam {
    InputParamType paramType;            // where the value goes
    InputParamFetcherType fetcherType;    // how the value is obtained
    bytes paramData;                     // fetcher arguments
    Constraint[] constraints;            // bounds on the resolved value
}

struct Constraint {
    ConstraintType constraintType;
    bytes referenceData;                 // 0, 32 or 64 bytes, plus the OR payload
}
```

`paramType` and `fetcherType` are **orthogonal**. A single parameter both chooses how to obtain a
value and where it lands.

| `paramType` | Destination | Reusable |
|---|---|---|
| `TARGET` | call target address | once per entry |
| `VALUE` | ETH forwarded | once per entry |
| `CALL_DATA` | appended to calldata | unlimited |

| `fetcherType` | Mechanism |
|---|---|
| `RAW_BYTES` | literal bytes, optionally validated |
| `STATIC_CALL` | `staticcall` any contract, return its raw return data |
| `BALANCE` | `balanceOf`, or native `balance` when the token is `address(0)` |

## The normative pipeline

For each entry, in order. The spec states this sequence is normative.

1. **Resolve inputs.** Every `InputParam` fetcher fires.
2. **Validate constraints.** Each resolved value is checked. Any failure reverts the batch.
3. **Route and assemble.** Values direct to `TARGET`, `VALUE` or `CALL_DATA`; calldata is built as
   `functionSig` followed by the concatenated `CALL_DATA` contributions.
4. **Execute.** `target.call{value}(calldata)`. **Skipped when `target == address(0)`** — that is a
   predicate entry.
5. **Capture outputs.** Return data optionally written to `Storage` for later entries.

Steps 2 and 3 are interleaved per parameter, not per entry: `processInput` validates that
parameter's constraints before returning its bytes, so a bad parameter stops the entry before
assembly completes.

## Constraint semantics

This is the part most implementations get wrong.

### AND across the array, indexed by word

```solidity
value := mload(add(rawValue, add(0x20, mul(i, 0x20))))
```

`constraints[i]` is compared against the *i*-th 32-byte word of the resolved value. The array is
**ANDed**. To require a range, attach two constraints — `GTE` on index 0 and `LTE` on index 1 would
compare different words, so a range is expressed as two separate `InputParam`s each carrying one
constraint, or as `IN` with a 64-byte payload.

### Bound shapes

| Constraint | `referenceData` | Comparison | Notes |
|---|---|---|---|
| `EQ` | 32 bytes | `bytes32` equality | works for addresses and `bytes32` |
| `GTE` | 32 bytes | unsigned `>=` | passes for every negative value in two's complement |
| `LTE` | 32 bytes | unsigned `<=` | same caveat |
| `IN` | 64 bytes | unsigned range | reverts if `lower > upper` |
| `GTE_SIGNED` | 32 bytes | signed `>=` | value reinterpreted as `int256` |
| `LTE_SIGNED` | 32 bytes | signed `<=` | value reinterpreted as `int256` |
| `IN_SIGNED` | 64 bytes | signed range | reverts if signed `lower > upper` |
| `OR` | `abi.encode(Constraint[])` | any child passes | children must be leaves |
| `SKIP` | **empty** | always true | non-empty payload reverts |

Any leaf whose `referenceData.length != 32` reverts with `InvalidReferenceDataLength`. This catches
`abi.encodePacked` mistakes that would otherwise compare non-canonical encodings.

### OR composition

```solidity
Constraint[] memory subs = new Constraint[](2);
subs[0] = Constraint({ constraintType: ConstraintType.EQ, referenceData: abi.encode(bytes32(uint256(0))) });
subs[1] = Constraint({ constraintType: ConstraintType.GTE, referenceData: abi.encode(bytes32(uint256(100))) });
Constraint memory orC = Constraint({ constraintType: ConstraintType.OR, referenceData: abi.encode(subs) });
// passes iff value == 0 OR value >= 100
```

Empty sub-array reverts `EmptyOrSubConstraints`. A nested `OR` reverts `InvalidConstraintType`, and
the check is a **structural pre-pass**: it runs before any child is evaluated, so rejection does not
depend on whether an earlier leaf happened to match. That keeps off-chain rendering of the signed
payload consistent with on-chain behaviour — which is what makes the decoder in `06` trustworthy.

### SKIP

`SKIP` always returns true and requires an empty payload. It exists so a signer can ignore one
32-byte field while still validating later fields at their fixed positions, without padding with
always-true predicates. When you see it in a `latestRoundData()` constraint array, it means "word 0
is `roundId`, I do not care about it, but I do care about word 1".

**It is not a failure policy.** See [05-failure-semantics.md](05-failure-semantics.md).

### Bounds checking

```solidity
if (rawValue.length < len * 32) revert InsufficientRawValue();
```

Without this, an assembly `mload` past the end of a short return would read adjacent memory and a
zero-threshold predicate would spuriously pass. The output path has the dual guard,
`InsufficientReturnData`.

## Complete error catalogue

Twelve errors, grouped by where they originate.

| Error | Origin | Trigger |
|---|---|---|
| `ConstraintNotMet(ConstraintType)` | `_checkConstraint` path | a constraint evaluated false |
| `InvalidConstraintType()` | `_checkConstraint` | nested `OR`, or an out-of-range enum |
| `InvalidReferenceDataLength()` | `_checkConstraint` | leaf payload not 32 bytes; `SKIP` payload non-empty |
| `InvalidConstraintRange()` | `IN` / `IN_SIGNED` | `lower > upper` |
| `EmptyOrSubConstraints()` | `OR` branch | empty sub-array |
| `InsufficientRawValue()` | `_validateConstraints` | `rawValue.length < constraints.length * 32` |
| `InvalidParameterEncoding(string)` | `processInput` | bad `paramData`, or `BALANCE` for `TARGET` |
| `InvalidSetOfInputParams(string)` | `processInputs`, `processInput` | duplicate `TARGET` or `VALUE`; more than one constraint on `BALANCE` |
| `ComposableExecutionFailed()` | `processInput` | the `STATIC_CALL` fetcher reverted |
| `InvalidOutputParamFetcherType()` | `processOutput` | unknown output fetcher enum |
| `Output_StaticCallFailed()` | `processOutput` | capture-time `staticcall` reverted |
| `InsufficientReturnData()` | `_parseReturnDataAndWriteToStorage` | `returnData.length < returnValues * 32` |

Module-level errors, distinct from the library: `OnlyEntryPointOrAccount`, `ZeroAddressNotAllowed`,
`FailedToReturnMsgValue`, `DelegateCallOnly`.

## Output capture

| `fetcherType` | `paramData` layout |
|---|---|
| `EXEC_RESULT` | `abi.encode(uint256 returnValues, address storageContract, bytes32 baseSlot)` |
| `STATIC_CALL` | `abi.encode(uint256 returnValues, address sourceContract, bytes sourceCallData, address storageContract, bytes32 baseSlot)` |

Return value *i* lands at `keccak256(abi.encodePacked(baseSlot, i))`. `STATIC_CALL` capture runs
*after* the write call, so it can observe post-write state — the idiomatic way to assert "the
deposit was credited".

Only static ABI types can be captured. Dynamic types (`bytes`, `string`, arrays) are unsupported at
both the SDK and the engine layer.

## Storage and namespaces

```solidity
function getNamespace(address account, address caller) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(account, caller));
}
function getNamespacedSlot(bytes32 namespace, bytes32 slot) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(namespace, slot));
}
```

Reads of an uninitialised slot revert `SlotNotInitialized`. Because the namespace includes the
caller, the `call` and `delegatecall` flows resolve to different slots. Upstream's own README says:
*"Pick one flow per smart account and stay consistent."* LATCH's choice: the `call` flow, so the
namespace is `keccak256(account, account)` and does not depend on who submitted the transaction.
Rationale in [adr/0003-storage-namespace.md](adr/0003-storage-namespace.md).

## Four integration shapes

The standard is defined at the encoding and interface level, not as a specific module.

| Shape | Mechanism | LATCH usage |
|---|---|---|
| ERC-7579 executor module | `ComposableExecutionModule` registers as `TYPE_EXECUTOR` and `TYPE_FALLBACK` | **Primary.** Nexus installs it |
| ERC-6900 plugin | `executeComposable` registered as an execution function via the manifest | Deferred |
| Native inheritance | Account implements `IComposableExecution` directly | **Primary.** Nexus `1.3.1` on Base Sepolia already does this |
| ERC-7702 delegation target | EOA delegates code; Nexus is the target and the module lives inside it | **Primary** for the demo |

## Seven footguns

Each one has bitten a real integration.

**1. `BALANCE` requires exactly 40 packed bytes.**
`paramData` is `abi.encodePacked(address token, address account)`, not `abi.encode`. A 64-byte
encoding reverts `InvalidParameterEncoding("Invalid paramData length")`. Token `address(0)` means
native balance.

**2. `BALANCE` accepts at most one constraint.**
```solidity
if (param.constraints.length > 1) revert InvalidSetOfInputParams("BALANCE supports at most 1 constraint");
```
A range on a balance requires two parameters, not two constraints. The SDK's `.check()` and
`.runtimeBalance()` each attach exactly one.

**3. `TARGET` rejects `BALANCE`.**
A target address cannot be a runtime balance. Use `RAW_BYTES`.

**4. `executeComposableCall` has no access control.**
Never install it as a fallback selector. Use `executeComposable`, which checks the caller against
the EntryPoint, the registered EntryPoint, or the account itself, and uses ERC-2771 appended-sender
semantics.

**5. The namespace depends on the dispatch flow.**
Mixing `call` and `delegatecall` writes to different slots. Captures become unreadable and reads
revert `SlotNotInitialized`. Pick one, in writing, in an ADR.

**6. Enum ordering is part of the encoding.**
`ConstraintType` has nine members in a fixed order. Upstream may reorder before the draft merges.
Pin the release and diff the file whenever you upgrade. Tracked as V-10.

**7. Constraints cannot read `block.timestamp`.**
Bounds are static literals. `block.timestamp - updatedAt <= maxStaleness` is inexpressible, and so is
`price * (1 - slippage)`. This is not a bug in the spec; it is a design boundary. LATCH's response is
to move the arithmetic into auditable helper views and gate on their single-word return, documented
in [04-constraints-and-oracles.md](04-constraints-and-oracles.md).

## SDK surface

`@biconomy/smart-batching` is the type-safe builder. It emits standalone `ComposableCall[]` and has
no infrastructure dependency, so it can target any bundler.

```typescript
const batch = createComposableBatch(publicClient, scaAddress);
const usdc  = batch.erc20Token(USDC);
const eth   = batch.nativeToken();
const oracle = batch.contract(ORACLE, ORACLE_ABI);
const storage = batch.storage();
const storageKey = await storage.getStorageKey();

batch.add([
  oracle.check({ functionName: "isFresh", args: [FEED, MAX_STALENESS], constraint: { eq: 1n } }),
  usdc.write({ functionName: "transfer", args: [recipient, usdc.runtimeBalance({ constraint: { gte: minOut } })] }),
]);

const calls = await batch.toCalls();     // ComposableCall[] for an execution client
const calldata = await batch.toCalldata(); // executeComposable calldata for a raw UserOp
```

Constraint vocabulary in the SDK: `eq`, `gte`, `lte`, `gteSigned`, `lteSigned`, `or`. Runtime value
sources: `runtimeBalance`, `runtimeAllowance`, `runtimeValue`, `storage.runtimeValue`. Checks:
`check` on a token, contract, or storage slot.

Each `check` or runtime value takes **one** constraint. Multiple simultaneous conditions require
multiple calls.

## Related documents

| Document | Covers |
|---|---|
| [01](01-system-architecture.md) | How the above composes into a system |
| [03](03-module-integration.md) | Account wiring, install authorisation |
| [04](04-constraints-and-oracles.md) | Constraint engineering, `FeedGuard`, `QuoterGuard` |
| [05](05-failure-semantics.md) | Atomicity, `FailSafeExecutor` |
| [13](13-composition-patterns.md) | Worked flows |

## Upstream sources for this document

Every claim above traces to one of these, quoted verbatim and attributed.

| Reference | Establishes |
|---|---|
| [composability-data-types.md](technical-reference/composability-data-types.md) | All enums and structs. Enum ordering. The absence of arithmetic |
| [composable-execution-lib.md](technical-reference/composable-execution-lib.md) | Fetcher resolution, constraint evaluation, output capture, the complete error catalogue |
| [composable-execution-module.md](technical-reference/composable-execution-module.md) | The execution loop, access control, module lifecycle |
| [nexus-execution-helper.md](technical-reference/nexus-execution-helper.md) | Mode encoding, `EXECTYPE_TRY` support, the worked example |
| [sources.md](appendix/sources.md) | Full citation list with retrieval dates |