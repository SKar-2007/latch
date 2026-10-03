// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IQuoterV2
 * @notice The Uniswap V3 Quoter view surface LATCH depends on.
 */
interface IQuoterV2 {
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 fee,
        uint160 sqrtPriceLimitX96
    )
        external
        view
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}
