---
title: "Reference: Nexus execution and modes"
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R7, R8, R9, R10, R11, R12)
---

# Reference: Nexus execution and modes

Verbatim excerpts from [`bcnmy/nexus`](https://github.com/bcnmy/nexus). Unmodified. These excerpts
are what make `FailSafeExecutor` possible.

- **Licence:** MIT
- **Retrieved:** 2026-10-02
- **Pinned to:** `main` at time of retrieval

## Mode encoding

```solidity
// |--------------------------------------------------------------------|
// | CALLTYPE  | EXECTYPE  |   UNUSED   | ModeSelector  |  ModePayload  |
// |--------------------------------------------------------------------|
// | 1 byte    | 1 byte    |   4 bytes  | 4 bytes       |   22 bytes    |
// |--------------------------------------------------------------------|

CallType constant CALLTYPE_SINGLE = CallType.wrap(0x00);
CallType constant CALLTYPE_BATCH = CallType.wrap(0x01);
CallType constant CALLTYPE_STATIC = CallType.wrap(0xFE);
CallType constant CALLTYPE_DELEGATECALL = CallType.wrap(0xFF);

ExecType constant EXECTYPE_DEFAULT = ExecType.wrap(0x00);
// @dev account may elect to change execution behavior. For example "try exec" / "allow fail"
ExecType constant EXECTYPE_TRY = ExecType.wrap(0x01);

ModeSelector constant MODE_DEFAULT = ModeSelector.wrap(bytes4(0x00000000));
```

`encodeTrySingle()` produces a mode with call type `0x00` and exec type `0x01`:
`0x0100000000000000000000000000000000000000000000000000000000000000` when written big-endian as
the first two bytes `0x00 0x01`.

## Account support

```solidity
    function supportsExecutionMode(ExecutionMode mode) external view virtual returns (bool isSupported) {
        (CallType callType, ExecType execType) = mode.decodeBasic();

        // Return true if both the call type and execution type are supported.
        return (callType == CALLTYPE_SINGLE || callType == CALLTYPE_BATCH || callType == CALLTYPE_DELEGATECALL)
            && (execType == EXECTYPE_DEFAULT || execType == EXECTYPE_TRY);
    }
```

Source: `contracts/Nexus.sol`, line 425.

This is the load-bearing verification for [05-failure-semantics.md](../05-failure-semantics.md).
The account accepts all three call types under both exec types, so a caller may request
`EXECTYPE_TRY`. The composability module *chooses not to*; Nexus *permits it*.

## Try execution

```solidity
    /// @dev Similar to _execute but returns a success boolean and catches reverts instead of propagating them.
    function _tryExecute(address target, uint256 value, bytes calldata callData) internal virtual returns (bool success, bytes memory result) {
```

```solidity
    /// @dev Execute a delegatecall to a target and catch reverts.
    function _tryExecuteBatch(Execution[] calldata executions) internal returns (bytes[] memory result) {
        uint256 length = executions.length;
        result = new bytes[](length);
        for (uint256 i; i < length; i++) {
            bool success;
            (success, result[i]) = _tryExecute(executions[i].target, executions[i].value, executions[i].callData);
        }
    }
```

Events and errors available to an observer:

```solidity
    event TryExecuteUnsuccessful(bytes callData, bytes result);
    event TryDelegateCallUnsuccessful(bytes callData, bytes result);
    error UnsupportedExecType(ExecType execType);
```

`TryExecuteUnsuccessful` carries the failing calldata and the revert data. A caller can therefore
learn *which* segment failed and *why*, which is what allows `FailSafeExecutor` to decide whether to
continue.

## Single-call encoding

```solidity
    function encodeSingle(address target, uint256 value, bytes memory callData) internal pure returns (bytes memory userOpCalldata) {
        userOpCalldata = abi.encodePacked(target, value, callData);
    }

    function decodeSingle(bytes calldata executionCalldata) internal pure returns (address target, uint256 value, bytes calldata callData) {
        target = address(bytes20(executionCalldata[0:20]));
        value = uint256(bytes32(executionCalldata[20:52]));
        callData = executionCalldata[52:];
    }
```

Packed, not ABI-encoded: 20 bytes target, 32 bytes value, remainder calldata. Relevant when
reconstructing a batch for a human-readable decoder, since the composability module uses
`encodeSingle` internally when calling `executeFromExecutor`.

## Module authorisation

```solidity
uint256 constant MODULE_TYPE_VALIDATOR = 1;
uint256 constant MODULE_TYPE_EXECUTOR = 2;
uint256 constant MODULE_TYPE_FALLBACK = 3;
uint256 constant MODULE_TYPE_HOOK = 4;

// keccak256("ModuleEnableMode(address module,uint256 moduleType,bytes32 userOpHash,bytes initData)")
bytes32 constant MODULE_ENABLE_MODE_TYPE_HASH = 0xf6c866c1cd985ce61f030431e576c0e82887de0643dfa8a2e6efc3463e638ed0;

bytes4 constant ERC1271_MAGICVALUE = 0x1626ba7e;
```

Installing the composability module is not a plain transaction. The account owner signs a
`ModuleEnableMode` typed message binding the module address, module type, UserOp hash and init data.
Without that signature, `installModule` reverts. LATCH's install flow is in
[03-module-integration.md](../03-module-integration.md).

## Worked example

`TestComposableExecution.t.sol` in the Nexus repository is the authoritative worked example. Two
details are worth copying:

```solidity
        bytes32 namespace = storageContract.getNamespace(address(BOB_ACCOUNT), address(BOB_ACCOUNT));
        bytes32 SLOT_A_0 = keccak256(abi.encodePacked(SLOT_A, uint256(0)));
        bytes32 SLOT_B_0 = keccak256(abi.encodePacked(SLOT_B, uint256(0)));
```

1. The namespace is `getNamespace(account, account)` — caller and account are the same address. This
   is the call flow, and it is what LATCH standardises on. See
   [adr/0003-storage-namespace.md](../adr/0003-storage-namespace.md).
2. Captured return values are read back with a `STATIC_CALL` fetcher pointed at
   `Storage.readStorage`, with the derived slot as the argument:

```solidity
        inputParams_execution2[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.STATIC_CALL,
            paramData: abi.encode(storageContract, abi.encodeCall(Storage.readStorage, (namespace, SLOT_A_0))),
            constraints: constraints_input2_1
        });
```

Constraint arrays can therefore be attached to *reads of storage*, which is how an entry asserts
that a previous entry produced the expected value.