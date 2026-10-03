---
title: Module integration
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R4, R7, R10, R12, S4, S5, D2, D5, D6)
---

# Module integration

Wiring the composability module into a Biconomy Nexus account, and the three entry points whose
trust properties differ. The decisions here are recorded in
[adr/0003-storage-namespace.md](adr/0003-storage-namespace.md) and
[adr/0005-account-mode.md](adr/0005-account-mode.md).

## Four integration shapes

ERC-8211 is defined at the encoding and interface level. Which shape you use determines what you
own.

| Shape | You deploy | You maintain | Namespace | LATCH |
|---|---|---|---|---|
| **Native inheritance** | Nothing | Nothing | `keccak256(account, account)` | **Primary. Already live on Base Sepolia** |
| ERC-7702 delegation target | Nothing | Nothing | `keccak256(account, account)` | **Primary for the demo**, combined with the above |
| ERC-7579 executor module | Module only | Nothing | `keccak256(account, account)` | Fallback for older Nexus builds |
| ERC-6900 plugin | Plugin | Manifest upkeep | Plugin-defined | Deferred |

### Native inheritance turned out to be the shipped path

Earlier drafts of this document rejected native inheritance on the grounds that it "requires forking
Nexus". **That is no longer true.** A bytecode survey on 2026-10-02 found the account at
`0x0000000020fe2F30453074aD916eDeB653eC7E9D`, which reports `accountId()` as `biconomy.nexus.1.3.1`,
already exposes the `executeComposable` selector, and does **not** expose `onInstall`, `setEntryPoint`
or `getEntryPoint`. It composes natively and delegates to nothing.

| Selector | Function | Module `0x…f0e7` | Nexus 1.3.1 `0x…9D2` |
|---|---|---|---|
| `0x7eba07b8` | `executeComposable(ComposableExecution[])` | present | **present** |
| `0xdcb108bf` | `executeComposableCall(...)` | present | absent |
| `0x48a58db7` | `executeComposableDelegateCall(...)` | present | absent |
| `0x6d61fe70` | `onInstall(bytes)` | present | absent |

The consequences are significant and all favourable:

- **No `installModule`. No `ModuleEnableMode` signature. No `onInstall` transaction.** The batch arrives
  as UserOp `callData` and passes through the account's ordinary signature validation.
- Authorisation is *stronger* than the module path, because there is no second contract in the trust
  boundary. See [08](08-security-model.md).
- The namespace is `keccak256(account, account)` automatically, which is what
  [adr/0003](adr/0003-storage-namespace.md) chose for reasons that turn out to hold on both paths.

The ERC-7579 module route remains supported and documented, because the composability module is deployed
on Base Sepolia and older Nexus builds need it. It is now the fallback, not the default.

## The three entry points

```solidity
interface IComposableExecution {
    function executeComposable(ComposableExecution[] calldata cExecutions) external payable;
}

interface IComposableExecutionModule is IComposableExecution {
    function executeComposableCall(ComposableExecution[] calldata cExecutions) external;
    function executeComposableDelegateCall(ComposableExecution[] calldata cExecutions) external;
}
```

| | `executeComposable` | `executeComposableCall` | `executeComposableDelegateCall` |
|---|---|---|---|
| Access control | Yes | **None** | Delegate-only |
| Guard | caller is EntryPoint, registered EntryPoint, or the account | none | `address(this) != THIS_ADDRESS` |
| ERC-2771 sender | Required | Not used | Not used |
| Handles `msg.value` | Yes, returns it to the account | No | No |
| Dispatch | `executeFromExecutor`, `encodeSimpleSingle` | same | `_execute` delegatecall |
| Safe as fallback | Yes | **Never** | No |

`executeComposableCall` is callable by anyone who can reach the account's fallback with that
selector. The upstream comment is unambiguous:

> `!!! Attention !!! This function should NEVER be installed to be used via fallback() as it
> doesn't implement access control thus it will be callable by any address`

LATCH installs `executeComposable`, and `executeComposableCall` appears in these documents only in
tables that mark it unsafe.

