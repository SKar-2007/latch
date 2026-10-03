// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/**
 * @title RevertingAggregator
 * @notice An aggregator whose reads revert. Proves FeedGuard surfaces a loud failure.
 */
contract RevertingAggregator is IAggregatorV3 {
    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "reverting";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) {
        revert("aggregator unavailable");
    }

    function getRoundData(uint80) external pure returns (uint80, int256, uint256, uint256, uint80) {
        revert("aggregator unavailable");
    }
}
