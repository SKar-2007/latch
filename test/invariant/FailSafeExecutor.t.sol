// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, Vm} from "forge-std/Test.sol";
import {FailSafeExecutor} from "../../contracts/FailSafeExecutor.sol";
import {MockAccount, MockComposabilityModule, MockStorage, RecordingTarget} from "../mocks/ComposabilityMocks.sol";
import {IStorage} from "../../contracts/interfaces/IComposableExecution.sol";
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
 * @title FailSafeExecutor test
 * @notice Layer B from docs/09-testing-strategy.md. Focuses on the three rules and on the state-diff
 *         assertion that matters most: a reverted batch must change nothing.
 */
contract FailSafeExecutorTest is Test {
    FailSafeExecutor internal executor;
    MockAccount internal account;
    MockComposabilityModule internal module;
    MockStorage internal store;
    RecordingTarget internal good;
    RecordingTarget internal bad;
    /// @dev A distinct sink for read entries, so hit counts are not double-counted.
    RecordingTarget internal sink;

    /// @dev The EntryPoint the account accepts. Set to the real v0.7 address in setUp, because
    ///      FailSafeExecutor authorises that constant explicitly and would correctly reject a mock.
    address internal ep;

    /// @dev Cached in setUp. Computing it inline would be an external call that consumes vm.prank.
    bytes32 internal mode;

    bytes32 internal constant SLOT_A = keccak256("SLOT_A");
    bytes32 internal constant SLOT_B = keccak256("SLOT_B");

    function setUp() public {
        vm.warp(1_700_000_000);

        store = new MockStorage();
        module = new MockComposabilityModule();
        good = new RecordingTarget();
        bad = new RecordingTarget();
        sink = new RecordingTarget();

        account = new MockAccount();

        executor = new FailSafeExecutor(address(module), address(store));

        ep = executor.ENTRY_POINT_V07();
        account.setEntryPoint(ep);

        mode = account.defaultDelegateCallMode();
    }

    /// @dev Drives the executor through the account, as a delegatecall, as the EntryPoint.
    ///      Nothing between vm.prank and account.execute may be an external call, or the prank is
    ///      consumed by it.
    function _run(FailSafeExecutor.Segment[] memory segs) internal {
        bytes memory payload =
            abi.encodePacked(address(executor), abi.encodeCall(FailSafeExecutor.executeFailSafe, (segs)));
        vm.prank(ep);
        account.execute(mode, payload);
    }

    /// @dev As `_run`, but expecting a revert.
    ///      vm.prank must come BEFORE vm.expectRevert: a cheatcode call placed between the
    ///      expectation and the target consumes the expectation, silently passing nothing.
    function _runExpect(FailSafeExecutor.Segment[] memory segs, bytes memory err) internal {
        bytes memory payload =
            abi.encodePacked(address(executor), abi.encodeCall(FailSafeExecutor.executeFailSafe, (segs)));
        vm.prank(ep);
        vm.expectRevert(err);
        account.execute(mode, payload);
    }

    // -------------------------------------------------------------------------------------------
    // Invocation shape
    // -------------------------------------------------------------------------------------------

    function test_revertsOnDirectCall() public {
        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        vm.expectRevert(FailSafeExecutor.DelegateCallOnly.selector);
        executor.executeFailSafe(segs);
    }

    function test_revertsOnDirectCallFromEntryPoint() public {
        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        vm.prank(ep);
        vm.expectRevert(FailSafeExecutor.DelegateCallOnly.selector);
        executor.executeFailSafe(segs);
    }

    function test_executesViaDelegateCallFromEntryPoint() public {
        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        _run(segs);

        assertEq(good.hits(), 1, "the entry ran");
        assertEq(module.callCount(), 1);
    }

    function test_revertsFromUnauthorisedCallerViaDelegateCall() public {
        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        bytes memory payload =
            abi.encodePacked(address(executor), abi.encodeCall(FailSafeExecutor.executeFailSafe, (segs)));
        address stranger = makeAddr("random");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MockAccount.NotAuthorized.selector));
        account.execute(mode, payload);
    }

    function test_revertsOnEmptyBatch() public {
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](0);

        _runExpect(segs, abi.encodeWithSelector(FailSafeExecutor.EmptySegment.selector, 0));
    }

    function test_revertsOnEmptySegment() public {
        ComposableExecution[][] memory none = new ComposableExecution[][](1);
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](1);
        segs[0] = FailSafeExecutor.Segment({executions: none[0], policy: FailSafeExecutor.FailurePolicy.REVERT_BATCH});

        _runExpect(segs, abi.encodeWithSelector(FailSafeExecutor.EmptySegment.selector, 0));
    }

    function test_revertsAboveMaxSegments() public {
        uint256 n = executor.MAX_SEGMENTS() + 1;
        ComposableExecution[] memory entry = _oneCall(address(good));
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](n);
        for (uint256 i; i < n; i++) {
            segs[i] = FailSafeExecutor.Segment({executions: entry, policy: FailSafeExecutor.FailurePolicy.REVERT_BATCH});
        }

        _runExpect(segs, abi.encodeWithSelector(FailSafeExecutor.TooManySegments.selector, n));
    }

    // -------------------------------------------------------------------------------------------
    // Rule 1: a predicate entry may never be skippable
    // -------------------------------------------------------------------------------------------

    function test_revertsWhenPredicateEntryIsSkippable() public {
        // A predicate entry has no TARGET, so it must not be allowed inside a SKIP_CALL segment.
        ComposableExecution[] memory entries = new ComposableExecution[](1);
        entries[0] = _predicateEntry();

        FailSafeExecutor.Segment[] memory segs = _oneSegment(entries, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        _runExpect(segs, abi.encodeWithSelector(FailSafeExecutor.PredicateNotSkippable.selector, 0, 0));
    }

    /// @dev The same entry is fine in a REVERT_BATCH segment. The rule is about skippability only.
    function test_allowsPredicateEntryInRevertBatchSegment() public {
        ComposableExecution[] memory entries = new ComposableExecution[](1);
        entries[0] = _predicateEntry();

        FailSafeExecutor.Segment[] memory segs = _oneSegment(entries, FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        _run(segs);
    }

    function test_reportsTheOffendingEntryIndex() public {
        ComposableExecution[] memory entries = new ComposableExecution[](2);
        entries[0] = _callEntry(address(good));
        entries[1] = _predicateEntry();

        FailSafeExecutor.Segment[] memory segs = _oneSegment(entries, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        _runExpect(segs, abi.encodeWithSelector(FailSafeExecutor.PredicateNotSkippable.selector, 0, 1));
    }

    // -------------------------------------------------------------------------------------------
    // REVERT_BATCH: native atomicity
    // -------------------------------------------------------------------------------------------

    function test_revertBatch_bubblesTheOriginalRevert() public {
        module.setShouldRevert(address(bad), true);

        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(bad)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        _runExpect(segs, "MockComposabilityModule: configured failure");
    }

    function test_revertBatch_aFailedSegmentLeavesEarlierSegmentsReverted() public {
        // Two entries in one atomic segment: the first succeeds, the second fails.
        module.setShouldRevert(address(bad), true);

        ComposableExecution[] memory entries = new ComposableExecution[](2);
        entries[0] = _callEntry(address(good));
        entries[1] = _callEntry(address(bad));

        FailSafeExecutor.Segment[] memory segs = _oneSegment(entries, FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        uint256 hitsBefore = good.hits();

        _runExpect(segs, "MockComposabilityModule: configured failure");

        assertEq(good.hits(), hitsBefore, "a reverted atomic batch must leave no partial effect");
    }

    function test_revertBatch_aLaterFailingSegmentUnwindsTheWholeCall() public {
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);
        segs[0] = _seg(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);
        segs[1] = _seg(_oneCall(address(bad)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);
        module.setShouldRevert(address(bad), true);

        uint256 hitsBefore = good.hits();

        _runExpect(segs, "MockComposabilityModule: configured failure");

        assertEq(good.hits(), hitsBefore, "segment 0 must be unwound by segment 1's failure");
    }

    // -------------------------------------------------------------------------------------------
    // SKIP_CALL: the feature
    // -------------------------------------------------------------------------------------------

    function test_skipCall_completesWhenTheSegmentFails() public {
        module.setShouldRevert(address(bad), true);

        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(bad)), FailSafeExecutor.FailurePolicy.SKIP_CALL);

        _run(segs);

        assertEq(bad.hits(), 0, "the failing call did not happen");
    }

    function test_skipCall_mixedSegmentsComplete() public {
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);
        segs[0] = _seg(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.SKIP_CALL);
        segs[1] = _seg(_oneCall(address(bad)), FailSafeExecutor.FailurePolicy.SKIP_CALL);
        module.setShouldRevert(address(bad), true);

        _run(segs);

        assertEq(good.hits(), 1, "the healthy segment ran");
        assertEq(bad.hits(), 0);
    }

    function test_skipCall_emitsTheExpectedOutcome() public {
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);
        segs[0] = _seg(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.SKIP_CALL);
        segs[1] = _seg(_oneCall(address(bad)), FailSafeExecutor.FailurePolicy.SKIP_CALL);
        module.setShouldRevert(address(bad), true);

        vm.recordLogs();
        _run(segs);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bool sawExecuted;
        bool sawSkipped;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == FailSafeExecutor.SegmentExecuted.selector) sawExecuted = true;
            if (logs[i].topics[0] == FailSafeExecutor.SegmentSkipped.selector) sawSkipped = true;
        }
        assertTrue(sawExecuted, "SegmentExecuted");
        assertTrue(sawSkipped, "SegmentSkipped");
    }

    /**
     * @dev A skipped segment can be resubmitted unchanged and will then succeed.
     *      This is the keeper retry loop, and it is why skipping is safe to expose.
     *
     *      Note the flag is cleared from the test, not from inside the mock. Any state change made
     *      before a revert is rolled back with that frame, so a mock cannot count its own failures.
     */
    function test_skipCall_supportsResubmissionAfterATransientFailure() public {
        module.setShouldRevert(address(bad), true);
        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(bad)), FailSafeExecutor.FailurePolicy.SKIP_CALL);

        _run(segs);
        assertEq(bad.hits(), 0, "first attempt was skipped");

        // The world changes: the condition that caused the failure clears.
        module.setShouldRevert(address(bad), false);

        // Same batch, resubmitted.
        _run(segs);
        assertEq(bad.hits(), 1, "the retry succeeded");
    }

    // -------------------------------------------------------------------------------------------
    // Rules 2 and 3: derived provenance
    // -------------------------------------------------------------------------------------------

    function test_revertsWhenLaterSegmentReadsASkippedWrite() public {
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);

        // Segment 0 fails and would have written SLOT_A.
        ComposableExecution[] memory w = new ComposableExecution[](1);
        w[0] = _writeAndCapture(address(bad), SLOT_A);
        segs[0] = _seg(w, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        // Segment 1 reads SLOT_A.
        ComposableExecution[] memory r = new ComposableExecution[](1);
        r[0] = _readStorage(address(account), SLOT_A, address(sink));
        segs[1] = _seg(r, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        module.setShouldRevert(address(bad), true);

        _runExpect(segs, abi.encodeWithSelector(FailSafeExecutor.SkippedDependency.selector, 1, _valueSlot(SLOT_A, 0)));
    }

    function test_allowsLaterSegmentReadingAPreservedWrite() public {
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);

        ComposableExecution[] memory w = new ComposableExecution[](1);
        w[0] = _writeAndCapture(address(good), SLOT_A);
        segs[0] = _seg(w, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        ComposableExecution[] memory r = new ComposableExecution[](1);
        r[0] = _readStorage(address(account), SLOT_A, address(sink));
        segs[1] = _seg(r, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        _run(segs);

        assertEq(good.hits(), 1);
    }

    /// @dev A slot nobody skipped is readable regardless of ordering.
    function test_allowsReadingAPreExistingUnrelatedSlot() public {
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);

        ComposableExecution[] memory w = new ComposableExecution[](1);
        w[0] = _writeAndCapture(address(bad), SLOT_A);
        segs[0] = _seg(w, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        ComposableExecution[] memory r = new ComposableExecution[](1);
        r[0] = _readStorage(address(account), SLOT_B, address(sink));
        segs[1] = _seg(r, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        module.setShouldRevert(address(bad), true);

        _run(segs);

        // The read of SLOT_B above did not revert, which is the assertion that matters. Slot A
        // poisoning is covered by test_revertsWhenLaterSegmentReadsASkippedWrite.
        assertEq(sink.hits(), 1, "the unrelated-slot read executed");
    }

    /// @dev Rule 2, malformed side. A storage call that is not readStorage must revert, not be ignored.
    function test_revertsOnMalformedStorageRead() public {
        ComposableExecution[] memory entries = new ComposableExecution[](1);
        entries[0] = _malformedStorageRead(address(sink));

        FailSafeExecutor.Segment[] memory segs = _oneSegment(entries, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        _runExpect(segs, abi.encodeWithSelector(FailSafeExecutor.MalformedStorageRead.selector, 0, 0));
    }

    /// @dev Poison must not survive a call, or a later unrelated batch would be wrongly blocked.
    function test_poisonDoesNotSurviveACall() public {
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);
        ComposableExecution[] memory w = new ComposableExecution[](1);
        w[0] = _writeAndCapture(address(bad), SLOT_A);
        segs[0] = _seg(w, FailSafeExecutor.FailurePolicy.SKIP_CALL);
        ComposableExecution[] memory g = new ComposableExecution[](1);
        g[0] = _callEntry(address(good));
        segs[1] = _seg(g, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        module.setShouldRevert(address(bad), true);

        _run(segs);

        // Fresh call. Reading SLOT_A must now be allowed, because the previous poison is gone.
        FailSafeExecutor.Segment[] memory second = new FailSafeExecutor.Segment[](1);
        ComposableExecution[] memory r = new ComposableExecution[](1);
        r[0] = _readStorage(address(account), SLOT_A, address(sink));
        second[0] = _seg(r, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        _run(second);

        assertTrue(true, "the second call was not blocked by the first call's poison");
    }

    /// @dev The critical case: skip a swap, then try to deposit from its captured output.
    function test_cannotDepositFromASkippedSwapOutput() public {
        FailSafeExecutor.Segment[] memory segs = new FailSafeExecutor.Segment[](2);

        ComposableExecution[] memory swap = new ComposableExecution[](1);
        swap[0] = _writeAndCapture(address(bad), SLOT_A); // the swap, writing its output
        segs[0] = _seg(swap, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        ComposableExecution[] memory deposit = new ComposableExecution[](1);
        deposit[0] = _readStorage(address(account), SLOT_A, address(sink)); // sized from the swap's output
        segs[1] = _seg(deposit, FailSafeExecutor.FailurePolicy.SKIP_CALL);

        module.setShouldRevert(address(bad), true);

        _runExpect(segs, abi.encodeWithSelector(FailSafeExecutor.SkippedDependency.selector, 1, _valueSlot(SLOT_A, 0)));

        assertEq(sink.hits(), 0, "nothing downstream executed");
    }

    // -------------------------------------------------------------------------------------------
    // Namespace
    // -------------------------------------------------------------------------------------------

    /// @dev The slot the engine actually writes for return value `index` of `baseSlot`.
    function _valueSlot(bytes32 baseSlot, uint256 index) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(baseSlot, index));
    }

    /// @dev Module-path and native-path namespaces differ, and both must be derivable.
    function test_namespaceFor_distinguishesTheTwoPaths() public view {
        bytes32 viaModule = executor.namespaceFor(address(account));
        bytes32 native = executor.nativeNamespaceFor(address(account));

        assertTrue(viaModule != native, "the two paths must not collide");

        // Both must match the upstream derivation exactly.
        assertEq(viaModule, keccak256(abi.encodePacked(address(account), address(module))));
        assertEq(native, keccak256(abi.encodePacked(address(account), address(account))));
    }

    function test_valueSlotFor_matchesTheThreeLevelDerivation() public view {
        bytes32 base = SLOT_A;
        bytes32 slot = executor.valueSlotFor(address(account), base, 0);

        bytes32 expected = store.getNamespacedSlot(
            store.getNamespace(address(account), address(module)), keccak256(abi.encodePacked(base, uint256(0)))
        );
        assertEq(slot, expected);
    }

    // -------------------------------------------------------------------------------------------
    // ERC-7579 surface
    // -------------------------------------------------------------------------------------------

    /// @dev A custom EntryPoint cannot be registered, because a delegatecall target has no registry
    ///      to register it in. It is rejected rather than silently accepted.
    function test_rejectsAnUnregisteredEntryPoint() public {
        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);
        bytes memory payload =
            abi.encodePacked(address(executor), abi.encodeCall(FailSafeExecutor.executeFailSafe, (segs)));

        address stranger = makeAddr("strangerEp");
        account.setEntryPoint(stranger);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FailSafeExecutor.Unauthorized.selector, stranger));
        account.execute(mode, payload);
    }

    /// @dev The account calling itself is always authorised, independent of the EntryPoint.
    function test_authorisesTheAccountItself() public {
        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);
        bytes memory payload =
            abi.encodePacked(address(executor), abi.encodeCall(FailSafeExecutor.executeFailSafe, (segs)));

        vm.prank(address(account));
        account.execute(mode, payload);

        assertEq(good.hits(), 1, "self-authorised");
    }

    // -------------------------------------------------------------------------------------------
    // Storage. A delegatecall target must not touch storage, and this suite proves it.
    // -------------------------------------------------------------------------------------------

    /**
     * @dev Regression, and the subtlest bug in this project.
     *
     *      Under delegatecall the executor's storage IS the account's. An earlier version declared
     *      `bytes32[] _poisonedSlots` at slot 0 and cleared it with `delete`. Slot 0 of the account
     *      held `entryPoint`, an address, so the array's length read as roughly 2^64 and `delete`
     *      tried to zero that many words, exhausting the gas limit and reverting without data.
     *
     *      The poison now lives in memory, which is discarded when the call returns, which is exactly
     *      the lifetime it needs.
     */
    function test_doesNotTouchAccountStorage() public {
        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        address entryPointBefore = account.entryPoint();
        uint256 modulesBefore = account.moduleCount();

        _run(segs);

        assertEq(account.entryPoint(), entryPointBefore, "the account's EntryPoint is intact");
        assertEq(account.moduleCount(), modulesBefore, "the account's module registry is intact");
        assertEq(good.hits(), 1, "and the batch still executed");
    }

    /// @dev Slot 0 of the account holding a non-zero address is the specific trap.
    function test_survivesAnAccountWhoseSlotZeroIsANonZeroAddress() public {
        MockAccount fresh = new MockAccount();
        fresh.setEntryPoint(makeAddr("someOtherEp"));
        assertTrue(address(fresh.entryPoint()) != address(0), "precondition: slot 0 is non-zero");

        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);
        bytes memory payload =
            abi.encodePacked(address(executor), abi.encodeCall(FailSafeExecutor.executeFailSafe, (segs)));

        vm.prank(address(fresh));
        fresh.execute(mode, payload);

        assertEq(good.hits(), 1, "no gas exhaustion, no bare revert");
    }

    /// @dev The executor declares no mutable state, so nothing may leak between calls.
    function test_noStateLeaksBetweenCalls() public {
        FailSafeExecutor.Segment[] memory segs =
            _oneSegment(_oneCall(address(good)), FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        _run(segs);
        _run(segs);

        assertEq(good.hits(), 2, "both calls took effect, so nothing persisted between them");
    }

    function test_reportsExecutorModuleTypeOnly() public view {
        assertTrue(executor.isModuleType(2), "executor");
        assertTrue(!executor.isModuleType(1), "not validator");
        assertTrue(!executor.isModuleType(3), "not fallback");
        assertTrue(!executor.isModuleType(4), "not hook");
    }

    /// @dev A registered EntryPoint lets that account drive the executor through the account path.

    function test_revertsOnZeroModule() public {
        vm.expectRevert(FailSafeExecutor.ZeroModule.selector);
        new FailSafeExecutor(address(0), address(store));
    }

    // -------------------------------------------------------------------------------------------
    // State-diff assertion. The single most important property in the whole suite.
    // -------------------------------------------------------------------------------------------

    function test_aRevertedBatchCommitsNothing() public {
        RecordingTarget extra = new RecordingTarget();

        ComposableExecution[] memory entries = new ComposableExecution[](2);
        entries[0] = _callEntry(address(extra));
        entries[1] = _callEntry(address(bad));
        module.setShouldRevert(address(bad), true);

        FailSafeExecutor.Segment[] memory segs = _oneSegment(entries, FailSafeExecutor.FailurePolicy.REVERT_BATCH);

        _runExpect(segs, "MockComposabilityModule: configured failure");

        assertEq(extra.hits(), 0, "no entry in a reverted batch may take effect");
        assertEq(bad.hits(), 0);
        assertEq(module.callCount(), 0, "the module itself was rolled back");
    }

    // -------------------------------------------------------------------------------------------
    // Builders
    // -------------------------------------------------------------------------------------------

    /// @dev A one-element array of segments.
    function _oneSegment(ComposableExecution[] memory entries, FailSafeExecutor.FailurePolicy policy)
        internal
        pure
        returns (FailSafeExecutor.Segment[] memory segs)
    {
        segs = new FailSafeExecutor.Segment[](1);
        segs[0] = FailSafeExecutor.Segment({executions: entries, policy: policy});
    }

    /// @dev A single segment, for composing into a multi-segment batch.
    function _seg(ComposableExecution[] memory entries, FailSafeExecutor.FailurePolicy policy)
        internal
        pure
        returns (FailSafeExecutor.Segment memory)
    {
        return FailSafeExecutor.Segment({executions: entries, policy: policy});
    }

    function _oneCall(address target) internal pure returns (ComposableExecution[] memory entries) {
        entries = new ComposableExecution[](1);
        entries[0] = _callEntry(target);
    }

    function _callEntry(address target) internal pure returns (ComposableExecution memory entry) {
        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(target),
            constraints: new Constraint[](0)
        });
        entry = ComposableExecution({functionSig: bytes4(0), inputParams: params, outputParams: new OutputParam[](0)});
    }

    /// @dev An entry with no TARGET. The engine treats it as a pure predicate.
    function _predicateEntry() internal pure returns (ComposableExecution memory entry) {
        InputParam[] memory params = new InputParam[](0);
        entry = ComposableExecution({functionSig: bytes4(0), inputParams: params, outputParams: new OutputParam[](0)});
    }

    /// @dev Writes to the mock target and captures the result into `baseSlot`.
    function _writeAndCapture(address target, bytes32 baseSlot)
        internal
        pure
        returns (ComposableExecution memory entry)
    {
        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(target),
            constraints: new Constraint[](0)
        });

        OutputParam[] memory outs = new OutputParam[](1);
        outs[0] = OutputParam({
            fetcherType: OutputParamFetcherType.EXEC_RESULT,
            paramData: abi.encode(uint256(1), address(0x9999), baseSlot)
        });

        entry = ComposableExecution({functionSig: bytes4(0), inputParams: params, outputParams: outs});
    }

    /// @dev Reads `baseSlot` from Storage in the module-path namespace.
    function _readStorage(address accountAddr, bytes32 baseSlot, address readSink)
        internal
        view
        returns (ComposableExecution memory entry)
    {
        bytes32 ns = store.getNamespace(accountAddr, address(module));
        bytes32 slot = keccak256(abi.encodePacked(baseSlot, uint256(0)));

        // A real entry that reads Storage and then calls something. It needs a TARGET, otherwise
        // it is a predicate entry and is correctly rejected inside a SKIP_CALL segment.
        InputParam[] memory params = new InputParam[](2);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.STATIC_CALL,
            paramData: abi.encode(address(store), abi.encodeCall(IStorage.readStorage, (ns, slot))),
            constraints: new Constraint[](0)
        });
        params[1] = InputParam({
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(readSink),
            constraints: new Constraint[](0)
        });

        entry = ComposableExecution({functionSig: bytes4(0), inputParams: params, outputParams: new OutputParam[](0)});
    }

    /// @dev A STATIC_CALL aimed at the storage contract with the wrong selector.
    function _malformedStorageRead(address readSink) internal view returns (ComposableExecution memory entry) {
        InputParam[] memory params = new InputParam[](2);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.STATIC_CALL,
            paramData: abi.encode(address(store), abi.encodeWithSignature("somethingElse()")),
            constraints: new Constraint[](0)
        });
        params[1] = InputParam({
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(readSink),
            constraints: new Constraint[](0)
        });

        entry = ComposableExecution({functionSig: bytes4(0), inputParams: params, outputParams: new OutputParam[](0)});
    }
}
