---
title: "Reference: ComposableExecutionLib.sol"
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R2)
---

# Reference: `ComposableExecutionLib.sol`

Verbatim excerpts of the execution engine. Unmodified, abridged only by omission of doc comments and
imports.

- **Upstream:** [`bcnmy/erc8211-contracts`](https://github.com/bcnmy/erc8211-contracts)
- **Path:** `contracts/ComposableExecutionLib.sol`
- **Licence:** MIT
- **Retrieved:** 2026-10-02
- **Pinned to:** MEE v2.2.2 release

This is the normative behaviour. Everything in
[02-erc8211-spec-notes.md](../02-erc8211-spec-notes.md) derives from it.

## Error catalogue

```solidity
library ComposableExecutionLib {
    error ConstraintNotMet(ConstraintType constraintType);
    error Output_StaticCallFailed();
    error InvalidParameterEncoding(string message);
    error InvalidOutputParamFetcherType();
    error ComposableExecutionFailed();
    error InvalidConstraintType();
    error InvalidSetOfInputParams(string message);
    error EmptyOrSubConstraints();
    error InvalidConstraintRange();
    error InvalidReferenceDataLength();
    error InsufficientRawValue();
    error InsufficientReturnData();
```

## Routing

```solidity
    // Process the input parameters and return the composed calldata
    function processInputs(InputParam[] calldata inputParams, bytes4 functionSig) internal view returns (Execution memory) {
        address composedTarget;
        uint256 composedValue;
        bytes memory composedCalldata = abi.encodePacked(functionSig);
        uint256 length = inputParams.length;

        // Bit 0: TARGET param type set, Bit 1: VALUE param type set
        uint256 paramTypeFlags = 0;
        for (uint256 i; i < length; i++) {
            bytes memory processedInput = processInput(inputParams[i]);
            if (inputParams[i].paramType == InputParamType.TARGET) {
                if (inputParams[i].fetcherType == InputParamFetcherType.BALANCE) {
                    revert InvalidParameterEncoding("BALANCE fetcher type is not supported for TARGET param type");
                }
                // Check if TARGET has already been set (bit 0)
                if (paramTypeFlags & 1 != 0) {
                    revert InvalidSetOfInputParams("TARGET param type can only be set once");
                }
                paramTypeFlags |= 1; // Set bit 0
                composedTarget = abi.decode(processedInput, (address));
            } else if (inputParams[i].paramType == InputParamType.VALUE) {
                // Check if VALUE has already been set (bit 1)
                if (paramTypeFlags & 2 != 0) {
                    revert InvalidSetOfInputParams("VALUE param type can only be set once");
                }
                paramTypeFlags |= 2; // Set bit 1
                composedValue = abi.decode(processedInput, (uint256));
            } else if (inputParams[i].paramType == InputParamType.CALL_DATA) {
                composedCalldata = bytes.concat(composedCalldata, processedInput);
            } else {
                revert InvalidParameterEncoding("Invalid param type");
            }
        }
        return Execution({ target: composedTarget, value: composedValue, callData: composedCalldata });
    }
```

Note the `view` on `processInputs`. Constraint validation is `pure`, and fetcher resolution is a
`staticcall`, so nothing mutates state before the call is assembled.

## Fetcher resolution

```solidity
    // Process a single input parameter and return the composed calldata
    function processInput(InputParam calldata param) internal view returns (bytes memory) {
        if (param.fetcherType == InputParamFetcherType.RAW_BYTES) {
            _validateConstraints(param.paramData, param.constraints);
            return param.paramData;
        } else if (param.fetcherType == InputParamFetcherType.STATIC_CALL) {
            address contractAddr;
            bytes calldata callData;
            bytes calldata paramData = param.paramData;
            // expect paramData to be abi.encode(address contractAddr, bytes callData)
            assembly {
                contractAddr := calldataload(paramData.offset)
                let s := calldataload(add(paramData.offset, 0x20))
                let u := add(paramData.offset, s)
                callData.offset := add(u, 0x20)
                callData.length := calldataload(u)
            }
            (bool success, bytes memory returnData) = contractAddr.staticcall(callData);
            if (!success) {
                revert ComposableExecutionFailed();
            }
            _validateConstraints(returnData, param.constraints);
            return returnData;
        } else if (param.fetcherType == InputParamFetcherType.BALANCE) {
            // Balance is exactly one 32-byte word by construction; more than one constraint
            // would index past the encoded value and is rejected up front.
            if (param.constraints.length > 1) revert InvalidSetOfInputParams("BALANCE supports at most 1 constraint");
            address tokenAddr;
            address account;
            bytes calldata paramData = param.paramData;

            // expect paramData to be abi.encodePacked(address token, address account)
            // Validate exact length requirement
            require(paramData.length == 40, InvalidParameterEncoding("Invalid paramData length"));

            assembly {
                tokenAddr := shr(96, calldataload(paramData.offset))
                account := shr(96, calldataload(add(paramData.offset, 0x14)))
            }

            uint256 balance;
            if (tokenAddr == address(0)) {
                balance = account.balance;
            } else {
                balance = IERC20(tokenAddr).balanceOf(account);
            }
            _validateConstraints(abi.encode(balance), param.constraints);
            return abi.encode(balance);
        } else {
            revert InvalidParameterEncoding("Invalid param fetcher type");
        }
    }
```

Three encodings to memorise:

| Fetcher | `paramData` layout | Constraintable words |
|---|---|---|
| `RAW_BYTES` | raw bytes, no wrapper | `ceil(len / 32)` |
| `STATIC_CALL` | `abi.encode(address, bytes)` | `floor(returndata / 32)` |
| `BALANCE` | `abi.encodePacked(address token, address account)` — **exactly 40 bytes**, token `address(0)` means native | exactly 1 |

## Constraint evaluation

```solidity
    function _validateConstraints(bytes memory rawValue, Constraint[] calldata constraints) private pure {
        uint256 len = constraints.length;
        if (rawValue.length < len * 32) revert InsufficientRawValue();
        for (uint256 i; i < len;) {
            Constraint memory c = constraints[i];
            bytes32 value;
            assembly {
                value := mload(add(rawValue, add(0x20, mul(i, 0x20))))
            }
            if (c.constraintType == ConstraintType.OR) {
                Constraint[] memory subs = abi.decode(c.referenceData, (Constraint[]));
                uint256 subsLen = subs.length;
                if (subsLen == 0) revert EmptyOrSubConstraints();
                // Structural pre-pass: reject nested OR before evaluating any sub.
                for (uint256 j; j < subsLen;) {
                    if (subs[j].constraintType == ConstraintType.OR) revert InvalidConstraintType();
                    unchecked { ++j; }
                }
                bool anyMet;
                for (uint256 j; j < subsLen;) {
                    if (_checkConstraint(value, subs[j])) { anyMet = true; break; }
                    unchecked { ++j; }
                }
                if (!anyMet) revert ConstraintNotMet(c.constraintType);
            } else {
                if (!_checkConstraint(value, c)) revert ConstraintNotMet(c.constraintType);
            }
            unchecked { ++i; }
        }
    }
```

The array is **ANDed**, and `constraints[i]` is checked against the *i*-th 32-byte word of the
resolved value. `rawValue.length < len * 32` reverts with `InsufficientRawValue`, so a short return
cannot silently satisfy a zero threshold.

## Leaf comparison

```solidity
    function _checkConstraint(bytes32 value, Constraint memory c) private pure returns (bool) {
        ConstraintType ct = c.constraintType;
        if (ct == ConstraintType.EQ) {
            if (c.referenceData.length != 32) revert InvalidReferenceDataLength();
            return value == bytes32(c.referenceData);
        } else if (ct == ConstraintType.GTE) {
            if (c.referenceData.length != 32) revert InvalidReferenceDataLength();
            return value >= bytes32(c.referenceData);
        } else if (ct == ConstraintType.LTE) {
            if (c.referenceData.length != 32) revert InvalidReferenceDataLength();
            return value <= bytes32(c.referenceData);
        } else if (ct == ConstraintType.IN) {
            // Unsigned range only. Signers wanting a signed range must use IN_SIGNED — the unsigned
            // comparison here cannot detect the fail-open shape IN(10, -10)
            (bytes32 lower, bytes32 upper) = abi.decode(c.referenceData, (bytes32, bytes32));
            if (lower > upper) revert InvalidConstraintRange();
            return value >= lower && value <= upper;
        } else if (ct == ConstraintType.IN_SIGNED) {
            (bytes32 lowerBytes, bytes32 upperBytes) = abi.decode(c.referenceData, (bytes32, bytes32));
            int256 lower = int256(uint256(lowerBytes));
            int256 upper = int256(uint256(upperBytes));
            if (lower > upper) revert InvalidConstraintRange();
            int256 valueInt = int256(uint256(value));
            return valueInt >= lower && valueInt <= upper;
        } else if (ct == ConstraintType.GTE_SIGNED) {
            if (c.referenceData.length != 32) revert InvalidReferenceDataLength();
            return int256(uint256(value)) >= int256(uint256(bytes32(c.referenceData)));
        } else if (ct == ConstraintType.LTE_SIGNED) {
            if (c.referenceData.length != 32) revert InvalidReferenceDataLength();
            return int256(uint256(value)) <= int256(uint256(bytes32(c.referenceData)));
        } else if (ct == ConstraintType.SKIP) {
            // Enforce the NatSpec contract: SKIP carries no payload, so reject any non-empty
            // referenceData so encoding mistakes fail loudly instead of being silently ignored.
            if (c.referenceData.length != 0) revert InvalidReferenceDataLength();
            return true;
        } else {
            revert InvalidConstraintType();
        }
    }
```

`EQ`, `GTE` and `LTE` compare `bytes32` values. They are bitwise, so they work for addresses,
`bytes32` and signed values, but `GTE` on a negative two's-complement value passes for *every*
negative input. That is the trap `GTE_SIGNED` exists to avoid.

## Output capture

```solidity
    function _parseReturnDataAndWriteToStorage(
        uint256 returnValues,
        bytes memory returnData,
        address targetStorageContract,
        bytes32 targetStorageSlot,
        address account
    ) internal {
        if (returnData.length < returnValues * 32) revert InsufficientReturnData();
        for (uint256 i; i < returnValues; i++) {
            bytes32 value;
            assembly {
                value := mload(add(returnData, add(0x20, mul(i, 0x20))))
            }
            Storage(targetStorageContract).writeStorage({ slot: keccak256(abi.encodePacked(targetStorageSlot, i)), value: value, account: account});
        }
    }
```

Return value *i* is written to `keccak256(abi.encodePacked(baseSlot, i))`. Return values must be
static ABI types; dynamic types are not supported by the SDK layer either.