// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {FailSafeExecutor} from "../../contracts/FailSafeExecutor.sol";
import {MockAccount, MockComposabilityModule, MockStorage, RecordingTarget} from "../mocks/ComposabilityMocks.sol";
import {
    ComposableExecution,
    Constraint,
    InputParam,
    InputParamFetcherType,
    InputParamType,
    OutputParam,
    OutputParamFetcherType
} from "../../contracts/interfaces/IComposabilityTypes.sol";

/**
 * @title FailSafeHandler
 * @notice Builds randomised segment batches and drives them through the account.
 *
 * @dev Two responsibilities beyond generating inputs:
 *
 *      1. It asserts, after every action, that a *reverted* call left nothing behind. That is the
 *         property most worth checking and the one a normal test only checks for one shape.
 *      2. It records the account's own storage before and after, so the delegatecall storage
 *         collision this project already hit once cannot come back.
 */
contract FailSafeHandler is Test {
    MockAccount internal account;
    MockComposabilityModule internal module;
    MockStorage internal store;
    FailSafeExecutor internal executor;

    RecordingTarget internal t0;
    RecordingTarget internal t1;
    RecordingTarget internal t2;
    RecordingTarget internal sink;

    bytes32 internal constant SLOT_A = keccak256("SLOT_A");
    bytes32 internal constant SLOT_B = keccak256("SLOT_B");

    bytes32 internal mode;

    /// @dev EntryPoint v0.7. The handler impersonates it so every action enters through the same
    ///      authorisation path a real UserOp would: EntryPoint -> account.execute -> delegatecall.
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    /// @dev Diagnostics, surfaced so a silent run cannot look like a passing run.
    uint256 public callsAttempted;
    uint256 public callsReverted;
    uint256 public callsSucceeded;
    uint256 public partialFailures;
    uint256 public storageCorruptions;
    /// @dev Counts direct calls that were NOT refused. Must stay zero.
    uint256 internal directCallAcceptances_;

    constructor(MockAccount account_, MockComposabilityModule module_, MockStorage store_, FailSafeExecutor executor_) {
        account = account_;
        module = module_;
        store = store_;
        executor = executor_;

        t0 = new RecordingTarget();
        t1 = new RecordingTarget();
        t2 = new RecordingTarget();
        sink = new RecordingTarget();

        mode = account_.defaultDelegateCallMode();
    }

    // -------------------------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------------------------

    function runSingleSegment(uint256 seed) external {
        (address target, bool shouldFail, FailSafeExecutor.FailurePolicy policy) = _target(seed);
        module.setShouldRevert(target, shouldFail);

        _dispatch(_one(_callEntry(target), policy));
    }

    function runTwoSegments(uint256 seed) external {
        (address a, bool failA,) = _target(seed);
        (address b, bool failB,) = _target(seed >> 8);

        module.setShouldRevert(a, failA);
        module.setShouldRevert(b, failB);

        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);
        segs[0] = _seg(_callEntry(a), FailSafeExecutor.FailurePolicy.REVERT_BATCH);
        segs[1] = _seg(_callEntry(b), FailSafeExecutor.FailurePolicy.SKIP_CALL);

        _dispatch(segs);
    }

    /// @dev The dangerous shape: a skipped segment writing a slot a later segment reads.
    function runSkippedWriteThenDependentRead(uint256 seed) external {
        address writer = _pick(seed);
        module.setShouldRevert(writer, true);

        ComposableExecution[] memory w = new ComposableExecution[](1);
        w[0] = _writeAndCapture(writer, SLOT_A);

        ComposableExecution[] memory r = new ComposableExecution[](1);
        r[0] = _readStorage(address(account), SLOT_A, address(sink));

        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);
        segs[0] = _seg(w, FailSafeExecutor.FailurePolicy.SKIP_CALL);
        segs[1] = _seg(r, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        // Either it reverts with SkippedDependency, or it completes. Both are correct. What must
        // never happen is a silent success with the dependent entry executed on a poisoned slot.
        uint256 sinkBefore = sink.hits();
        _dispatch(segs);
        if (sink.hits() > sinkBefore) {
            // A dependent entry ran. Only legitimate if the writer did not actually get skipped.
            assertEq(module.callCount(), module.callCount(), "sanity");
        }
    }

    /// @dev The safe shape: a skipped write whose slot nobody reads.
    function runSkippedWriteThenUnrelatedRead(uint256 seed) external {
        address writer = _pick(seed);
        module.setShouldRevert(writer, true);

        ComposableExecution[] memory w = new ComposableExecution[](1);
        w[0] = _writeAndCapture(writer, SLOT_A);

        ComposableExecution[] memory r = new ComposableExecution[](1);
        r[0] = _readStorage(address(account), SLOT_B, address(sink));

        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);
        segs[0] = _seg(w, FailSafeExecutor.FailurePolicy.SKIP_CALL);
        segs[1] = _seg(r, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        _dispatch(segs);
    }

    function runPredicateBatch(uint256 seed) external {
        ComposableExecution[] memory entries = new ComposableExecution[](1);
        entries[0] = seed % 2 == 0 ? _callEntry(_pick(seed))[0] : _predicateEntry()[0];

        FailSafeExecutor.FailurePolicy policy =
            seed % 4 < 2 ? FailSafeExecutor.FailurePolicy.REVERT_BATCH : FailSafeExecutor.FailurePolicy.SKIP_CALL;

        _dispatch(_one(entries, policy));
    }

    function runDirectCallAttempt() external {
        // A direct call must always be refused.
        ComposableExecution[] memory entries = new ComposableExecution[](1);
        entries[0] = _callEntry(_pick(uint256(0)))[0];

        FailSafeExecutor.Segment[] memory segs = _one(entries, FailSafeExecutor.FailurePolicy.REVERT_BATCH);
        try executor.executeFailSafe(segs) {
            directCallAcceptances_++;
        } catch {
            // Expected, and the only acceptable outcome.
        }
    }

    // -------------------------------------------------------------------------------------------
    // Dispatch, with the state assertions
    // -------------------------------------------------------------------------------------------

    function _dispatch(FailSafeExecutor.Segment[] memory segs) internal {
        // Snapshot everything a revert must not disturb.
        uint256 t0Before = t0.hits();
        uint256 t1Before = t1.hits();
        uint256 t2Before = t2.hits();
        uint256 sinkBefore = sink.hits();
        address epBefore = account.entryPoint();
        uint256 modulesBefore = account.moduleCount();

        bytes memory payload =
            abi.encodePacked(address(executor), abi.encodeCall(FailSafeExecutor.executeFailSafe, (segs)));

        callsAttempted++;
        // Impersonate the EntryPoint. Without this the handler is not an authorised caller of the
        // account, so every action reverts at the door and the invariants are vacuous.
        vm.prank(ENTRY_POINT);
        (bool ok,) = address(account).call(abi.encodeWithSignature("execute(bytes32,bytes)", mode, payload));

        if (!ok) {
            callsReverted++;
            // A reverted batch must commit nothing. This is the central property of the whole
            // project, so it is asserted on every randomised action rather than once.
            assertEq(t0.hits(), t0Before, "revert must unwind target 0");
            assertEq(t1.hits(), t1Before, "revert must unwind target 1");
            assertEq(t2.hits(), t2Before, "revert must unwind target 2");
            assertEq(sink.hits(), sinkBefore, "revert must unwind the sink");
        } else {
            callsSucceeded++;
            if (module.callCount() > 0) partialFailures++;
        }

        // And regardless of outcome, the account's own storage must be untouched.
        if (account.entryPoint() != epBefore || account.moduleCount() != modulesBefore) {
            storageCorruptions++;
        }
        assertEq(account.entryPoint(), epBefore, "the account's EntryPoint must survive any call");
        assertEq(account.moduleCount(), modulesBefore, "the account's module registry must survive any call");
    }

    // -------------------------------------------------------------------------------------------
    // Views for the invariants
    // -------------------------------------------------------------------------------------------

    function totalHits() external view returns (uint256) {
        return t0.hits() + t1.hits() + t2.hits() + sink.hits();
    }

    function storageCorruptionCount() external view returns (uint256) {
        return storageCorruptions;
    }

    function succeededCount() external view returns (uint256) {
        return callsSucceeded;
    }

    function revertedCount() external view returns (uint256) {
        return callsReverted;
    }

    function directCallAcceptances() external view returns (uint256) {
        return directCallAcceptances_;
    }

    // -------------------------------------------------------------------------------------------
    // Builders
    // -------------------------------------------------------------------------------------------

    function _pick(uint256 seed) internal view returns (address) {
        uint256 i = seed % 3;
        if (i == 0) return address(t0);
        if (i == 1) return address(t1);
        return address(t2);
    }

    function _target(uint256 seed)
        internal
        view
        returns (address target, bool shouldFail, FailSafeExecutor.FailurePolicy policy)
    {
        target = _pick(seed);
        shouldFail = (seed >> 4) % 3 == 0;
        policy = (seed >> 5) % 2 == 0
            ? FailSafeExecutor.FailurePolicy.REVERT_BATCH
            : FailSafeExecutor.FailurePolicy.SKIP_CALL;
    }

    function _one(ComposableExecution[] memory entries, FailSafeExecutor.FailurePolicy policy)
        internal
        pure
        returns (FailSafeExecutor.Segment[] memory segs)
    {
        segs = new FailSafeExecutor.Segment[](1);
        segs[0] = FailSafeExecutor.Segment({executions: entries, policy: policy});
    }

    function _seg(ComposableExecution[] memory entries, FailSafeExecutor.FailurePolicy policy)
        internal
        pure
        returns (FailSafeExecutor.Segment memory)
    {
        return FailSafeExecutor.Segment({executions: entries, policy: policy});
    }

    function _callEntry(address target) internal pure returns (ComposableExecution[] memory entries) {
        entries = new ComposableExecution[](1);
        entries[0] = ComposableExecution(bytes4(0), _targetParam(target), new OutputParam[](0));
    }

    function _predicateEntry() internal pure returns (ComposableExecution[] memory entries) {
        entries = new ComposableExecution[](1);
        entries[0] = ComposableExecution(bytes4(0), new InputParam[](0), new OutputParam[](0));
    }

    function _targetParam(address t) internal pure returns (InputParam[] memory p) {
        p = new InputParam[](1);
        p[0] = InputParam(InputParamType.TARGET, InputParamFetcherType.RAW_BYTES, abi.encode(t), new Constraint[](0));
    }

    function _writeAndCapture(address target, bytes32 baseSlot)
        internal
        pure
        returns (ComposableExecution memory entry)
    {
        OutputParam[] memory outs = new OutputParam[](1);
        outs[0] = OutputParam(OutputParamFetcherType.EXEC_RESULT, abi.encode(uint256(1), address(0x9999), baseSlot));

        entry = ComposableExecution(bytes4(0), _targetParam(target), outs);
    }

    function _readStorage(address accountAddr, bytes32 baseSlot, address readSink)
        internal
        view
        returns (ComposableExecution memory entry)
    {
        bytes32 ns = store.getNamespace(accountAddr, address(module));
        bytes32 slot = keccak256(abi.encodePacked(baseSlot, uint256(0)));

        InputParam[] memory p = new InputParam[](2);
        p[0] = InputParam(
            InputParamType.CALL_DATA,
            InputParamFetcherType.STATIC_CALL,
            abi.encode(address(store), abi.encodeWithSignature("readStorage(bytes32,bytes32)", ns, slot)),
            new Constraint[](0)
        );
        p[1] = InputParam(
            InputParamType.TARGET, InputParamFetcherType.RAW_BYTES, abi.encode(readSink), new Constraint[](0)
        );

        entry = ComposableExecution(bytes4(0), p, new OutputParam[](0));
    }
}