## Access control in detail

```solidity
require(
    sender == DEFAULT_EP_ADDRESS
        || sender == entryPoints[msg.sender]
        || sender == msg.sender,
    OnlyEntryPointOrAccount()
);
```

Evaluated left to right with short-circuiting. In the common case `sender == DEFAULT_EP_ADDRESS` is
true at the first comparison, so no storage read happens — which is why the module author noted it
that way. The first two branches exist so a non-default EntryPoint can be registered per account
without redeploying the module.

`sender` comes from `_msgSender()`, which reads the ERC-2771 suffix the account appends. An account
that does not follow ERC-2771 for this selector will fail the first two branches and rely on
`sender == msg.sender`, which is true only when the account calls the module itself.

## Installation lifecycle

### ERC-7579 flow

**Only needed on Nexus builds older than 1.3.1.** On 1.3.1 the account composes natively, so the whole
section below is skipped. It is retained because the module is deployed and older builds still need it.

Installation is not a transaction. Nexus requires a signed authorisation message before
`installModule` will accept a new module.

```solidity
// keccak256("ModuleEnableMode(address module,uint256 moduleType,bytes32 userOpHash,bytes initData)")
bytes32 constant MODULE_ENABLE_MODE_TYPE_HASH = 0xf6c866c1cd985ce61f030431e576c0e82887de0643dfa8a2e6efc3463e638ed0;
```

| Step | Action | Note |
|---|---|---|
| 1 | Sign `ModuleEnableMode{module, moduleType, userOpHash, initData}` | EIP-712, domain-bound to the account |
| 2 | Call `installModule(2, MODULE, initData)` | `2` is `MODULE_TYPE_EXECUTOR` |
| 3 | Module's `onInstall(initData)` runs | `initData` is the optional 20-byte EntryPoint |
| 4 | Account emits `ModuleInstalled(moduleTypeId, module)` | ERC-7579 event |
| 5 | Verify with `isModuleInstalled` or `isInitialized` | `isInitialized` is the module's own view |

`onInstall` is idempotent for the same EntryPoint and reverts for a different one:

```solidity
if (data.length >= 20) {
    if (entryPoints[msg.sender] != address(0)) {
        require(entryPoints[msg.sender] == address(bytes20(data[0:20])), AlreadyInitialized(msg.sender));
        return;
    }
    entryPoints[msg.sender] = address(bytes20(data[0:20]));
}
```

Passing empty `initData` leaves `entryPoints[account]` at zero and the module falls back to the
immutable `DEFAULT_EP_ADDRESS`. On Base Sepolia that is EntryPoint v0.7,
`0x0000000071727De22E5E9d8BAf0edAc6f37da032`.

The module reports `TYPE_EXECUTOR || TYPE_FALLBACK`, so it may be installed under either type ID. On
Nexus, installing as executor and enabling its fallback handler is what makes
`executeComposable` reachable through the account's fallback path.

### ERC-7702 flow

The EOA signs an authorization tuple delegating to the Nexus singleton, then submits a normal UserOp
executed by that code.

```typescript
const authorization = await walletClient.signAuthorization({
  account: eoa,
  contractAddress: nexusSingleton,
  chainId: 0,     // valid across all chains
  nonce: 0,       // fresh embedded wallets
});
```

Three requirements, all of them easy to miss:

1. `delegate: true` is mandatory on the MEE instruction.
2. `authorization` must be supplied — manually, or the SDK prompts.
3. `accountAddress` must be **explicitly overridden to the EOA address**, which is the SDK's signal
   that EIP-7702 is in use. Without it the SDK assumes a managed smart account and derives a
   different address.

The first submission may fail with HTTP 412, meaning the authorization is not yet recorded. Sign it
and retry.

`chainId: 0` produces an authorization valid on every chain, which is what enables a single
multichain Nexus address. Only embedded wallets (Privy, Dynamic, Turnkey) can sign this
authorization directly; external wallets such as MetaMask and Rabby need Fusion mode instead.

## Namespace derivation, and why it pins the flow

