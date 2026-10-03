// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/**
 * @title FeedGuard
 * @notice Reduces oracle freshness to a single 32-byte word that an ERC-8211 constraint can gate on.
 *
 * @dev Why this contract exists
 *
 * ERC-8211 constraints compare a resolved value against a static literal chosen at signing time.
 * Nothing in the composability pipeline can read `block.timestamp`, so
 *
 *     block.timestamp - updatedAt <= maxStaleness
 *
 * is inexpressible. `latestRoundData()` puts `updatedAt` at word 3, and a single SDK constraint always
 * lands on word 0, so the answer is unreachable too. This contract is the adapter that closes both gaps:
 * it performs the relative-time arithmetic inside a `staticcall` and returns exactly one word.
 *
 * Design constraints this contract deliberately honours
 *
 * 1. Every function is `view`. It is reached through the STATIC_CALL fetcher, so nothing may write state.
 * 2. No admin functions, no owner, no upgrade path, no proxy. A wrong verdict is the only risk, and
 *    an immutable contract has no privileged path to produce one.
 * 3. No fallback or receive function. A fallback that accepts unknown selectors would let an
 *    incompatible proxy shadow a view with a mutating one. See ADR-0004.
 * 4. `isFresh` never reverts on a well-formed aggregator, so a stale feed fails at the constraint with
 *    `ConstraintNotMet(EQ)` rather than at the fetcher with `ComposableExecutionFailed`.
 * 5. Every failure mode returns 0 or reverts. Never a plausible-looking positive value.
 *
 * @dev Feeding this a stale round is the expected outcome, not an error. Feeding it a malformed
 *      aggregator will revert inside the staticcall, which surfaces as `ComposableExecutionFailed`
 *      and is the correct loud failure for a configuration mistake.
 */
