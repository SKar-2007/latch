// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IStorage} from "../../contracts/interfaces/IComposableExecution.sol";
import {
    ComposableExecution,
    InputParam,
    InputParamFetcherType,
    InputParamType,
    OutputParam,
    OutputParamFetcherType
} from "../../contracts/interfaces/IComposabilityTypes.sol";

/**
 * @title MockAccount
 * @notice A minimal ERC-7579-shaped account that can delegatecall, for exercising FailSafeExecutor.
 * @dev Test-only. Implements just enough of `execute` to route a delegatecall, which is the only
 *      invocation path FailSafeExecutor supports.
 */
contract MockAccount {
    error NotAuthorized();
    error ModeNotDelegateCall();

    address public entryPoint;
    address[] public modules;

    event Executed(address indexed module, bytes32 mode);

    function setEntryPoint(address ep) external {
        entryPoint = ep;
    }

    function install(address module) external {
        modules.push(module);
    }

    function moduleCount() external view returns (uint256) {
        return modules.length;
    }

    /// @dev Mirrors Nexus's shape closely enough: `onlyEntryPointOrSelf`, delegatecall supported.
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable {
        if (msg.sender != entryPoint && msg.sender != address(this)) revert NotAuthorized();

        // The most significant byte is the callType. 0xff is DELEGATECALL.
        if (uint8(mode[0]) != 0xff) revert ModeNotDelegateCall();

        address target = address(bytes20(executionCalldata[0:20]));
        bytes calldata inner = executionCalldata[20:];

        (bool ok, bytes memory ret) = target.delegatecall(inner);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        emit Executed(target, mode);
    }

    /// @dev ERC-7579 default mode: CALLTYPE_SINGLE + EXECTYPE_DEFAULT, selector and 4 zero bytes.
    function defaultDelegateCallMode() public pure returns (bytes32) {
        return bytes32(hex"ff00000000000000000000000000000000000000000000000000000000000000");
    }
}

/**
 * @title MockComposabilityModule
 * @notice Stands in for ComposableExecutionModule. Behaviour is driven by a per-target policy.
 */
contract MockComposabilityModule {
    /// @notice Targets that should revert when called.
    mapping(address => bool) public shouldRevert;
    /// @notice Every target the module was asked to hit, in order.
    address[] public calls;

    function setShouldRevert(address target, bool value) external {
        shouldRevert[target] = value;
    }

    function callCount() external view returns (uint256) {
        return calls.length;
    }

    function executeComposableCall(ComposableExecution[] calldata cExecutions) external {
        for (uint256 i; i < cExecutions.length; i++) {
            address target = _targetOf(cExecutions[i]);
            if (target == address(0)) continue; // predicate entry

            calls.push(target);

            if (shouldRevert[target]) revert("MockComposabilityModule: configured failure");

            // Emulate an inner call so the value actually lands somewhere observable.
            (bool ok,) = target.call("");
            require(ok, "MockComposabilityModule: inner call failed");
        }
    }

    function executeComposable(ComposableExecution[] calldata cExecutions) external payable {
        this.executeComposableCall(cExecutions);
    }

    function _targetOf(ComposableExecution calldata execution) private pure returns (address target) {
        InputParam[] calldata params = execution.inputParams;
        for (uint256 i; i < params.length; i++) {
            if (params[i].paramType != InputParamType.TARGET) continue;
            bytes calldata d = params[i].paramData;
            if (d.length < 32) return address(0);
            // abi.decode rather than hand-rolled calldataload arithmetic. The assembly version
            // misread the slice offset and produced a truncated address.
            target = abi.decode(d, (address));
        }
    }
}

/**
 * @title MockStorage
 * @notice Mirrors the upstream Storage namespace and slot derivation exactly.
 */
contract MockStorage is IStorage {
    error SlotNotInitialized();

    mapping(bytes32 => bool) private _initialized;
    mapping(bytes32 => bytes32) private _values;
    mapping(bytes32 => address) private _owners;

    function writeStorage(bytes32 slot, bytes32 value, address account) external {
        bytes32 ns = getNamespace(account, msg.sender);
        bytes32 namespaced = getNamespacedSlot(ns, slot);
        _initialized[namespaced] = true;
        _values[namespaced] = value;
        _owners[namespaced] = account;
    }

    function readStorage(bytes32 namespace, bytes32 slot) external view returns (bytes32) {
        bytes32 namespaced = getNamespacedSlot(namespace, slot);
        if (!_initialized[namespaced]) revert SlotNotInitialized();
        return _values[namespaced];
    }

    function getNamespacedSlot(bytes32 namespace, bytes32 slot) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(namespace, slot));
    }

    function getNamespace(address account, address caller) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(account, caller));
    }

    function isSlotInitialized(bytes32 namespace, bytes32 slot) external view returns (bool) {
        return _initialized[getNamespacedSlot(namespace, slot)];
    }
}

/**
 * @title RecordingTarget
 * @notice A callable that records that it ran. Stands in for a protocol.
 */
contract RecordingTarget {
    uint256 public hits;

    function record() external {
        hits++;
    }

    receive() external payable {
        hits++;
    }
}
