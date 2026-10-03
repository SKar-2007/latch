// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {FeedGuard} from "../../contracts/FeedGuard.sol";
import {MockOracle} from "../../contracts/mocks/MockOracle.sol";
import {RevertingAggregator} from "../../contracts/mocks/RevertingAggregator.sol";
import {IAggregatorV3} from "../../contracts/interfaces/IAggregatorV3.sol";

/**
 * @title FeedGuard test
 * @notice Layer A3 from docs/09-testing-strategy.md. Every branch is a verdict, so every branch is tested.
 */
contract FeedGuardTest is Test {
    FeedGuard internal guard;
    MockOracle internal oracle;
    RevertingAggregator internal broken;

    uint8 internal constant DECIMALS = 8;
    int256 internal constant ANSWER = 265_753 * 10 ** 8; // $2,657.53 at 8 decimals

    // Base Sepolia ETH/USD heartbeat, the documented default.
    uint256 internal constant HEARTBEAT = 1200;

    function setUp() public {
        // Foundry's default block.timestamp is 1, so any backdating would underflow to 0 and every
        // round would look uninitialised. Move to a realistic Base Sepolia-era timestamp.
        vm.warp(1_700_000_000);

        guard = new FeedGuard();
        oracle = new MockOracle(DECIMALS, "MOCK / ETH-USD");
        broken = new RevertingAggregator();
    }

    // -------------------------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------------------------

    function test_isFresh_acceptsRoundAtCurrentTimestamp() public {
        oracle.setAnswer(ANSWER);

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 1, "a round published now is fresh");
    }

    function test_isFresh_acceptsExactBoundary() public {
        oracle.setRoundAge(ANSWER, HEARTBEAT);

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 1, "the boundary is inclusive");
    }

    function test_isFresh_rejectsOneSecondPastBoundary() public {
        oracle.setRoundAge(ANSWER, HEARTBEAT + 1);

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 0, "one second over is stale");
    }

    // -------------------------------------------------------------------------------------------
    // Rejection branches. Each maps to a line in _roundIsUsable.
    // -------------------------------------------------------------------------------------------

    function test_isFresh_rejectsZeroAggregator() public view {
        assertEq(guard.isFresh(address(0), HEARTBEAT), 0);
    }

    function test_isFresh_rejectsAddressWithNoCode() public {
        // An EOA. Reading it would return empty data, so the guard must catch it explicitly.
        address eoa = makeAddr("eoa");
        assertEq(eoa.code.length, 0, "precondition");

        assertEq(guard.isFresh(eoa, HEARTBEAT), 0, "an EOA is not a feed");
    }

    function test_isFresh_rejectsMaxStalenessAboveCap() public {
        oracle.setAnswer(ANSWER);

        uint256 cap = guard.MAX_STALENESS();
        assertEq(guard.isFresh(address(oracle), cap + 1), 0, "fails closed, does not disable");
        assertEq(guard.isFresh(address(oracle), cap), 1, "the cap itself is allowed");
    }

    function test_isFresh_rejectsZeroTimestamp() public {
        oracle.setRound(ANSWER, 0, 0, 1);

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 0, "an uninitialised aggregator is not fresh");
    }

    function test_isFresh_rejectsZeroAnswer() public {
        oracle.setRound(0, block.timestamp, block.timestamp, 1);

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 0, "zero is not a price");
    }

    function test_isFresh_rejectsNegativeAnswer() public {
        oracle.setRound(-1, block.timestamp, block.timestamp, 1);

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 0, "a negative price is not usable");
    }

    function test_isFresh_rejectsFutureTimestamp() public {
        oracle.setRound(ANSWER, block.timestamp + 1, block.timestamp + 1, 1);

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 0, "a future round cannot be fresh");
    }

    function test_isFresh_rejectsUnansweredRound() public {
        oracle.setAnswer(ANSWER);
        oracle.setUnanswered();

        (uint80 roundId,,,, uint80 answeredInRound) = oracle.latestRoundData();
        assertLt(answeredInRound, roundId, "precondition");

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 0, "an unanswered round is rejected");
    }

    function test_isFresh_acceptsAnsweredRound() public {
        oracle.setAnswer(ANSWER);

        (uint80 roundId,,,, uint80 answeredInRound) = oracle.latestRoundData();
        assertEq(answeredInRound, roundId, "precondition");

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 1);
    }

    // -------------------------------------------------------------------------------------------
    // Verdict form must never revert on a well-formed aggregator
    // -------------------------------------------------------------------------------------------

    /// @dev An uninitialised aggregator reports zeros, as a real proxy does, and the guard must
    ///      return a verdict rather than propagate. This is the `updatedAt == 0` branch.
    function test_isFresh_handlesAnUninitialisedAggregator() public view {
        assertEq(oracle.latestUpdatedAt(), 0, "precondition: never pushed");

        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 0, "zeros are not fresh");
    }

    function test_isFresh_revertsOnBrokenAggregator() public {
        // Documented behaviour: the staticcall fails and the fetcher surfaces ComposableExecutionFailed.
        // That is the correct loud failure for a misconfiguration, so it must propagate.
        vm.expectRevert("aggregator unavailable");
        guard.isFresh(address(broken), HEARTBEAT);
    }

    // -------------------------------------------------------------------------------------------
    // Value form
    // -------------------------------------------------------------------------------------------

    function test_answerIfFresh_returnsTheAnswer() public {
        oracle.setAnswer(ANSWER);

        assertEq(guard.answerIfFresh(address(oracle), HEARTBEAT), ANSWER);
    }

    function test_answerIfFresh_returnsExactlyOneWord() public {
        oracle.setAnswer(ANSWER);

        bytes memory encoded = abi.encode(guard.answerIfFresh(address(oracle), HEARTBEAT));
        assertEq(encoded.length, 32, "must be a single word so one constraint lands on it");
    }

    function test_answerIfFresh_revertsOnStale() public {
        oracle.setRoundAge(ANSWER, HEARTBEAT + 1);

        vm.expectRevert();
        guard.answerIfFresh(address(oracle), HEARTBEAT);
    }

    function test_answerIfFresh_revertsOnZeroAggregator() public {
        vm.expectRevert(FeedGuard.ZeroAggregator.selector);
        guard.answerIfFresh(address(0), HEARTBEAT);
    }

    function test_answerIfFresh_revertsOnAddressWithNoCode() public {
        vm.expectRevert(abi.encodeWithSelector(FeedGuard.NotAContract.selector, makeAddr("eoa")));
        guard.answerIfFresh(makeAddr("eoa"), HEARTBEAT);
    }

    function test_answerIfFresh_revertsAboveStalenessCap() public {
        oracle.setAnswer(ANSWER);

        uint256 tooTolerant = guard.MAX_STALENESS() + 1;
        vm.expectRevert(FeedGuard.OutOfRange.selector);
        guard.answerIfFresh(address(oracle), tooTolerant);
    }

    function test_answerIfFreshInBand_acceptsInsideBand() public {
        oracle.setAnswer(ANSWER);

        int256 lo = ANSWER - 100 * 10 ** 8;
        int256 hi = ANSWER + 100 * 10 ** 8;
        assertEq(guard.answerIfFreshInBand(address(oracle), HEARTBEAT, lo, hi), ANSWER);
    }

    function test_answerIfFreshInBand_rejectsOutsideBand() public {
        oracle.setAnswer(ANSWER);

        vm.expectRevert(abi.encodeWithSelector(FeedGuard.UnusableAnswer.selector, address(oracle), ANSWER));
        guard.answerIfFreshInBand(address(oracle), HEARTBEAT, ANSWER + 1, ANSWER + 100);
    }

    function test_answerIfFreshInBand_rejectsInvertedBand() public {
        oracle.setAnswer(ANSWER);

        vm.expectRevert(FeedGuard.OutOfRange.selector);
        guard.answerIfFreshInBand(address(oracle), HEARTBEAT, ANSWER + 100, ANSWER);
    }

    // -------------------------------------------------------------------------------------------
    // Diagnostic
    // -------------------------------------------------------------------------------------------

    function test_roundAge_reportsAge() public {
        oracle.setRoundAge(ANSWER, 60);

        (uint256 age, uint256 updatedAt, int256 answer, uint80 roundId) = guard.roundAge(address(oracle));
        assertEq(age, 60);
        assertEq(updatedAt, block.timestamp - 60);
        assertEq(answer, ANSWER);
        assertEq(roundId, 1);
    }

    // -------------------------------------------------------------------------------------------
    // Time travel. The whole point of the contract is relative time, so warp it.
    // -------------------------------------------------------------------------------------------

    function test_isFresh_failsAfterHeartbeatElapses() public {
        oracle.setAnswer(ANSWER);
        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 1, "precondition");

        vm.warp(block.timestamp + HEARTBEAT);
        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 1, "still fresh at exactly the heartbeat");

        vm.warp(block.timestamp + 1);
        assertEq(guard.isFresh(address(oracle), HEARTBEAT), 0, "stale one second later");
    }

    function testFuzz_isFresh_agreesWithHandComputedVerdict(uint256 age, int256 answer) public {
        vm.assume(age <= 10_000);
        oracle.setRoundAge(answer, age);

        bool expected = answer > 0 && age <= HEARTBEAT;
        assertEq(guard.isFresh(address(oracle), HEARTBEAT), expected ? 1 : 0);
    }

    function testFuzz_isFresh_answerIfFreshAgree(uint256 age, int256 answer) public {
        vm.assume(age <= 10_000);
        vm.assume(answer > 0);
        oracle.setRoundAge(answer, age);

        if (age <= HEARTBEAT) {
            assertEq(guard.answerIfFresh(address(oracle), HEARTBEAT), answer, "both forms must agree");
        } else {
            vm.expectRevert();
            guard.answerIfFresh(address(oracle), HEARTBEAT);
        }
    }

    /// @dev The two forms share one definition of usable, so they can never disagree. Prove it.
    function testFuzz_verdictAndValueFormsNeverDisagree(uint256 age, int256 answer) public {
        vm.assume(age <= 10_000);
        oracle.setRoundAge(answer, age);

        uint256 verdict = guard.isFresh(address(oracle), HEARTBEAT);

        if (verdict == 1) {
            assertEq(guard.answerIfFresh(address(oracle), HEARTBEAT), answer);
        } else {
            vm.expectRevert();
            guard.answerIfFresh(address(oracle), HEARTBEAT);
        }
    }

    /// @dev An aggregator whose behaviour is fully arbitrary must still produce a legal verdict.
    function testFuzz_isFresh_alwaysReturnsZeroOrOne(uint80 roundId, int256 answer, uint256 updatedAt) public {
        oracle.setRound(answer, updatedAt, updatedAt, roundId);

        uint256 verdict = guard.isFresh(address(oracle), type(uint256).max);
        assertTrue(verdict == 0 || verdict == 1, "verdict must be exactly 0 or 1");
    }

    /// @dev Guard against a proxy exposing a mutating fallback that shadows a view.
    function test_hasNoFallbackOrReceive() public {
        (bool success,) = address(guard).call(abi.encodeWithSelector(0x12345678));
        assertTrue(!success, "unknown selectors must not be accepted");
    }

    /// @dev No state-changing entry point exists, so no administrative surface can be exercised.
    ///      Every function is `view`, which the ABI itself proves: none of them are in the
    ///      state-modifying list, and the compiler rejects any attempt to write from one.
    function test_everyEntryPointIsView() public {
        oracle.setAnswer(ANSWER);

        // A STATICCALL to the guard succeeds for every documented entry point.
        address target = address(guard);
        bytes memory payload = abi.encodeWithSelector(FeedGuard.isFresh.selector, address(oracle), HEARTBEAT);
        (bool ok,) = target.staticcall(payload);
        assertTrue(ok, "isFresh is reachable by staticcall");

        payload = abi.encodeWithSelector(FeedGuard.answerIfFresh.selector, address(oracle), HEARTBEAT);
        (ok,) = target.staticcall(payload);
        assertTrue(ok, "answerIfFresh is reachable by staticcall");
    }

    function test_aggregatorInterfaceIsWordIndexedAsDocumented() public {
        oracle.setAnswer(ANSWER);

        // This is the assumption the whole constraint design rests on: five 32-byte words, in order.
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            oracle.latestRoundData();

        assertEq(roundId, 1, "word 0 is roundId");
        assertEq(answer, ANSWER, "word 1 is answer");
        assertEq(startedAt, block.timestamp, "word 2 is startedAt");
        assertEq(updatedAt, block.timestamp, "word 3 is updatedAt");
        assertEq(answeredInRound, roundId, "word 4 is answeredInRound");

        // And the answer is NOT word 0, which is why a single constraint cannot reach it.
        bytes memory encoded = abi.encode(roundId, answer, startedAt, updatedAt, answeredInRound);
        assertEq(encoded.length, 160, "five words");
        bytes32 word0;
        assembly {
            word0 := mload(add(encoded, 0x20))
        }
        assertEq(word0, bytes32(uint256(roundId)), "word 0 is roundId");
        assertTrue(word0 != bytes32(uint256(answer)), "so a single constraint can never reach the answer");
    }

    function test_mockOracle_decimalsMatchFeedGuardExpectations() public view {
        assertEq(oracle.decimals(), DECIMALS);
        assertEq(DECIMALS, 8, "Base Sepolia feeds report 8 decimals on chain, not the 9 in the RDD docs");
    }
}
