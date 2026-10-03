---
title: "Reference: ComposableExecutionModule.sol"
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R3, R4)
---

# Reference: `ComposableExecutionModule.sol`

Verbatim excerpts of the ERC-7579 wrapper. Unmodified.

- **Upstream:** [`bcnmy/erc8211-contracts`](https://github.com/bcnmy/erc8211-contracts)
- **Paths:** `contracts/ComposableExecutionModule.sol`, `contracts/interfaces/IComposableExecution.sol`,
  `contracts/Storage.sol`
- **Licence:** MIT (module, storage), LGPL-3.0-only (interface)
- **Retrieved:** 2026-10-02
- **Pinned to:** MEE v2.2.2 release

## Interface

```solidity
// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.23;

interface IComposableExecution {
    function executeComposable(ComposableExecution[] calldata cExecutions) external payable;
}

interface IComposableExecutionModule is IComposableExecution {
    function executeComposableCall(ComposableExecution[] calldata cExecutions) external;
    function executeComposableDelegateCall(ComposableExecution[] calldata cExecutions) external;
}
```

Three entry points, three different trust properties. This is the single most consequential
distinction in the whole integration.

| Function | Access control | Intended caller | Storage namespace |
|---|---|---|---|
| `executeComposable` | Yes | account fallback, EntryPoint, or self | `keccak256(account, account)` when the account calls |
| `executeComposableCall` | **None** | account itself, via `.execute()` | `keccak256(account, account)` |
| `executeComposableDelegateCall` | Delegate-only guard | account itself, via `.execute()` | `keccak256(account, caller)` — **caller-dependent** |

`executeComposableCall` has no access control whatsoever. Installing it as an account fallback
selector would let anyone execute composable batches against the account. The upstream source says so
in a comment; it is repeated here because it is the mistake most likely to be made.

## Access control and value handling

```solidity
    address private constant ENTRY_POINT_V07_ADDRESS = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address public immutable DEFAULT_EP_ADDRESS;

    error OnlyEntryPointOrAccount();
    error ZeroAddressNotAllowed();
    error FailedToReturnMsgValue();
    error DelegateCallOnly();

    /// @notice Executes a composable transaction with dynamic parameter composition and return value handling
    /// @dev To be used via fallback() from the account
    /// @dev As per ERC-7579 account MUST append original msg.sender address to the calldata in a way specified by ERC-2771
    function executeComposable(ComposableExecution[] calldata cExecutions) external payable {
        // access control
        address sender = _msgSender();
        // in most cases, only first condition (against constant) will be checked
        // so no extra sloads
        require(sender == DEFAULT_EP_ADDRESS || sender == entryPoints[msg.sender] || sender == msg.sender, OnlyEntryPointOrAccount());
        _returnMsgValue();
        _executeComposable(cExecutions, msg.sender, _executeExecutionCall);
    }

    /// @notice It doesn't require access control as it is expected to be called by the account itself via .execute()
    /// @dev !!! Attention !!! This function should NEVER be installed to be used via fallback() as it doesn't implement access control
    /// thus it will be callable by any address account.executeComposableCall => fallback() => this.executeComposableCall
    function executeComposableCall(ComposableExecution[] calldata cExecutions) external {
        _executeComposable(cExecutions, msg.sender, _executeExecutionCall);
    }

    /// @notice It doesn't require access control as it is expected to be called by the account itself via .execute(mode = delegatecall)
    function executeComposableDelegateCall(ComposableExecution[] calldata cExecutions) external {
        require(THIS_ADDRESS != address(this), DelegateCallOnly());
        _executeComposable(cExecutions, address(this), _executeExecutionDelegatecall);
    }
```

`_returnMsgValue()` forwards `msg.value` back to the account before execution, so a user can send
ETH alongside the batch without it being consumed by the module.

## The loop

```solidity
    function _executeComposable(
        ComposableExecution[] calldata cExecutions,
        address account,
        function(Execution memory execution) internal returns (bytes[] memory) executeExecutionFunction
    ) internal {
        // we can not use erc-7579 batch mode here because we may need to compose
        // the next call in the batch based on the execution result of the previous call
        uint256 length = cExecutions.length;
        for (uint256 i; i < length; i++) {
            ComposableExecution calldata cExecution = cExecutions[i];
            Execution memory execution = cExecution.inputParams.processInputs(cExecution.functionSig);
            bytes[] memory returnData;
            if (execution.target != address(0)) {
                returnData = executeExecutionFunction(execution);
            } else {
                returnData = new bytes[](1);
                returnData[0] = "";
            }
            cExecution.outputParams.processOutputs(returnData[0], account);
        }
    }
```

Two observations that determine LATCH's design:

1. **No `try`.** Every non-zero-target entry is dispatched through
   `ModeLib.encodeSimpleSingle()`, which is `EXECTYPE_DEFAULT`. A revert in any entry propagates and
   kills the whole batch. There is no partial-success path in this contract.
2. **`target == address(0)` is the predicate entry.** No call is made, but fetcher resolution and
   constraint validation still run. `returnData` is forced to empty, so an output capture on a
   predicate entry captures nothing.

## Module lifecycle

```solidity
    function setEntryPoint(address _entryPoint) external {
        require(_entryPoint != address(0), ZeroAddressNotAllowed());
        entryPoints[msg.sender] = _entryPoint;
    }

    function onInstall(bytes calldata data) external override {
        if (data.length >= 20) {
            if (entryPoints[msg.sender] != address(0)) {
                require(entryPoints[msg.sender] == address(bytes20(data[0:20])), AlreadyInitialized(msg.sender));
                return;
            }
            entryPoints[msg.sender] = address(bytes20(data[0:20]));
        }
    }

    function isInitialized(address account) external view returns (bool) {
        return entryPoints[account] != address(0);
    }

    function onUninstall(bytes calldata data) external override {
        delete entryPoints[msg.sender];
    }

    /// @dev Reports that this module is an executor and a fallback module
    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == TYPE_EXECUTOR || moduleTypeId == TYPE_FALLBACK;
    }
```

`onInstall` accepts an optional 20-byte EntryPoint address in `data`. Installed with no data, the
module falls back to the immutable `DEFAULT_EP_ADDRESS`. Installed twice with the same address it
is idempotent; with a different address it reverts.

## Storage

```solidity
    function writeStorage(bytes32 slot, bytes32 value, address account) external {
        bytes32 namespace = getNamespace(account, msg.sender);
        _writeStorage(slot, value, namespace);
    }

    function readStorage(bytes32 namespace, bytes32 slot) external view returns (bytes32) {
        bytes32 namespacedSlot = getNamespacedSlot(namespace, slot);
        if (!initializedSlots[namespacedSlot]) revert SlotNotInitialized();
        bytes32 value;
        assembly { value := sload(namespacedSlot) }
        return value;
    }

    function getNamespacedSlot(bytes32 namespace, bytes32 slot) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(namespace, slot));
    }

    function getNamespace(address account, address caller) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(account, caller));
    }
```

The namespace includes `msg.sender` of the `Storage` call, which is the module. Combined with the
`account` argument the module supplies, the effective namespace differs between the `call` and
`delegatecall` flows. Upstream states this explicitly in its README: *"Pick one flow per smart
account and stay consistent."* LATCH's choice and its reasoning are in
[adr/0003-storage-namespace.md](../adr/0003-storage-namespace.md).