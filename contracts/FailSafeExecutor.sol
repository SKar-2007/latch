// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IComposableExecutionModule, IStorage} from "./interfaces/IComposableExecution.sol";
import {
    ComposableExecution,
    InputParam,
    InputParamFetcherType,
    InputParamType,
    OutputParam,
    OutputParamFetcherType
} from "./interfaces/IComposabilityTypes.sol";

/**
 * @title FailSafeExecutor
 * @notice Opt-in partial-failure semantics for ERC-8211 batches, without modifying the audited engine.
 *
 * @dev WHY THIS EXISTS
 *
 * ERC-8211 is strictly atomic. The composability module dispatches every entry with
 * `ModeLib.encodeSimpleSingle()`, which is `EXECTYPE_DEFAULT`, and its loop has no error handling, so
 * a revert in any entry unwinds the whole batch. `ConstraintType.SKIP` does not help: it is a
 * constraint that unconditionally returns true and is unrelated to skipping a call.
 *
 * The account does support try-mode execution. All four Nexus builds deployed on Base Sepolia carry
 * the `TryExecuteUnsuccessful` event topic and the `executeFromExecutor` selector. The module simply
 * never asks for it.
 *
 * So rather than fork audited code, this contract drives the **unmodified** module one segment at a
 * time and chooses the exec type per segment.
 *
 * @dev INVOCATION: delegatecall only
 *
 *      The composability module dispatches through `IERC7579Account(msg.sender).executeFromExecutor`,
 *      so it must be called *by the account*. Under `delegatecall` this contract's code runs in the
 *      account's context, its outbound call to the module originates from the account, and the
 *      module's dispatch resolves correctly. A direct call is rejected by `DelegateCallOnly`.
 *
 *          account.execute(
 *              encode(CALLTYPE_DELEGATECALL, EXECTYPE_DEFAULT, MODE_DEFAULT, payload),
 *              abi.encodePacked(address(this), abi.encodeCall(FailSafeExecutor.executeFailSafe, (segs)))
 *          );
 *
 * @dev THIS CONTRACT USES NO STORAGE. That is a hard requirement, not a style choice.
 *
 *      A delegatecall target executes in the account's context, so every storage slot it declares is
 *      really a slot in the smart account. Slot 0 of this contract would be the account's slot 0.
 *      Concretely: a `bytes32[]` at slot 0 read the account's `entryPoint` as its length, and the
 *      `delete` that clears it tried to zero roughly 2^64 elements, exhausting the gas limit. This was
 *      found by the test suite, not by inspection.
 *
 *      Per-account registries, reentrancy guards, pause flags and counters are all unavailable here
 *      for the same reason. State that must not outlive one call belongs in memory, and memory is
 *      discarded when the call returns, which is exactly the lifetime required.
 *
 *      The single external call is to `composabilityModule`, an immutable address chosen at deploy
 *      time, so no reentrancy guard is needed: there is no callback path an attacker can influence.
 *
 * @dev THREE RULES THAT MAKE PARTIAL FAILURE SAFE RATHER THAN DANGEROUS
 *
 *      1. A predicate entry, meaning one with no TARGET parameter, may never sit in a SKIP_CALL
 *         segment. Skipping it would mean skipping a safety assertion. Enforced here, on-chain,
 *         because the client is not in the trust boundary. See `PredicateNotSkippable`.
 *
 *      2. Provenance is derived from the batch and never accepted from the caller. Writes are read
 *         off each `OutputParam`; reads are decoded from each `STATIC_CALL` input aimed at the storage
 *         contract. A malformed storage read reverts rather than being treated as reading nothing,
 *         because silently ignoring it would disable rule 3. See `MalformedStorageRead`.
 *
 *      3. A skipped segment poisons every slot it would have written. Any later segment reading a
 *         poisoned slot reverts the whole call. Without this, a skipped swap followed by a deposit
 *         sized from that swap's captured output would proceed on a stale value. See
 *         `SkippedDependency`.
 *
 *      A `BALANCE` fetcher needs no provenance tracking. It observes live state, so a skipped
 *      segment's writes are simply not reflected, and the next segment's own constraint decides
 *      whether that is acceptable. The existing constraint machinery does that work.
 *
 * @dev Gas: a skipped segment's inner call still burns gas. SKIP_CALL preserves value, not gas.
 *
 * @dev Unaudited. Ships disabled by default. See ADR-0002 and risk R3 in docs/12-risk-matrix.md.
 */