contract FeedGuard {
    /// @notice Thrown by the reverting accessors when a round is not usable.
    error StaleFeed(address aggregator, int256 answer, uint256 updatedAt, uint256 age, uint256 maxStaleness);

    /// @notice Thrown when the answer is zero or negative.
    error UnusableAnswer(address aggregator, int256 answer);

    /// @notice Thrown when the aggregator address is zero.
    error ZeroAggregator();

    /// @notice Thrown when the sequencer feed address is zero on the sequencer-checking path.
    error ZeroSequencerFeed();

    /// @notice Thrown when `slippageBps`-style parameters are out of range.
    error OutOfRange();

    /// @notice Thrown when an aggregator address has no code, which would otherwise silently
    ///         succeed against an EOA returning empty data.
    error NotAContract(address target);

    /**
     * @notice Upper bound on `maxStaleness`, as a fails-closed guard against a misconfigured gate.
     * @dev A caller passing an absurd tolerance would otherwise silently disable the check. Thirty
     *      days is far longer than any published Chainlink heartbeat, including the 86,400s stablecoin
     *      feeds on Base Sepolia which were measured at up to 20.7 hours old. Exceeding this returns 0
     *      from `isFresh`, which fails the batch rather than disabling the gate.
     */
    uint256 public constant MAX_STALENESS = 30 days;

    // ---------------------------------------------------------------------------------------------
    // Verdict form. Returns one word. Gate with `constraint: { eq: 1n }`.
    // ---------------------------------------------------------------------------------------------

    /**
     * @notice 1 when the round is usable, 0 when it must be rejected.
     * @dev Never reverts on a well-formed aggregator, by design. Use this for the gate itself.
     *
     *      Rejects, in order: a zero address, an aggregator with no code, `maxStaleness` above
     *      MAX_STALENESS, `updatedAt == 0`, a non-positive answer, `updatedAt` in the future, age above
     *      `maxStaleness`, and `answeredInRound < roundId`.
     *
     * @param aggregator Chainlink proxy address.
     * @param maxStaleness Maximum tolerated age of the round, in seconds.
     */
    function isFresh(address aggregator, uint256 maxStaleness) public view returns (uint256 ok) {
        if (aggregator == address(0)) return 0;
        // An EOA returns empty data. Catching it here turns a silent zero into an explicit verdict.
        if (aggregator.code.length == 0) return 0;
        // Fails closed on a misconfigured tolerance rather than disabling the gate.
        if (maxStaleness > MAX_STALENESS) return 0;

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IAggregatorV3(aggregator).latestRoundData();

        if (!_roundIsUsable(roundId, answer, updatedAt, maxStaleness, answeredInRound)) return 0;

        return 1;
    }

    /**
     * @notice Freshness plus an L2 sequencer gate.
     * @dev Mainnet-only in practice. Base Sepolia publishes no sequencer uptime feed, so this is
     *      unusable there. See ADR-0004.
     *
     *      Chainlink's convention on the sequencer feed is `answer == 0` for up and `1` for down, so
     *      the check is inverted relative to intuition and easy to get wrong. This reads it correctly.
     *
     *      `gracePeriod` additionally refuses to trade until the sequencer has been up long enough for
     *      L2 prices to be trustworthy again.
     */
    function isFreshWithSequencer(address aggregator, address sequencerFeed, uint256 maxStaleness, uint256 gracePeriod)
        external
        view
        returns (uint256 ok)
    {
        if (isFresh(aggregator, maxStaleness) != 1) return 0;
        if (sequencerFeed == address(0) || sequencerFeed.code.length == 0) return 0;

        (uint80 seqRoundId, int256 seqAnswer, uint256 seqStartedAt,, uint80 seqAnsweredInRound) =
            IAggregatorV3(sequencerFeed).latestRoundData();

        // The sequencer feed reports 0 when up and 1 when down.
        if (seqAnswer != 0) return 0;
        if (seqAnsweredInRound < seqRoundId) return 0;
        if (seqStartedAt == 0 || seqStartedAt > block.timestamp) return 0;
        // Sequencer just recovered. Prices may still be catching up.
        if (block.timestamp - seqStartedAt <= gracePeriod) return 0;

        return 1;
    }

    // ---------------------------------------------------------------------------------------------
    // Value form. Returns one word. Gate with a single constraint.
    // ---------------------------------------------------------------------------------------------

    /**
     * @notice The answer, as the single return word, but only when the round is usable.
     *
     * @dev Returning ONE word is load-bearing, not stylistic. `@biconomy/smart-batching`'s
     *      `contract.check` accepts a single `RuntimeConstraint`, and the composability engine compares
     *      a single constraint against word 0 of the resolved value. `latestRoundData()` puts `roundId`
     *      at word 0 and the answer at word 1, so the price is unreachable without this function.
     *
     *      Reverts rather than returning 0, so a consuming STATIC_CALL fails loudly instead of
     *      substituting a plausible-looking bad price.
     *
     *      Pair with an `or` band for a two-sided guard:
     *
     *          guard.check({
     *              functionName: "answerIfFresh",
     *              args: [feed, 1200],
     *              constraint: { or: [{ gteSigned: minPrice }, { lteSigned: maxPrice }] },
     *          });
     */
    function answerIfFresh(address aggregator, uint256 maxStaleness) public view returns (int256 answer) {
        if (aggregator == address(0)) revert ZeroAggregator();
        if (aggregator.code.length == 0) revert NotAContract(aggregator);
        if (maxStaleness > MAX_STALENESS) revert OutOfRange();

        (uint80 roundId, int256 a,, uint256 updatedAt, uint80 answeredInRound) =
            IAggregatorV3(aggregator).latestRoundData();

        if (!_roundIsUsable(roundId, a, updatedAt, maxStaleness, answeredInRound)) {
            revert StaleFeed(
                aggregator, a, updatedAt, block.timestamp > updatedAt ? block.timestamp - updatedAt : 0, maxStaleness
            );
        }

        return a;
    }

    /**
     * @notice The answer with freshness bundled, plus an optional explicit price band.
     * @dev Convenience for callers that want one call to enforce both. Returns one word, so a single
     *      constraint can still gate it. The band is expressed in feed units, i.e. already scaled by
     *      10**decimals.
     */
    function answerIfFreshInBand(address aggregator, uint256 maxStaleness, int256 lowerBound, int256 upperBound)
        external
        view
        returns (int256 answer)
    {
        if (lowerBound > upperBound) revert OutOfRange();
        int256 a = answerIfFresh(aggregator, maxStaleness);
        if (a < lowerBound || a > upperBound) revert UnusableAnswer(aggregator, a);
        return a;
    }

    /**
     * @notice Reads a feed and reports the round's age in seconds.
     * @dev Diagnostic helper for the client and the keeper. Not used as a gate, because it returns
     *      several words and therefore cannot carry a single constraint.
     */
    function roundAge(address aggregator)
        external
        view
        returns (uint256 age, uint256 updatedAt, int256 answer, uint80 roundId)
    {
        if (aggregator == address(0) || aggregator.code.length == 0) revert NotAContract(aggregator);
        (roundId, answer,, updatedAt,) = IAggregatorV3(aggregator).latestRoundData();
        age = block.timestamp > updatedAt ? block.timestamp - updatedAt : 0;
    }

    // ---------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------

    /**
     * @dev The single definition of "usable". Shared by the verdict and value forms so the two can
     *      never drift apart, which would let a caller gate on freshness and read a price that failed
     *      a different check.
     */
    function _roundIsUsable(
        uint80 roundId,
        int256 answer,
        uint256 updatedAt,
        uint256 maxStaleness,
        uint80 answeredInRound
    ) private view returns (bool) {
        // An uninitialised aggregator reports zeros.
        if (updatedAt == 0) return false;
        // Zero and negative answers are not prices.
        if (answer <= 0) return false;
        // A round timestamped in the future cannot be fresh. This also catches a chain with a skewed clock.
        if (updatedAt > block.timestamp) return false;
        // The relative check ERC-8211 cannot express.
        if (block.timestamp - updatedAt > maxStaleness) return false;
        // A round the aggregator has not yet considered answered.
        if (answeredInRound < roundId) return false;
        return true;
    }
}
