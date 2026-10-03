// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IQuoterV2
 * @notice The Uniswap V3 Quoter view surface LATCH depends on.
 *
 * @dev The parameter order here is load-bearing, and it was wrong for most of this project's life.
 *
 *      Uniswap's `Quoter` and `QuoterV2` both declare:
 *
 *          quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee,
 *                                 uint256 amountIn, uint160 sqrtPriceLimitX96)
 *
 *      This interface used to declare `uint256 amountIn, uint24 fee` instead. Both orderings
 *      compile, both typecheck, and neither the compiler nor the test suite objects -- but they
 *      hash differently, so the interface asked for `0x1296323f` while every real Uniswap quoter
 *      answers to `0xf7729d43`. `QuoterGuard` would have reverted against a correctly deployed
 *      Quoter, and would have reported the failure as someone else's `ZeroQuote`.
 *
 *      It stayed hidden for two reasons that are worth remembering. The unit tests drove a
 *      `MockQuoter` that was written from the same mistaken interface, so mock and interface
 *      agreed with each other and disagreed with the world. And the smoke test that "verified" V-23
 *      proved a quoter was absent by scanning its bytecode for `0x1296323f` -- a selector that
 *      appears in no Uniswap contract, so the check would have failed against every contract
 *      including a genuine QuoterV2.
 *
 *      `test/interface/SelectorPin.t.sol` pins the selector to `0xf7729d43` so this cannot recur.
 */
interface IQuoterV2 {
    /**
     * @notice Uniswap's own parameter order: `fee` third, `amountIn` fourth.
     * @dev Selector `0xf7729d43`. Do not "tidy" this into amountIn-first.
     */
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    )
        external
        view
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}
