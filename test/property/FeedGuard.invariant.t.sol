// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {FeedGuard} from "../../contracts/FeedGuard.sol";
import {MockOracle} from "../../contracts/mocks/MockOracle.sol";

/**
 * @title FeedGuardHandler
 * @notice Drives the oracle into arbitrary states so the invariants see every branch.
 */
contract FeedGuardHandler is Test {
    MockOracle internal oracle;
    FeedGuard internal guard;

    uint8 internal constant DECIMALS = 8;
    uint256 internal constant HEARTBEAT = 1200;

    /// @dev Records the round fields it last wrote, so the test can recompute the verdict.
    int256 internal lastAnswer_;
    uint256 internal lastUpdatedAt_;
    uint80 internal lastRoundId_;
    uint80 internal lastAnsweredInRound_;

    uint256 internal pushes_;

    /// @dev Timestamp at construction. Only `warp` moves it, so it proves the fuzzer reached the
    ///      handler without depending on a call counter.
    uint256 public immutable startTimestamp;

    constructor(MockOracle oracle_, FeedGuard guard_) {
        oracle = oracle_;
        guard = guard_;
        startTimestamp = block.timestamp;
        // Seed one round so the invariants are meaningful from the first check, rather than
        // vacuously true until the fuzzer happens to write.
        oracle.setAnswer(1e18);
        _record();
    }

    function pushFresh(int256 answer) external {
        oracle.setAnswer(answer);
        _record();
        pushes_++;
    }

    function pushAged(int256 answer, uint256 age) external {
        oracle.setRoundAge(answer, age % 100_000);
        _record();
        pushes_++;
    }

    function pushFullyControlled(int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) external {
        oracle.setRound(answer, startedAt, updatedAt, answeredInRound);
        _record();
        pushes_++;
    }

    function pushUnanswered() external {
        oracle.setAnswer(int256(uint256(1e18)));
        oracle.setUnanswered();
        _record();
        pushes_++;
    }

    function reset() external {
        oracle.reset();
        // Record the zeroed state explicitly. Skipping the record would leave the invariant
        // comparing a stale round against a guard that is reading an uninitialised one, which is a
        // test bug that looks exactly like a guard bug.
        lastRoundId_ = 0;
        lastAnswer_ = 0;
        lastUpdatedAt_ = 0;
        lastAnsweredInRound_ = 0;
        pushes_++;
    }

    function warp(uint256 delta) external {
        vm.warp(block.timestamp + (delta % 10_000));
    }

    function lastRoundId() external view returns (uint80) {
        return lastRoundId_;
    }

    function lastAnswer() external view returns (int256) {
        return lastAnswer_;
    }

    function lastUpdatedAt() external view returns (uint256) {
        return lastUpdatedAt_;
    }

    function lastAnsweredInRound() external view returns (uint80) {
        return lastAnsweredInRound_;
    }

    function pushes() external view returns (uint256) {
        return pushes_;
    }

    function HEARTBEAT_PUBLIC() external pure returns (uint256) {
        return HEARTBEAT;
    }

    function _record() internal {
        (lastRoundId_, lastAnswer_,, lastUpdatedAt_, lastAnsweredInRound_) = oracle.latestRoundData();
    }
}

/**
 * @title FeedGuardInvariantTest
 * @notice Layer C for `FeedGuard`. Handlers push arbitrary oracle states; the invariants assert the
 *         guard's verdict is exactly the one those states imply.
 * @dev No fork needed. `MockOracle` is a faithful AggregatorV3 stand-in, and the properties are
 *      about the guard's logic, not about Chainlink.
 */