contract FailSafeExecutor {
    /// @notice Failure behaviour for one segment.
    enum FailurePolicy {
        REVERT_BATCH,
        SKIP_CALL
    }

    /// @notice One contiguous run of entries sharing a policy.
    struct Segment {
        ComposableExecution[] executions;
        FailurePolicy policy;
    }

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event SegmentExecuted(uint256 indexed segmentIndex, uint256 entryCount);
    event SegmentSkipped(uint256 indexed segmentIndex, uint256 entryCount, bytes reason);
    event FailSafeCompleted(uint256 segmentsExecuted, uint256 segmentsSkipped);

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error DelegateCallOnly();
    error PredicateNotSkippable(uint256 segmentIndex, uint256 entryIndex);
    error SkippedDependency(uint256 segmentIndex, bytes32 valueSlot);
    error MalformedStorageRead(uint256 segmentIndex, uint256 entryIndex);
    error Unauthorized(address caller);
    error ZeroModule();
    error EmptySegment(uint256 segmentIndex);
    error TooManySegments(uint256 count);

    /// @notice Upper bound on segments per call. Gas-bounding only.
    uint256 public constant MAX_SEGMENTS = 32;
    /// @notice Default EntryPoint v0.7. Also the only EntryPoint accepted; see the storage note.
    address public constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    /// @dev Bytes of one ABI word.
    uint256 private constant WORD = 32;
    /// @dev Upper bound on return values honoured per capture. Gas-bounding against a hostile payload.
    uint256 private constant MAX_CAPTURED_VALUES = 64;

    /// @notice The audited composability module. Never modified.
    address public immutable composabilityModule;
    /// @notice The `Storage` contract, used to derive namespaces and to detect storage reads.
    address public immutable composableStorage;
    /// @dev Deployment address of this contract, used to reject direct calls.
    address private immutable _self;

    constructor(address module, address storage_) {
        if (module == address(0) || module.code.length == 0) revert ZeroModule();
        composabilityModule = module;
        composableStorage = storage_;
        _self = address(this);
    }

    // ---------------------------------------------------------------------------------------------
    // Entry point
    // ---------------------------------------------------------------------------------------------

    /**
     * @notice Executes a batch as policy-scoped segments.
     * @dev Must be reached by `delegatecall` from the account.
     *
     *      A `REVERT_BATCH` failure aborts the entire call and bubbles the original revert data, so a
     *      genuine bug is never swallowed. A `SKIP_CALL` failure is recorded and the loop advances,
     *      unless a later segment depended on what the skipped segment would have written, in which
     *      case the whole call reverts.
     */
    function executeFailSafe(Segment[] calldata segments) external {
        if (address(this) == _self) revert DelegateCallOnly();

        uint256 count = segments.length;
        if (count == 0) revert EmptySegment(0);
        if (count > MAX_SEGMENTS) revert TooManySegments(count);

        // Authorisation. Under delegatecall msg.sender is preserved from the outer context, so for a
        // UserOp it is the EntryPoint, and for a direct account call it is the account itself.
        address caller = msg.sender;
        if (caller != address(this) && caller != ENTRY_POINT_V07) revert Unauthorized(caller);

        // Poison lives in memory for the duration of this call and no longer. Nothing to reset,
        // because memory does not survive the return.
        bytes32[] memory poisoned = new bytes32[](MAX_SEGMENTS * MAX_CAPTURED_VALUES);
        uint256 poisonCount;

        uint256 executed;
        uint256 skipped;

        for (uint256 i; i < count; i++) {
            Segment calldata segment = segments[i];
            if (segment.executions.length == 0) revert EmptySegment(i);

            // Rule 1, before anything runs.
            _validateSegment(i, segment);
            // Rule 3, read side.
            _assertNoPoisonedReads(i, segment, poisoned, poisonCount);

            if (segment.policy == FailurePolicy.REVERT_BATCH) {
                // Bubbles the original revert data.
                IComposableExecutionModule(composabilityModule).executeComposableCall(segment.executions);
                executed++;
                emit SegmentExecuted(i, segment.executions.length);
            } else {
                (bool ok, bytes memory reason) = composabilityModule.call(
                    abi.encodeWithSelector(
                        IComposableExecutionModule.executeComposableCall.selector, segment.executions
                    )
                );
                if (ok) {
                    executed++;
                    emit SegmentExecuted(i, segment.executions.length);
                } else {
                    skipped++;
                    emit SegmentSkipped(i, segment.executions.length, reason);
                    // Rule 3, write side. Everything this segment would have written is now suspect.
                    poisonCount = _poisonWrites(segment, poisoned, poisonCount);
                }
            }
        }

        emit FailSafeCompleted(executed, skipped);
    }

    // ---------------------------------------------------------------------------------------------
    // Namespace
    // ---------------------------------------------------------------------------------------------

    /**
     * @notice The Storage namespace a batch executed through this contract will use.
     * @dev Batches routed through the composability module resolve `keccak256(account, module)`,
     *      because the module is the caller of `Storage.writeStorage`. Batches executed by the
     *      account's own native `executeComposable` resolve `keccak256(account, account)`.
     *
     *      These differ, and both are stable. The client must use whichever matches the path it chose.
     *      This helper removes the guesswork.
     */
    function namespaceFor(address account) external view returns (bytes32) {
        return IStorage(composableStorage).getNamespace(account, composabilityModule);
    }

    /// @notice The namespace the account's native composable execution uses.
    function nativeNamespaceFor(address account) external view returns (bytes32) {
        return IStorage(composableStorage).getNamespace(account, account);
    }

    /// @notice The fully-qualified slot for a base slot and a return-value index, module path.
    function valueSlotFor(address account, bytes32 baseSlot, uint256 index) external view returns (bytes32) {
        bytes32 ns = IStorage(composableStorage).getNamespace(account, composabilityModule);
        return IStorage(composableStorage).getNamespacedSlot(ns, keccak256(abi.encodePacked(baseSlot, index)));
    }

    /**
     * @notice Reports as an ERC-7579 executor module.
     * @dev Informational only. This contract is a **delegatecall target, not an installed module**.
     *      It implements no `onInstall` or `isInitialized`, because a delegatecall target cannot hold
     *      registry state: its storage is the account's. Reporting a type id it cannot honour would
     *      be worse than not reporting one. The account authorises it through its own `execute`.
     */
    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == 2;
    }

    // ---------------------------------------------------------------------------------------------
    // Internal: rule 1
    // ---------------------------------------------------------------------------------------------

    /// @dev A predicate entry in a skippable segment could be skipped, which would mean skipping a
    ///      safety assertion.
    function _validateSegment(uint256 segIndex, Segment calldata segment) private pure {
        if (segment.policy != FailurePolicy.SKIP_CALL) return;

        for (uint256 e; e < segment.executions.length; e++) {
            if (!_hasTarget(segment.executions[e])) revert PredicateNotSkippable(segIndex, e);
        }
    }

    /// @dev A predicate entry is one with no TARGET parameter.
    function _hasTarget(ComposableExecution calldata execution) private pure returns (bool) {
        InputParam[] calldata params = execution.inputParams;
        for (uint256 i; i < params.length; i++) {
            if (params[i].paramType == InputParamType.TARGET) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------------------------------------
    // Internal: rules 2 and 3
    // ---------------------------------------------------------------------------------------------

    /// @dev Rule 3, read side. Reverts on a malformed storage read rather than ignoring it.
    function _assertNoPoisonedReads(
        uint256 segIndex,
        Segment calldata segment,
        bytes32[] memory poisoned,
        uint256 poisonCount
    ) private view {
        bytes32[] memory reads = _deriveReads(segIndex, segment);
        for (uint256 i; i < reads.length; i++) {
            if (_indexOf(poisoned, poisonCount, reads[i])) revert SkippedDependency(segIndex, reads[i]);
        }
    }

    /// @dev Rule 3, write side. Returns the new poison count.
    function _poisonWrites(Segment calldata segment, bytes32[] memory poisoned, uint256 poisonCount)
        private
        pure
        returns (uint256)
    {
        bytes32[] memory writes = _deriveWrites(segment);
        for (uint256 i; i < writes.length; i++) {
            if (poisonCount >= poisoned.length) break; // bounded by MAX_SEGMENTS * MAX_CAPTURED_VALUES
            bytes32 slot = writes[i];
            if (!_indexOf(poisoned, poisonCount, slot)) poisoned[poisonCount++] = slot;
        }
        return poisonCount;
    }

    /**
     * @dev Value slots this segment would write, derived from its `OutputParam`s.
     *
     *      The engine writes return value `i` to `keccak256(abi.encodePacked(baseSlot, i))`, and a
     *      later `STATIC_CALL` read of `Storage.readStorage` looks up that same derived slot. So the
     *      poison must be recorded against the derived slots, not the base slot. Poisoning the base
     *      slot instead would never match a read, and the provenance rule would silently never fire.
     *      That bug is what this comment exists to prevent repeating.
     *
     *      Two passes rather than allocate-then-trim: the length word of a memory array lives at
     *      `slots - 32`, so `mstore(slots, n)` overwrites the first element, not the length.
     */
    function _deriveWrites(Segment calldata segment) private pure returns (bytes32[] memory slots) {
        uint256 total;
        for (uint256 e; e < segment.executions.length; e++) {
            OutputParam[] calldata outs = segment.executions[e].outputParams;
            for (uint256 o; o < outs.length; o++) {
                (uint256 returnValues,) = _decodeOutputParam(outs[o]);
                if (returnValues > MAX_CAPTURED_VALUES) returnValues = MAX_CAPTURED_VALUES;
                total += returnValues;
            }
        }

        slots = new bytes32[](total);

        uint256 k;
        for (uint256 e; e < segment.executions.length; e++) {
            OutputParam[] calldata outs = segment.executions[e].outputParams;
            for (uint256 o; o < outs.length; o++) {
                (uint256 returnValues, bytes32 baseSlot) = _decodeOutputParam(outs[o]);
                if (returnValues > MAX_CAPTURED_VALUES) returnValues = MAX_CAPTURED_VALUES;

                for (uint256 i; i < returnValues; i++) {
                    slots[k++] = keccak256(abi.encodePacked(baseSlot, i));
                }
            }
        }
    }

    /// @dev Reads `(returnValues, baseSlot)` out of an OutputParam's paramData.
    function _decodeOutputParam(OutputParam calldata out)
        private
        pure
        returns (uint256 returnValues, bytes32 baseSlot)
    {
        bytes calldata data = out.paramData;

        if (out.fetcherType == OutputParamFetcherType.EXEC_RESULT) {
            // abi.encode(uint256, address, bytes32): three words.
            if (data.length < 3 * WORD) return (0, bytes32(0));
            assembly {
                returnValues := calldataload(data.offset)
                baseSlot := calldataload(add(data.offset, 0x40))
            }
        } else {
            // abi.encode(uint256, address, bytes, address, bytes32): five words of head.
            if (data.length < 5 * WORD) return (0, bytes32(0));
            assembly {
                returnValues := calldataload(data.offset)
                baseSlot := calldataload(add(data.offset, 0x80))
            }
        }
    }

    /**
     * @dev Value slots this segment reads, derived from `STATIC_CALL` inputs aimed at Storage.
     *
     *      paramData is `abi.encode(address target, bytes callData)`. A read is recognised by the
     *      target being the configured storage contract and callData being
     *      `readStorage(bytes32 namespace, bytes32 slot)`.
     */
    function _deriveReads(uint256 segIndex, Segment calldata segment) private view returns (bytes32[] memory slots) {
        uint256 total;
        for (uint256 e; e < segment.executions.length; e++) {
            total += _countStorageReads(segIndex, e, segment.executions[e]);
        }

        slots = new bytes32[](total);

        uint256 k;
        for (uint256 e; e < segment.executions.length; e++) {
            InputParam[] calldata params = segment.executions[e].inputParams;
            for (uint256 i; i < params.length; i++) {
                if (params[i].fetcherType != InputParamFetcherType.STATIC_CALL) continue;

                (address target, bytes memory callData) = abi.decode(params[i].paramData, (address, bytes));
                if (target != composableStorage) continue;

                slots[k++] = _slotFromReadCall(callData);
            }
        }
    }

    /// @dev Counts the readStorage calls in one entry, rejecting malformed ones.
    function _countStorageReads(uint256 segIndex, uint256 entryIndex, ComposableExecution calldata execution)
        private
        view
        returns (uint256)
    {
        InputParam[] calldata params = execution.inputParams;
        uint256 n;

        for (uint256 i; i < params.length; i++) {
            if (params[i].fetcherType != InputParamFetcherType.STATIC_CALL) continue;

            (address target, bytes memory callData) = abi.decode(params[i].paramData, (address, bytes));
            if (target != composableStorage) continue;

            if (callData.length < 4 + 2 * WORD) revert MalformedStorageRead(segIndex, entryIndex);
            if (_selectorOf(callData) != IStorage.readStorage.selector) {
                revert MalformedStorageRead(segIndex, entryIndex);
            }

            n++;
        }
        return n;
    }

    /**
     * @dev Extracts the slot from an ABI-encoded `readStorage(bytes32 namespace, bytes32 slot)` call.
     *
     *      Memory layout of a `bytes` holding that call: the length word sits at `callData`, the data
     *      begins at `callData + 0x20`, the selector occupies the first 4 bytes, so the namespace word
     *      starts at `+0x24` and the slot word at `+0x44`.
     */
    function _slotFromReadCall(bytes memory callData) private pure returns (bytes32 slot) {
        assembly {
            slot := mload(add(callData, 0x44))
        }
    }

    function _selectorOf(bytes memory callData) private pure returns (bytes4 sel) {
        assembly {
            sel := mload(add(callData, 0x20))
        }
    }

    /// @dev Linear scan. The array is bounded by MAX_SEGMENTS * MAX_CAPTURED_VALUES.
    function _indexOf(bytes32[] memory haystack, uint256 len, bytes32 needle) private pure returns (bool) {
        for (uint256 i; i < len; i++) {
            if (haystack[i] == needle) return true;
        }
        return false;
    }
}