```solidity
function getNamespace(address account, address caller) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(account, caller));
}
```

The module passes `account` and the `Storage` contract derives the namespace from `account` and
`msg.sender`. `msg.sender` on the `Storage` call is the module, so the discriminator is *which flow
was used*, and `account` differs:

| Flow | `account` argument | Resulting namespace |
|---|---|---|
| `executeComposable` from account fallback | `msg.sender`, the account | `keccak256(account, account)` |
| `executeComposableDelegateCall` | `address(this)`, the account | `keccak256(account, <caller of the account>)` |

Under the delegatecall flow, `msg.sender` inside the delegatecall context is whatever called the
account — the EntryPoint, or a relayer. **The namespace would then depend on the delivery method**,
so a batch submitted through a bundler writes to a different slot than the same batch submitted by a
relayer. Reads revert `SlotNotInitialized`.

Upstream's README states the requirement plainly: *"Pick one flow per smart account and stay
consistent."* LATCH picks the call flow. The reasoning is in
[adr/0003-storage-namespace.md](adr/0003-storage-namespace.md); the short version is that a
namespace that varies with who submitted the transaction is a namespace we cannot reason about.

The Nexus test suite confirms the call flow is the expected usage:

```solidity
bytes32 namespace = storageContract.getNamespace(address(BOB_ACCOUNT), address(BOB_ACCOUNT));
```

## Slot derivation

Three levels, each a `keccak256` over packed bytes:

```
namespace     = keccak256(account, caller)
namespacedSlot= keccak256(namespace, slot)
valueSlot(i)  = keccak256(baseSlot, i)
```

`baseSlot` comes from `storage.getStorageKey()`, which returns a fresh `bigint` per call, so slots
within one batch do not collide. Return value *i* of a multi-value call lands at
`keccak256(baseSlot, i)`.

Reading a slot back is a `STATIC_CALL` fetcher:

```typescript
await storage.runtimeValue({ storageKey })
```

which encodes as `STATIC_CALL` against `Storage.readStorage(namespace, valueSlot)`. A `check` on the
same slot asserts the captured value, which is how an entry asserts that an earlier entry produced
the expected result.

## Uninstall and recovery

`onUninstall` clears the entry point mapping and emits `ModuleUninstalled`. Because the module holds
no user funds and no approvals of its own, uninstalling it strands nothing: batches encoded before
uninstall simply become uncallable.

Two recovery paths exist on Nexus:

| Path | Authorisation | Use |
|---|---|---|
| `EmergencyUninstall(hook, hookType, deInitData, nonce)` | Hook signature | Module is stuck or malicious |
| Normal `uninstallModule` | Account signature | Routine cleanup |

The emergency path exists precisely because a misbehaving module cannot be relied upon to release
itself. LATCH's `FailSafeExecutor` must therefore be installable and uninstallable by the same
mechanism — see [05-failure-semantics.md](05-failure-semantics.md).

## Verification checklist

Confirm after any account or module change:

| Check | Call | Expectation |
|---|---|---|
| Module installed | `isInitialized(MODULE, account)` or account state | `true` |
| Module type accepted | `MODULE.isModuleType(2)` and `(3)` | `true` |
| EntryPoint bound | `MODULE.getEntryPoint(account)` | v0.7 address |
| Batch executes | `eth_call` on `executeComposable` | no revert, expected events |
| Namespace stable | Two submissions via different senders | same slot written |
| Uninstall clean | `uninstallModule(2, MODULE, "")` | `ModuleUninstalled` emitted, `isInitialized` false |

## Related documents

| Document | Covers |
|---|---|
| [02](02-erc8211-spec-notes.md) | Struct and enum definitions |
| [technical-reference/composable-execution-module.md](technical-reference/composable-execution-module.md) | Verbatim module source behind this document |
| [01](01-system-architecture.md) | Where this sits in the system |
| [05](05-failure-semantics.md) | `FailSafeExecutor` as an executor module |
| [10](10-deployment-runbook.md) | The commands for the checklist above |
| [08](08-security-model.md) | Privilege escalation through module installation |