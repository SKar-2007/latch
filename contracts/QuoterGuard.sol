// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IQuoterV2} from "./interfaces/IQuoterV2.sol";

/**
 * @title QuoterGuard
 * @notice Realises the slippage formula ERC-8211 cannot express, as a single return word.
 *
 * @dev Why this contract exists
 *
 * ERC-8211 has no arithmetic. `InputParam` has no expression or operator; fetchers return literal
 * bytes, a staticcall's return data, or a balance. So
 *
 *     minAmountOut = price * (1 - slippage)
 *
 * is inexpressible in the encoding. The two honest alternatives are documented in
 * docs/04-constraints-and-oracles.md: compute the bound off-chain at signing and encode it as a literal,
 * or compute it on-chain at execution. This contract is the second option.
 *
 * Design constraints this contract deliberately honours
 *
 * 1. Every function is `view`. Reached through the STATIC_CALL fetcher.
 * 2. No admin functions, no owner, no upgrade path, no proxy, no fallback function.
 * 3. Returns exactly one word, because a single SDK constraint lands on word 0. See ADR-0004.
 * 4. Reverts rather than returning a degenerate bound. A zero minimum would silently disable the
 *    slippage guard while the client still rendered a green tick.
 *
 * @dev Known limitation, stated plainly: this cannot read a live Uniswap Quoter. See V-25.
 *
 *      Uniswap's `Quoter` and `QuoterV2` reach the pool via `IUniswapV3Pool.swap`, which emits a
 *      `Swap` event, and `LOG` is forbidden in a static context. Since this function is `view` and
 *      so must use `STATICCALL`, no Uniswap quoter can ever be reached from here. Passing one
 *      produces `ZeroQuote`, not a Uniswap revert, so the failure is legible.
 *
 *      Do not "fix" this by switching to `CALL`. The quoter is a caller-supplied argument, so that
 *      would let an arbitrary contract mutate state and re-enter during a view call. Quote off-chain
 *      and enforce the bound here instead; the batch already carries `amountOutMin`.
 *
 * @dev Separately, stated plainly: a quoter view is not a guarantee. It reflects pool state at
 *      the moment of the call. The swap that consumes the returned bound still clears against live
 *      reserves within the same transaction. This narrows the window; it does not close it. No
 *      constraint mechanism closes it.
 */
