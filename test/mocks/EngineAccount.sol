// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title EngineAccount
 * @notice A minimal ERC-7579-shaped account that records what the composability engine asks it to do.
 *
 * @dev This is the harness for fuzzing the real encoding. The upstream module dispatches through
 *      `IERC7579Account(msg.sender).executeFromExecutor`, so anything that can act as that account
 *      can drive the genuine `ComposableExecutionLib` and observe the `Execution` it composed.
 *
 *      Combined with a fork at the deployed module address, this exercises the audited engine rather
 *      than a mock of it, which is the point: the encoding is the thing most likely to be
 *      misunderstood, and a mock would only test the mock author's understanding.
 *
 * @dev `executeFromExecutor` decodes `abi.encodePacked(target, value, callData)`, matching
 *      `ExecutionLib.encodeSingle`. Decode failures are recorded rather than reverted, so a malformed
 *      composition is observable instead of indistinguishable from a fetcher failure.
 */
contract EngineAccount {
    struct Captured {
        address target;
        uint256 value;
        bytes callData;
        bool decoded;
    }

    error DecodeFailed();

    Captured[] internal _captured;

    /// @notice When true, every dispatch reverts. Used to exercise the engine's revert path.
    bool public shouldRevertOnDispatch;

    /// @notice Return data handed back to the engine, for output-capture paths.
    bytes internal _dispatchReturnData;

    function setDispatchReturnData(bytes memory data) external {
        _dispatchReturnData = data;
    }

    function dispatchReturnData() external view returns (bytes memory) {
        return _dispatchReturnData;
    }

    bool public executeCalls = true;

    function setExecuteCalls(bool execute) external {
        executeCalls = execute;
    }

    function executeFromExecutor(bytes32, bytes calldata executionCalldata)
        external
        returns (bytes[] memory returnData)
    {
        if (shouldRevertOnDispatch) revert("EngineAccount: dispatch refused");

        returnData = new bytes[](1);

        if (executionCalldata.length < 52) {
            // Too short to be a packed Execution. Record it as undecodable rather than reverting,
            // so the caller can tell "engine composed nonsense" from "engine reverted".
            _captured.push(Captured({target: address(0), value: 0, callData: executionCalldata, decoded: false}));
            returnData[0] = _dispatchReturnData;
            return returnData;
        }

        address target = address(bytes20(executionCalldata[0:20]));
        uint256 value = uint256(bytes32(executionCalldata[20:52]));
        bytes memory callData = executionCalldata[52:];

        _captured.push(Captured({target: target, value: value, callData: callData, decoded: true}));

        if (executeCalls && target != address(0)) {
            (bool ok, bytes memory ret) = target.call{value: value}(callData);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
            returnData[0] = ret;
        } else {
            returnData[0] = _dispatchReturnData;
        }
    }

    // -------------------------------------------------------------------------------------------
    // Observation
    // -------------------------------------------------------------------------------------------

    function capturedCount() external view returns (uint256) {
        return _captured.length;
    }

    function capturedAt(uint256 i) external view returns (address, uint256, bytes memory, bool) {
        Captured storage c = _captured[i];
        return (c.target, c.value, c.callData, c.decoded);
    }

    function clearCaptured() external {
        delete _captured;
    }

    // -------------------------------------------------------------------------------------------
    // ERC-7579 surface the module may probe
    // -------------------------------------------------------------------------------------------

    function supportsExecutionMode(bytes32 mode) external pure returns (bool) {
        // Mirrors Nexus: every call type, both exec types.
        bytes1 callType = bytes1(mode[0]);
        bytes1 execType = bytes1(mode[1]);
        bool callTypeOk = uint8(callType) == 0x00 || uint8(callType) == 0x01 || uint8(callType) == 0xff;
        bool execTypeOk = uint8(execType) == 0x00 || uint8(execType) == 0x01;
        return callTypeOk && execTypeOk;
    }

    function entryPoint() external pure returns (address) {
        return 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    }
}
