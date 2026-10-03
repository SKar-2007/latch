// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ComposableExecution} from "./IComposabilityTypes.sol";

/**
 * @title IComposableExecution
 * @notice The ERC-8211 entry points, as declared by the reference implementation.
 * @dev Reproduced locally so LATCH compiles without a dependency on the upstream repository.
 *      `IComposableExecution` is LGPL-3.0-only upstream; these are interface declarations only,
 *      carrying no logic. Struct definitions live in IComposabilityTypes.sol.
 */

interface IComposableExecution {
    function executeComposable(ComposableExecution[] calldata cExecutions) external payable;
}

interface IComposableExecutionModule is IComposableExecution {
    /// @dev No access control upstream. Only sound when called by the account itself, because the
    ///      implementation dispatches through `IERC7579Account(msg.sender).executeFromExecutor`.
    function executeComposableCall(ComposableExecution[] calldata cExecutions) external;

    function executeComposableDelegateCall(ComposableExecution[] calldata cExecutions) external;
}

interface IStorage {
    function readStorage(bytes32 namespace, bytes32 slot) external view returns (bytes32);

    function writeStorage(bytes32 slot, bytes32 value, address account) external;

    function getNamespace(address account, address caller) external pure returns (bytes32);

    function getNamespacedSlot(bytes32 namespace, bytes32 slot) external pure returns (bytes32);
}