contract QuoterGuard {
    /// @notice Slippage is expressed in basis points. 10_000 is 100%.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    error ZeroAddress(address target);
    error NotAContract(address target);
    error InvalidSlippage(uint256 slippageBps);
    error ZeroQuote(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee);
    error InsufficientOutput(uint256 amountOut, uint256 minOut);
    error PoolNotFound(address tokenA, address tokenB, uint24 fee);

    /**
     * @notice Quotes at execution time and returns the minimum acceptable output.
     *
     * @dev `minOut = floor(amountOut * (10_000 - slippageBps) / 10_000)`. Rounding is down, so the
     *      bound is never more permissive than the stated tolerance.
     *
     *      `slippageBps` is a signed-time literal, which means the tolerance itself is part of what the
     *      user signed. That is the property this contract exists to provide.
     *
     *      Capture the result and feed it to the router's `amountOutMinimum`:
     *
     *          const storage = batch.storage();
     *          const key = await storage.getStorageKey();
     *          guard.write({
     *              functionName: "minAmountOut",
     *              args: [QUOTER, tokenIn, tokenOut, amountIn, FEE, 50],
     *              capture: { type: "execResult", storageKey: key },
     *          });
     *          // later entry reads the captured value as the router's amountOutMinimum
     */
    function minAmountOut(
        address quoter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 fee,
        uint256 slippageBps
    ) public view returns (uint256 minOut) {
        uint256 amountOut = _quote(quoter, tokenIn, tokenOut, amountIn, fee);
        minOut = _applySlippage(amountOut, slippageBps);

        // A zero bound disables the guard. Fail loudly instead.
        if (minOut == 0) revert ZeroQuote(tokenIn, tokenOut, amountIn, fee);
    }

    /**
     * @notice As `minAmountOut`, but reverts if the live quote already fails the bound.
     * @dev Use when the batch should abort rather than proceed with a tight bound the router will
     *      reject anyway. The difference is where the failure surfaces: here it is a STATIC_CALL
     *      revert, there it is the router's own revert inside the entry.
     */
    function requireMinAmountOut(
        address quoter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 fee,
        uint256 slippageBps
    ) external view returns (uint256 minOut) {
        uint256 amountOut = _quote(quoter, tokenIn, tokenOut, amountIn, fee);
        minOut = _applySlippage(amountOut, slippageBps);

        if (minOut == 0) revert ZeroQuote(tokenIn, tokenOut, amountIn, fee);
        if (minOut < amountIn) revert InsufficientOutput(amountOut, minOut);
    }

    /**
     * @notice The raw quote, unwrapped.
     * @dev Diagnostic helper. Returns several words, so it cannot carry a single constraint. Use
     *      `minAmountOut` for gating.
     */
    function quoteExactInputSingle(address quoter, address tokenIn, address tokenOut, uint256 amountIn, uint24 fee)
        external
        view
        returns (uint256 amountOut)
    {
        return _quote(quoter, tokenIn, tokenOut, amountIn, fee);
    }

    /**
     * @notice The slippage arithmetic on its own, so it can be unit tested without a quoter.
     */
    function applySlippage(uint256 amount, uint256 slippageBps) public pure returns (uint256) {
        return _applySlippage(amount, slippageBps);
    }

    // ---------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------

    function _quote(address quoter, address tokenIn, address tokenOut, uint256 amountIn, uint24 fee)
        private
        view
        returns (uint256 amountOut)
    {
        if (quoter == address(0)) revert ZeroAddress(quoter);
        if (quoter.code.length == 0) revert NotAContract(quoter);
        if (tokenIn == address(0) || tokenOut == address(0)) {
            revert ZeroAddress(tokenIn == address(0) ? tokenIn : tokenOut);
        }
        if (amountIn == 0) revert ZeroQuote(tokenIn, tokenOut, amountIn, fee);
        // 3000 is the canonical Uniswap V3 default. Anything else must be passed explicitly.
        if (fee == 0) fee = 3000;

        // Call through a low-level staticcall so a reverting quoter surfaces as a legible
        // ZeroQuote rather than an opaque bubble-up from someone else's revert string.
        (bool ok, bytes memory ret) = quoter.staticcall(
            abi.encodeCall(IQuoterV2.quoteExactInputSingle, (tokenIn, tokenOut, fee, amountIn, uint160(0)))
        );
        if (!ok || ret.length < 32) revert ZeroQuote(tokenIn, tokenOut, amountIn, fee);

        // Four return values; only the first is used.
        amountOut = abi.decode(ret, (uint256));

        // A pool with no liquidity returns zero rather than reverting on some deployments.
        if (amountOut == 0) revert ZeroQuote(tokenIn, tokenOut, amountIn, fee);
    }

    function _applySlippage(uint256 amount, uint256 slippageBps) private pure returns (uint256) {
        // Checked explicitly rather than relying on a checked-arithmetic panic, so the failure is legible.
        if (slippageBps >= BPS_DENOMINATOR) revert InvalidSlippage(slippageBps);
        return _scaleByBps(amount, BPS_DENOMINATOR - slippageBps);
    }

    /**
     * @dev `floor(amount * numerator / 10_000)` with no overflow.
     *
     *      A direct `amount * numerator` overflows for a sufficiently large quote, which a hostile
     *      or broken quoter can return. Fuzzing found exactly that. Rather than carry a hand-rolled
     *      512-bit routine for a divisor we control, decompose on the divisor:
     *
     *          amount = q * D + r        where q = amount / D, r = amount % D
     *          amount * n / D = q * n + (r * n) / D
     *
     *      Exact, because the floor distributes over the decomposition. And bounded, because
     *      q <= amount / D so q * n < amount, and r * n < D * D = 10^8.
     */
    function _scaleByBps(uint256 amount, uint256 numerator) private pure returns (uint256) {
        unchecked {
            uint256 q = amount / BPS_DENOMINATOR;
            uint256 r = amount % BPS_DENOMINATOR;
            return q * numerator + (r * numerator) / BPS_DENOMINATOR;
        }
    }
}
