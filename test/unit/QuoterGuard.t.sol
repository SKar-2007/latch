// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {QuoterGuard} from "../../contracts/QuoterGuard.sol";
import {MockQuoter} from "../../contracts/mocks/MockQuoter.sol";
import {IQuoterV2} from "../../contracts/interfaces/IQuoterV2.sol";

/**
 * @title QuoterGuard test
 * @notice Layer A4 from docs/09-testing-strategy.md.
 */
contract QuoterGuardTest is Test {
    QuoterGuard internal guard;
    MockQuoter internal quoter;

    address internal constant TOKEN_IN = address(0x1111);
    address internal constant TOKEN_OUT = address(0x2222);
    uint24 internal constant FEE = 3000;
    uint256 internal constant QUOTE = 1000;

    function setUp() public {
        guard = new QuoterGuard();
        quoter = new MockQuoter(QUOTE);
    }

    /// @dev Overflow-safe expectation, matching the decomposition the contract uses.
    ///      The naive `quote * (10_000 - bps) / 10_000` overflows for large quotes, which is the
    ///      very bug this suite exists to catch. A test that overflows proves nothing.
    function _expected(uint256 quote, uint256 bps) internal pure returns (uint256) {
        unchecked {
            uint256 n = 10_000 - bps;
            return (quote / 10_000) * n + ((quote % 10_000) * n) / 10_000;
        }
    }

    // -------------------------------------------------------------------------------------------
    // Slippage arithmetic
    // -------------------------------------------------------------------------------------------

    function test_minAmountOut_appliesSlippage() public view {
        assertEq(guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, 50), 995, "0.5% of 1000");
    }

    function test_minAmountOut_zeroSlippageIsTheQuote() public view {
        assertEq(guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, 0), QUOTE);
    }

    function test_minAmountOut_fullHundredPercentIsRejected() public {
        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.InvalidSlippage.selector, 10_000));
        guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, 10_000);
    }

    function test_minAmountOut_slippageAboveDenominatorIsRejected() public {
        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.InvalidSlippage.selector, 10_001));
        guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, 10_001);
    }

    /// @dev Rounding must be down, so the bound is never more permissive than the stated tolerance.
    function testFuzz_minAmountOut_roundsDown(uint256 quote, uint256 bps) public {
        vm.assume(quote > 0);
        vm.assume(bps < 10_000);
        vm.assume(_expected(quote, bps) > 0);
        quoter.setAmountOut(quote);

        uint256 got = guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, bps);

        assertEq(got, _expected(quote, bps));
        assertLe(got, quote, "the bound can never exceed the quote");
    }

    function testFuzz_minAmountOut_neverExceedsTheQuote(uint256 quote, uint256 bps) public {
        vm.assume(quote > 0);
        vm.assume(bps < 10_000);
        vm.assume(_expected(quote, bps) > 0);
        quoter.setAmountOut(quote);

        assertLe(guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, bps), quote);
    }

    // -------------------------------------------------------------------------------------------
    // Shape. Must be one word so a single constraint lands on it.
    // -------------------------------------------------------------------------------------------

    function test_minAmountOut_returnsExactlyOneWord() public view {
        bytes memory encoded = abi.encode(guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, 50));
        assertEq(encoded.length, 32, "one word, so one constraint can gate it");
    }

    // -------------------------------------------------------------------------------------------
    // Degenerate quotes. A zero bound silently disables the guard, so it must revert.
    // -------------------------------------------------------------------------------------------

    function test_minAmountOut_revertsWhenBoundWouldBeZero() public {
        // 1 unit of output with 1% slippage rounds to 0.
        quoter.setAmountOut(1);

        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.ZeroQuote.selector, TOKEN_IN, TOKEN_OUT, 1e18, FEE));
        guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, 100);
    }

    function test_minAmountOut_revertsWhenQuoterHasNoRoute() public {
        quoter.setAmountOut(0);

        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.ZeroQuote.selector, TOKEN_IN, TOKEN_OUT, 1e18, FEE));
        guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, 50);
    }

    /// @dev A reverting quoter must surface as a legible ZeroQuote, not an opaque bubble-up.
    function test_minAmountOut_wrapsARevertingQuoter() public {
        address angry = address(new AngryQuoter());

        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.ZeroQuote.selector, TOKEN_IN, TOKEN_OUT, 1e18, FEE));
        guard.minAmountOut(angry, TOKEN_IN, TOKEN_OUT, 1e18, FEE, 50);
    }

    /// @dev Regression: a quote large enough to overflow `amount * (10_000 - bps)` must not revert.
    function test_minAmountOut_survivesAnOverflowingQuote() public {
        uint256 huge = type(uint256).max / 4;
        quoter.setAmountOut(huge);

        uint256 bound = guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE, 50);

        // The naive expression overflows here too, so the expectation uses the same decomposition
        // the contract uses. That is the point: no intermediate ever exceeds 256 bits.
        assertEq(bound, _expected(huge, 50));
        assertLt(bound, huge, "a 0.5% tolerance must reduce the quote");
    }

    function test_minAmountOut_revertsOnZeroQuote() public {
        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.ZeroQuote.selector, TOKEN_IN, TOKEN_OUT, 0, FEE));
        guard.minAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 0, FEE, 50);
    }

    // -------------------------------------------------------------------------------------------
    // Address validation
    // -------------------------------------------------------------------------------------------

    function test_minAmountOut_revertsOnZeroQuoter() public {
        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.ZeroAddress.selector, address(0)));
        guard.minAmountOut(address(0), TOKEN_IN, TOKEN_OUT, 1e18, FEE, 50);
    }

    function test_minAmountOut_revertsOnQuoterWithNoCode() public {
        address eoa = makeAddr("eoa");

        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.NotAContract.selector, eoa));
        guard.minAmountOut(eoa, TOKEN_IN, TOKEN_OUT, 1e18, FEE, 50);
    }

    function test_minAmountOut_revertsOnZeroTokenIn() public {
        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.ZeroAddress.selector, address(0)));
        guard.minAmountOut(address(quoter), address(0), TOKEN_OUT, 1e18, FEE, 50);
    }

    function test_minAmountOut_revertsOnZeroTokenOut() public {
        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.ZeroAddress.selector, address(0)));
        guard.minAmountOut(address(quoter), TOKEN_IN, address(0), 1e18, FEE, 50);
    }

    /// @dev Fee 0 means "unset" and must resolve to the canonical default rather than being forwarded.
    function test_minAmountOut_defaultsZeroFeeTo3000() public {
        // The spy returns 1000 only for fee 3000, and 777 for anything else.
        assertEq(
            guard.minAmountOut(address(new SpyQuoter()), TOKEN_IN, TOKEN_OUT, 1e18, 0, 0), 1000, "fee 0 became 3000"
        );
    }

    function test_minAmountOut_forwardsExplicitFee() public {
        assertEq(
            guard.minAmountOut(address(new SpyQuoter()), TOKEN_IN, TOKEN_OUT, 1e18, 500, 0),
            777,
            "fee 500 reached the quoter"
        );
    }

    // -------------------------------------------------------------------------------------------
    // requireMinAmountOut
    // -------------------------------------------------------------------------------------------

    function test_requireMinAmountOut_revertsWhenBoundUnderflowsTheInput() public {
        // Bound is 99% of 100, which is below the 1000 unit input.
        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.InsufficientOutput.selector, QUOTE, 990));
        guard.requireMinAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 1000, FEE, 100);
    }

    function test_requireMinAmountOut_returnsWhenBoundIsHealthy() public view {
        assertEq(guard.requireMinAmountOut(address(quoter), TOKEN_IN, TOKEN_OUT, 100, FEE, 50), 995);
    }

    // -------------------------------------------------------------------------------------------
    // Pure helpers
    // -------------------------------------------------------------------------------------------

    function test_applySlippage_matchesTheDocumentedFormula() public view {
        assertEq(guard.applySlippage(1000, 50), 995);
        assertEq(guard.applySlippage(1000, 0), 1000);
        assertEq(guard.applySlippage(1000, 9999), 0);
    }

    function test_quoteExactInputSingle_passesThrough() public view {
        assertEq(guard.quoteExactInputSingle(address(quoter), TOKEN_IN, TOKEN_OUT, 1e18, FEE), QUOTE);
    }

    function testFuzz_applySlippage_isMonotonicInSlippage(uint256 quote, uint256 lowBps, uint256 highBps) public view {
        vm.assume(quote > 0);
        vm.assume(lowBps < highBps);
        vm.assume(highBps < 10_000);

        uint256 loose = guard.applySlippage(quote, lowBps);
        uint256 tight = guard.applySlippage(quote, highBps);
        assertGe(loose, tight, "tighter tolerance must not raise the bound");
    }

    /// @dev No fallback, so an incompatible proxy cannot shadow a view with a mutating one.
    function test_hasNoFallback() public {
        (bool success,) = address(guard).call(abi.encodeWithSelector(0xdeadbeef));
        assertTrue(!success);
    }
}

/// @dev Distinguishes the fee it was called with by returning a different amount.
///      A view function cannot record state, so the fee is inferred from the return value.
contract SpyQuoter is IQuoterV2 {
    uint256 internal constant DEFAULT_FEE_OUT = 1000;
    uint256 internal constant OTHER_FEE_OUT = 777;

    function quoteExactInputSingle(address, address, uint256, uint24 fee, uint160)
        external
        pure
        returns (uint256, uint160, uint32, uint256)
    {
        return (fee == 3000 ? DEFAULT_FEE_OUT : OTHER_FEE_OUT, 0, 0, 0);
    }
}

/// @dev Reverts on every quote.
contract AngryQuoter is IQuoterV2 {
    function quoteExactInputSingle(address, address, uint256, uint24, uint160)
        external
        pure
        returns (uint256, uint160, uint32, uint256)
    {
        revert("no route for you");
    }
}
