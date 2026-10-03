// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/**
 * @title MockOracle
 * @notice A Chainlink-shaped aggregator whose values are pushed, for Base Sepolia demos and tests.
 *
 * @dev TESTNET ONLY.
 *
 *      LATCH has no allowlist and no special case for this contract. `FeedGuard` treats it as an
 *      ordinary aggregator address, so there is no privileged code path here that production code can
 *      reach. The only protection is operational: this address must never appear in a production
 *      configuration, which is why it lives under `contracts/mocks/`.
 *
 *      This is what makes the demo reproducible. A live price can be pushed out of band so the
 *      freshness gate and the price band both fail on cue, without waiting for market movement.
 *
 *      Note that this cannot move the chain clock. To exercise staleness the mock backdates
 *      `updatedAt` instead, which is why `setRoundAge` exists.
 */
contract MockOracle is IAggregatorV3 {
    error NoSuchRound(uint80 roundId);

    event AnswerUpdated(uint80 indexed roundId, int256 answer, uint256 updatedAt);

    uint8 private immutable _decimals;
    string private _description;
    uint256 private _version;

    uint80 private _latestRound;
    int256 private _latestAnswer;
    uint256 private _latestStartedAt;
    uint256 private _latestUpdatedAt;
    uint80 private _latestAnsweredInRound;

    mapping(uint80 => uint80) private _answeredInRoundOf;

    constructor(uint8 decimals_, string memory description_) {
        _decimals = decimals_;
        _description = description_;
        _version = 1;
    }

    // ---------------------------------------------------------------------------------------------
    // Demo controls
    // ---------------------------------------------------------------------------------------------

    /// @notice Pushes a new answer at the current block timestamp. Emits `AnswerUpdated`.
    function setAnswer(int256 answer) external returns (uint80 roundId) {
        _latestRound += 1;
        roundId = _latestRound;

        _latestAnswer = answer;
        _latestStartedAt = block.timestamp;
        _latestUpdatedAt = block.timestamp;
        _latestAnsweredInRound = roundId;
        _answeredInRoundOf[roundId] = roundId;

        emit AnswerUpdated(roundId, answer, block.timestamp);
    }

    /// @notice Pushes an answer that is already `age` seconds old. Drives the staleness gate directly.
    function setRoundAge(int256 answer, uint256 age) external returns (uint80 roundId) {
        _latestRound += 1;
        roundId = _latestRound;

        uint256 stamp = block.timestamp > age ? block.timestamp - age : 0;

        _latestAnswer = answer;
        _latestStartedAt = stamp;
        _latestUpdatedAt = stamp;
        _latestAnsweredInRound = roundId;
        _answeredInRoundOf[roundId] = roundId;

        emit AnswerUpdated(roundId, answer, stamp);
    }

    /// @notice Pushes a full round with explicit control over every field. For negative tests.
    function setRound(int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
        external
        returns (uint80 roundId)
    {
        _latestRound += 1;
        roundId = _latestRound;

        _latestAnswer = answer;
        _latestStartedAt = startedAt;
        _latestUpdatedAt = updatedAt;
        _latestAnsweredInRound = answeredInRound;
        _answeredInRoundOf[roundId] = answeredInRound;

        emit AnswerUpdated(roundId, answer, updatedAt);
    }

    /// @notice Marks the latest round as not yet answered, which FeedGuard must reject.
    function setUnanswered() external {
        _latestAnsweredInRound = _latestRound == 0 ? 0 : _latestRound - 1;
    }

    /// @notice Wipes the oracle to its uninitialised state. FeedGuard must return 0.
    function reset() external {
        _latestRound = 0;
        _latestAnswer = 0;
        _latestStartedAt = 0;
        _latestUpdatedAt = 0;
        _latestAnsweredInRound = 0;
    }

    // ---------------------------------------------------------------------------------------------
    // IAggregatorV3
    // ---------------------------------------------------------------------------------------------

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function version() external view returns (uint256) {
        return _version;
    }

    /**
     * @dev Returns zeros before the first push rather than reverting.
     *
     *      This matches a real Chainlink proxy, which reports an uninitialised aggregator as all
     *      zeros. Reverting here would make `FeedGuard` revert instead of returning a verdict, and a
     *      stale feed must fail at the constraint, not at the fetcher. The guard's `updatedAt == 0`
     *      branch exists for exactly this case and can only be reached if the mock behaves the same.
     */
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_latestRound, _latestAnswer, _latestStartedAt, _latestUpdatedAt, _latestAnsweredInRound);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        if (roundId == 0 || roundId != _latestRound) revert NoSuchRound(roundId);
        return (_latestRound, _latestAnswer, _latestStartedAt, _latestUpdatedAt, _answeredInRoundOf[roundId]);
    }

    /// @notice Convenience for the client, which should read decimals from the feed, not from docs.
    function latestAnswer() external view returns (int256) {
        return _latestAnswer;
    }

    function latestUpdatedAt() external view returns (uint256) {
        return _latestUpdatedAt;
    }
}