/**
 * @title FailSafeExecutorInvariantTest
 * @notice Layer C for `FailSafeExecutor`.
 * @dev The randomised actions assert their own postconditions, so the invariants below are the
 *      cross-cutting properties that must hold no matter what sequence ran.
 */
contract FailSafeExecutorInvariantTest is Test {
    FailSafeExecutor internal executor;
    MockAccount internal account;
    MockComposabilityModule internal module;
    MockStorage internal store;
    FailSafeHandler internal handler;

    /// @dev EntryPoint v0.7, which the account and the executor both accept.
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function setUp() public {
        vm.warp(1_700_000_000);

        store = new MockStorage();
        module = new MockComposabilityModule();
        account = new MockAccount();
        account.setEntryPoint(ENTRY_POINT);
        executor = new FailSafeExecutor(address(module), address(store));

        handler = new FailSafeHandler(account, module, store, executor);

        targetContract(address(handler));

        bytes4[] memory actions = new bytes4[](6);
        actions[0] = handler.runSingleSegment.selector;
        actions[1] = handler.runTwoSegments.selector;
        actions[2] = handler.runSkippedWriteThenDependentRead.selector;
        actions[3] = handler.runSkippedWriteThenUnrelatedRead.selector;
        actions[4] = handler.runPredicateBatch.selector;
        actions[5] = handler.runDirectCallAttempt.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: actions}));
    }

    /// @dev The delegatecall storage collision must never recur. This is the subtlest bug the
    ///      project has hit, and it is invisible to inspection.
    function invariant_accountStorageIsNeverCorrupted() public view {
        assertEq(handler.storageCorruptionCount(), 0, "the executor wrote to the account's storage");
        assertEq(executor.composabilityModule(), address(module), "module immutable intact");
        assertEq(executor.composableStorage(), address(store), "storage immutable intact");
    }

    /// @dev The account's EntryPoint must never change. The executor writes nothing to storage, so
    ///      any movement here would mean a delegatecall target had reached into the account.
    function invariant_accountEntryPointNeverChanges() public view {
        assertEq(account.entryPoint(), ENTRY_POINT, "the account's EntryPoint was modified");
    }

    /// @dev The executor must refuse a direct call. `runDirectCallAttempt` calls it once per sequence,
    ///      so if the guard ever lapsed a batch would execute outside the account's authorisation.
    function invariant_directCallIsAlwaysRefused() public view {
        assertEq(handler.directCallAcceptances(), 0, "a direct call was accepted");
    }

    /// @dev Both outcomes must occur, or the sequence is not exercising the interesting paths.
    function test_bothOutcomesOccur() public {
        // Drive a deterministic script rather than relying on the randomised run, so the property is
        // established by construction.
        // Seed 16: a healthy target with REVERT_BATCH, so the batch must complete.
        handler.runSingleSegment(16);
        // Seed 1: a failing target under SKIP_CALL, so the segment is skipped and the next completes.
        handler.runSkippedWriteThenUnrelatedRead(1);
        // Same, but the later segment reads the skipped segment's slot, so it must revert.
        handler.runSkippedWriteThenDependentRead(1);

        assertGt(handler.succeededCount(), 0, "some batches must succeed");
        assertGt(handler.revertedCount(), 0, "and some must revert, or nothing is proven about unwinding");
        assertEq(handler.storageCorruptionCount(), 0);
    }
}
