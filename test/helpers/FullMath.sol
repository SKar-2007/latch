// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title FullMath
 * @notice A wide `mulDiv`, used only by tests, as an independent reference for basis-point scaling.
 *
 * @dev Why this exists: `QuoterGuard` scales by basis points, and the obvious implementation
 *
 *          amountOut * (10_000 - slippageBps) / 10_000
 *
 *      overflows in checked arithmetic for a large enough `amountOut`. Fuzzing found that. The fix in
 *      the contract decomposes on the divisor:
 *
 *          amount = q * D + r;   amount * n / D = q * n + (r * n) / D
 *
 *      A test that reused that decomposition would happily agree with a bug in the decomposition,
 *      so the test needs a second implementation that shares no logic with the contract. This one
 *      splits the *multiplicand* into 128-bit halves and divides the high half first, which is
 *      structurally unrelated:
 *
 *          a = ah * 2^128 + al
 *          floor(a * b / d) = q0 * 2^128 + floor((r0 * 2^128 + al * b) / d)
 *          where  q0 = floor(ah * b / d),  r0 = ah * b mod d
 *
 *      This is safe without any 512-bit type because `b < d` is asserted, which gives
 *      `q0 <= ah < 2^128` so `q0 * 2^128` fits, and bounds every other intermediate by `2^193`.
 */
library FullMath {
    /**
     * @dev Returns `floor(a * b / d)` for `b <= d` and `d <= 2^64`.
     *
     *      `b == d` is allowed because zero slippage means a multiplier of exactly `d`, which is the
     *      boundary case this helper has to agree with.
     *
     * @param a The multiplicand. May be `type(uint256).max`.
     * @param b The multiplier. Must not exceed `d`.
     * @param d The denominator. Must fit in 64 bits.
     */
    function mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256 result) {
        require(d != 0, "FullMath: division by zero");
        require(b <= d, "FullMath: requires b <= d");
        require(d <= type(uint64).max, "FullMath: requires d <= 2^64 - 1");

        unchecked {
            uint256 ah = a >> 128;
            uint256 al = a & ((uint256(1) << 128) - 1);

            // ah * b < 2^128 * d <= 2^192.
            uint256 highProduct = ah * b;
            uint256 q0 = highProduct / d;
            uint256 r0 = highProduct % d;

            // r0 * 2^128 + al * b < d * 2^128 + 2^128 * d = 2^129 * d <= 2^193.
            uint256 lowProduct = (r0 << 128) + al * b;
            uint256 q1 = lowProduct / d;

            // q0 <= 2^128 - 1 because b <= d and ah < 2^128, so the shift cannot overflow.
            result = (q0 << 128) + q1;

            // Sanity: b <= d, so the quotient never exceeds `a`.
            require(result <= a, "FullMath: result must not exceed a");
        }
    }
}
