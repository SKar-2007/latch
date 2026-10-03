// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {FullMath} from "../helpers/FullMath.sol";
import {QuoterGuard} from "../../contracts/QuoterGuard.sol";
import {MockQuoter} from "../../contracts/mocks/MockQuoter.sol";

/**
 * @title QuoterHandler
 * @notice Drives `QuoterGuard` over the whole input space, including the inputs a well-behaved
 *         quoter would never produce.
 *
 * @dev The interesting failures here are arithmetic, not control flow. Every action therefore pairs
 *      the guard's answer with a 512-bit reference computation, so a bug shows up as a disagreement
 *      rather than as a panic the test has to pre-emptively allow.
 */
contract QuoterHandler is Test {
    QuoterGuard internal immutable guard;
    MockQuoter internal immutable quoter;

    constructor(QuoterGuard guard_, MockQuoter quoter_) {
        guard = guard_;
        quoter = quoter_;
    }

    address internal constant TOKEN_A = address(0xA11CE);
    address internal constant TOKEN_B = address(0xB0B);
    uint24 internal constant FEE = 3000;

    /// @dev Last successful `applySlippage` call, for the monotonicity invariant.
    uint256 internal lastAmount;
    uint256 internal lastBps;
    uint256 internal lastResult;
    bool internal lastValid;

    /// @dev Bps deliberately sampled at the boundaries, where an off-by-one would hide.
    function pickBps(uint256 seed) internal pure returns (uint256) {
        uint256 i = seed % 5;
        if (i == 0) return 0;
        if (i == 1) return 1;
        if (i == 2) return 9_999;
        if (i == 3) return 5_000;
        return seed % 10_000;
    }

    /// @dev Amounts deliberately include values that overflow a naive `amount * numerator`.
    function pickAmount(uint256 seed) internal pure returns (uint256) {
        uint256 i = seed % 5;
        if (i == 0) return 1;
        if (i == 1) return 9_999;
        if (i == 2) return 10_000;
        // type(uint256).max is the case that first overflowed `amount * (10_000 - bps)`.
        if (i == 3) return type(uint256).max;
        return seed;
    }

    function setQuote(uint256 seed) external {
        quoter.setAmountOut(pickAmount(seed));
    }

    function fuzzApplySlippage(uint256 seed) external view {
        uint256 amount = pickAmount(seed);
        uint256 bps = pickBps(seed);

        uint256 got = guard.applySlippage(amount, bps);
        uint256 expected = FullMath.mulDiv(amount, 10_000 - bps, 10_000);

        assertEq(got, expected, "applySlippage disagrees with 512-bit reference");
        assertLe(got, amount, "the bound must never exceed the quote");
        assertGe(got, 0, "unsigned");
    }

    function fuzzMinAmountOut(uint256 seed) external {
        uint256 amountIn = pickAmount(seed);
        uint256 bps = pickBps(seed);

        quoter.setAmountOut(amountIn);
        uint256 minOut = guard.minAmountOut(address(quoter), TOKEN_A, TOKEN_B, amountIn, FEE, bps);

        assertEq(minOut, FullMath.mulDiv(amountIn, 10_000 - bps, 10_000), "minAmountOut math");
        assertLe(minOut, amountIn, "the bound must never exceed the quote");
    }

    /// @dev The two entry points must agree wherever both succeed. They exist to surface failure in
    ///      different places, so a divergence in the number itself would be a bug in one of them.
    function fuzzBothFormsAgree(uint256 seed) external {
        uint256 amountIn = pickAmount(seed);
        uint256 bps = pickBps(seed);
        uint256 minFloor = pickAmount(seed >> 32);

        quoter.setAmountOut(amountIn);

        try guard.minAmountOut(address(quoter), TOKEN_A, TOKEN_B, amountIn, FEE, bps) returns (uint256 a) {
            try guard.requireMinAmountOut(address(quoter), TOKEN_A, TOKEN_B, amountIn, FEE, bps, minFloor) returns (uint256 b) {
                assertEq(a, b, "minAmountOut and requireMinAmountOut disagreed");
                assertGe(b, minFloor, "requireMinAmountOut succeeded below floor");
            } catch {
                // Only legitimate reason to differ: minFloor is above the calculated bound a.
                assertLt(a, minFloor, "requireMinAmountOut may only revert once the bound is below minFloor");
            }
        } catch {
            // minAmountOut failed; requireMinAmountOut must fail too.
            try guard.requireMinAmountOut(address(quoter), TOKEN_A, TOKEN_B, amountIn, FEE, bps, minFloor) returns (uint256) {
                revert("requireMinAmountOut succeeded where minAmountOut reverted");
            } catch {
                // Expected.
            }
        }
    }

    /// @dev Records a pair so the monotonicity invariant has something to compare.
    function recordMonotonicPair(uint256 seed) external {
        uint256 amount = pickAmount(seed);
        uint256 bpsA = pickBps(seed);
        uint256 bpsB = pickBps(seed >> 16);

        lastAmount = amount;
        lastBps = bpsA;
        lastResult = guard.applySlippage(amount, bpsA);
        lastValid = true;

        // Applying the tighter of the two must never produce a looser bound.
        if (bpsB >= bpsA) {
            assertLe(guard.applySlippage(amount, bpsB), lastResult, "a tighter tolerance loosened the bound");
        } else {
            assertGe(guard.applySlippage(amount, bpsB), lastResult, "a looser tolerance tightened the bound");
        }
    }

    function hasPair() external view returns (bool) {
        return lastValid;
    }

    function pairAmount() external view returns (uint256) {
        return lastAmount;
    }

    function pairBps() external view returns (uint256) {
        return lastBps;
    }

    function pairResult() external view returns (uint256) {
        return lastResult;
    }

    /// @dev A one-word return, because a single SDK constraint reads word 0 and nothing else.
    ///
    ///      The quoter is pinned to a non-zero output first: a randomised `setQuote` may have left it
    ///      at zero, in which case `MockQuoter` reverts and the assertion would be measuring the mock.
    function returnLengthIsOneWord() external returns (uint256 len) {
        quoter.setAmountOut(1e18);
        (bool ok, bytes memory ret) = address(guard)
            .staticcall(abi.encodeCall(QuoterGuard.minAmountOut, (address(quoter), TOKEN_A, TOKEN_B, 1e18, FEE, 50)));
        assertTrue(ok, "call must succeed");
        return ret.length;
    }
}