contract FeedGuardInvariantTest is Test {
    /// @dev Base Sepolia ETH/USD heartbeat. Kept in sync with the handler.
    uint256 internal constant HEARTBEAT = 1200;

    FeedGuard internal guard;
    MockOracle internal oracle;
    FeedGuardHandler internal handler;

    address internal constant FEEDER = address(0xF00D);

    function setUp() public {
        vm.warp(1_700_000_000);

        guard = new FeedGuard();
        oracle = new MockOracle(8, "MOCK / ETH-USD");
        handler = new FeedGuardHandler(oracle, guard);

        // Seed on the test side too, so the invariants are meaningful from the very first check
        // and do not depend on the fuzzer having acted yet.
        oracle.setAnswer(1e18);

        targetContract(address(handler));
        targetSender(FEEDER);

        // Every handler action must be reachable, or the invariants are vacuous.
        bytes4[] memory actions = new bytes4[](6);
        actions[0] = handler.pushFresh.selector;
        actions[1] = handler.pushAged.selector;
        actions[2] = handler.pushFullyControlled.selector;
        actions[3] = handler.pushUnanswered.selector;
        actions[4] = handler.reset.selector;
        actions[5] = handler.warp.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: actions}));
    }

    // -------------------------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------------------------

    /// @dev The verdict must be exactly what the round's fields imply. The single most important
    ///      property here: it is the difference between "a guard" and "a guard that means something".
    function invariant_verdictMatchesTheRoundFields() public view {
        if (handler.lastRoundId() == 0) return; // uninitialised, and the verdict must be 0 anyway

        uint256 verdict = guard.isFresh(address(oracle), HEARTBEAT);

        bool expected = handler.lastAnswer() > 0 && handler.lastUpdatedAt() != 0
            && handler.lastUpdatedAt() <= block.timestamp && block.timestamp - handler.lastUpdatedAt() <= HEARTBEAT
            && handler.lastAnsweredInRound() >= handler.lastRoundId();

        assertEq(verdict, expected ? 1 : 0, "verdict disagrees with the round's own fields");
    }

    /// @dev Only two verdicts exist. No intermediate value can ever be produced.
    function invariant_verdictIsAlwaysZeroOrOne() public view {
        uint256 verdict = guard.isFresh(address(oracle), HEARTBEAT);
        assertTrue(verdict == 0 || verdict == 1, "verdict must be exactly 0 or 1");
    }

    /// @dev A well-formed aggregator never makes the verdict form revert. Only the value form may,
    ///      and only with a named error. This is what lets a stale feed fail at the constraint rather
    ///      than at the fetcher.
    function invariant_verdictFormNeverReverts() public view {
        // A staticcall is the strict form of "does not revert".
        (bool ok,) =
            address(guard).staticcall(abi.encodeWithSelector(FeedGuard.isFresh.selector, address(oracle), HEARTBEAT));
        assertTrue(ok, "isFresh must not revert on a well-formed aggregator");
    }

    /// @dev The two forms share one definition of usable, so they can never disagree.
    function invariant_verdictAndValueFormsAgree() public view {
        uint256 verdict = guard.isFresh(address(oracle), HEARTBEAT);

        if (verdict == 1) {
            assertEq(guard.answerIfFresh(address(oracle), HEARTBEAT), handler.lastAnswer());
        } else {
            (bool ok,) = address(guard)
                .staticcall(abi.encodeWithSelector(FeedGuard.answerIfFresh.selector, address(oracle), HEARTBEAT));
            assertTrue(!ok, "answerIfFresh must not succeed when the verdict is 0");
        }
    }

    /// @dev The value form must return exactly one word. This is load-bearing: a single SDK
    ///      constraint lands on word 0, so a wider return would be unconstrainable.
    function invariant_valueFormIsExactlyOneWord() public view {
        if (handler.lastRoundId() == 0) return;
        if (guard.isFresh(address(oracle), HEARTBEAT) != 1) return;

        bytes memory encoded = abi.encode(guard.answerIfFresh(address(oracle), HEARTBEAT));
        assertEq(encoded.length, 32, "answerIfFresh must return a single word");
    }

    /**
     * @dev Non-vacuity, by construction rather than by counting.
     *
     *      The concern with a randomised run is that every sampled feed could be stale, in which case
     *      "verdict agrees with the fields" would be satisfied by 0 == 0 forever. An earlier version
     *      tried to detect this with a handler call counter and asserted on the fuzzer's end state;
     *      both were wrong, because the end state is arbitrary and `reset` legitimately zeroes the
     *      feed.
     *
     *      So non-vacuity is asserted directly instead: a scripted walk must produce both verdicts.
     */
    function test_bothVerdictsAreReachable() public {
        uint256 seen;

        // Fresh.
        oracle.setAnswer(1e18);
        seen |= guard.isFresh(address(oracle), HEARTBEAT);

        // Stale by one second past the heartbeat.
        oracle.setRoundAge(1e18, HEARTBEAT + 1);
        seen |= guard.isFresh(address(oracle), HEARTBEAT) << 1;

        // Uninitialised.
        oracle.reset();
        seen |= guard.isFresh(address(oracle), HEARTBEAT) << 2;

        assertEq(seen & 1, 1, "a fresh round must be accepted");
        assertEq((seen >> 1) & 1, 0, "a stale round must be rejected");
        assertEq((seen >> 2) & 1, 0, "an uninitialised feed must be rejected");
    }

    /// @dev Reading the guard must never mutate anything. It is reached by `staticcall` from the
    ///      composability engine, so a state write would be both a bug and a protocol violation.
    function invariant_readingTheGuardWritesNoState() public view {
        uint256 oracleBefore = oracle.latestUpdatedAt();
        uint256 answerBefore = uint256(oracle.latestAnswer());

        guard.isFresh(address(oracle), HEARTBEAT);

        assertEq(oracle.latestUpdatedAt(), oracleBefore, "the feed must not move");
        assertEq(uint256(oracle.latestAnswer()), answerBefore, "the answer must not move");
    }
}
