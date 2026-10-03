// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IAggregatorV3
 * @notice The read surface LATCH depends on. Matches Chainlink's AggregatorV3Interface.
 * @dev Declared locally so LATCH has no external dependency for a five-function interface.
 *      The five return values are five 32-byte words, in this order, which matters for
 *      ERC-8211 constraint indexing. See docs/04-constraints-and-oracles.md.
 */
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    /// @return roundId Word 0. A round counter, never a price.
    /// @return answer Word 1. The value. Signed, scaled by 10**decimals.
    /// @return startedAt Word 2.
    /// @return updatedAt Word 3.
    /// @return answeredInRound Word 4.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80);
}