/**
 * @title QuoterGuardInvariantTest
 * @notice Layer C for `QuoterGuard`.
 */
contract QuoterGuardInvariantTest is Test {
    QuoterGuard internal guard;
    MockQuoter internal quoter;
    QuoterHandler internal handler;

    uint256 internal constant BPS_DENOMINATOR = 10_000;

    function setUp() public {
        guard = new QuoterGuard();
        quoter = new MockQuoter(1e18);
        handler = new QuoterHandler(guard, quoter);

        targetContract(address(handler));

        bytes4[] memory actions = new bytes4[](6);
        actions[0] = handler.setQuote.selector;
        actions[1] = handler.fuzzApplySlippage.selector;
        actions[2] = handler.fuzzMinAmountOut.selector;
        actions[3] = handler.fuzzBothFormsAgree.selector;
        actions[4] = handler.recordMonotonicPair.selector;
        actions[5] = handler.returnLengthIsOneWord.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: actions}));
    }

    /// @dev The core arithmetic property, held for every amount including `type(uint256).max`.
    ///
    ///      This is the invariant that the naive `amount * (10_000 - bps) / 10_000` formulation
    ///      fails. It reverts with a panic, which in a production STATIC_CALL fetcher becomes an
    ///      opaque failure the user cannot act on.
    function invariant_slippageMathNeverOverflows() public view {
        uint256[6] memory amounts =
            [type(uint256).max, type(uint256).max - 1, uint256(1) << 200, uint256(1) << 128, 10_000, 1];

        for (uint256 i = 0; i < amounts.length; i++) {
            for (uint256 bps = 0; bps < BPS_DENOMINATOR; bps += 3_333) {
                uint256 got = guard.applySlippage(amounts[i], bps);
                assertEq(
                    got, FullMath.mulDiv(amounts[i], BPS_DENOMINATOR - bps, BPS_DENOMINATOR), "overflow or wrong math"
                );
            }
        }
    }

    /// @dev Monotonicity: a tighter tolerance must never produce a looser bound, for any amount.
    function invariant_tighterToleranceNeverLoosensTheBound() public view {
        uint256[4] memory amounts = [type(uint256).max, uint256(1) << 128, 10_000, 1];
        uint256[5] memory tolerances = [uint256(0), 1, 5_000, 9_998, 9_999];

        for (uint256 i = 0; i < amounts.length; i++) {
            for (uint256 j = 0; j < tolerances.length; j++) {
                for (uint256 k = j + 1; k < tolerances.length; k++) {
                    assertLe(
                        guard.applySlippage(amounts[i], tolerances[k]),
                        guard.applySlippage(amounts[i], tolerances[j]),
                        "bound rose as the tolerance tightened"
                    );
                }
            }
        }
    }

    /// @dev The bound is always at most the quote, and strictly below it once any slippage is allowed.
    function invariant_boundNeverExceedsTheQuote() public view {
        uint256[4] memory amounts = [type(uint256).max, uint256(1) << 160, 10_000, 1];
        uint256[4] memory tolerances = [uint256(0), 1, 5_000, 9_999];

        for (uint256 i = 0; i < amounts.length; i++) {
            for (uint256 j = 0; j < tolerances.length; j++) {
                uint256 bound = guard.applySlippage(amounts[i], tolerances[j]);
                assertLe(bound, amounts[i], "bound exceeded the quote");
                if (tolerances[j] > 0) assertLt(bound, amounts[i], "any slippage must reduce the bound");
            }
        }
    }

    /// @dev A single-word return. This is what makes the value usable by one SDK constraint; if it
    ///      ever grew a second word, the constraint would silently read the wrong one.
    function invariant_minAmountOutReturnsOneWord() public {
        assertEq(handler.returnLengthIsOneWord(), 32, "minAmountOut must return exactly one word");
    }

    /// @dev `minAmountOut` never returns a degenerate zero, because a zero bound disables the guard
    ///      while the client still shows a green tick.
    function test_zeroBoundIsNeverReturned() public {
        // amountOut = 1 with 1 bp tolerance floors to 0. That must revert, not return 0.
        quoter.setAmountOut(1);
        vm.expectRevert();
        guard.minAmountOut(address(quoter), address(0xA11CE), address(0xB0B), 1e18, 3000, 1);
    }
}
