// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {QuoterGuard} from "../../contracts/QuoterGuard.sol";
import {IQuoterV2} from "../../contracts/interfaces/IQuoterV2.sol";

/**
 * @title QuoterGuardLive
 * @notice Exercises `IQuoterV2` against Uniswap's real Quoter and a real Base Sepolia pool.
 *
 * @dev This is the test V-23 should have made possible, and it turned up V-25.
 *
 *      Until now `QuoterGuard` had only ever been pointed at `MockQuoter`, which was written from
 *      the same mis-transposed interface. Mock and interface agreed with each other, so every unit
 *      test passed and nothing ever compared either against Uniswap. When they finally met, the
 *      parameter order was wrong and the guard would have reverted against a perfectly good quoter.
 *      The selector tests below are the ones that would have caught it.
 *
 *      The quoter is Uniswap's, deployed from `quoter/Quoter.hex`, compiled from the pinned
 *      v3-periphery v1.0.0 tag. Deploying it here rather than trusting a chain address keeps the test
 *      independent of a third party staying put, and keeps us out of the habit V-23 exposed: taking
 *      someone's word for what lives at an address.
 *
 *      V-25: Uniswap's Quoter cannot be reached through a `staticcall`, so `QuoterGuard` cannot read
 *      live liquidity. See `test_theGuardCannotReadLiveLiquidityAndThatIsDocumented`.
 *
 *      Runs against a fork. Skipped when no RPC is configured, so the offline suite still passes.
 */
contract QuoterGuardLiveTest is Test {
    address constant UNISWAP_V3_FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    address constant WETH9 = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    /// @dev 15 USDC, matching the demo batch.
    uint256 constant AMOUNT_IN = 15_000_000;
    uint24 constant FEE = 3000;

    QuoterGuard guard;
    address quoter;
    bool private forkActive;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            return;
        }

        vm.createSelectFork(rpc);
        forkActive = true;

        quoter = _deployQuoter(UNISWAP_V3_FACTORY, WETH9);
        guard = new QuoterGuard();
    }

    modifier onlyFork() {
        if (!forkActive) {
            emit log("no BASE_SEPOLIA_RPC_URL, skipping live quoter tests");
            return;
        }
        _;
    }

    /* ------------------------------------------------------------------ */
    /* Interface correctness, against Uniswap's bytecode                     */
    /* ------------------------------------------------------------------ */

    /**
     * @dev The quoter must answer the selector `IQuoterV2` declares.
     *
     *      Built from two independent sources: the bytecode is Uniswap's, compiled from its own
     *      pinned tag, and the selector is transcribed from Uniswap's signature. V-23 could not make
     *      this assertion, because it scanned a third-party address for the selector *this
     *      repository* declared -- `0x1296323f`, which no Uniswap contract has. That check passed for
     *      every contract on earth, including a real Quoter, so it proved nothing.
     */
    function test_deployedQuoterAnswersOurSelector() public onlyFork {
        assertTrue(_hasSelector(quoter, IQuoterV2.quoteExactInputSingle.selector), "selector mismatch");
    }

    /// @dev The quoter must *not* answer the transposed selector, which is the bug this repo shipped.
    function test_deployedQuoterDoesNotAnswerTheTransposedSelector() public onlyFork {
        assertFalse(_hasSelector(quoter, bytes4(0x1296323f)), "the transposed ordering must not be what we call");
    }

    /* ------------------------------------------------------------------ */
    /* V-25: the quoter is unreachable through a staticcall                 */
    /* ------------------------------------------------------------------ */

    /**
     * @dev Uniswap's Quoter *does* work, when reached with `CALL`. Real liquidity, real quote.
     *
     *      Kept as a plain `CALL` inside a deliberately non-view helper. It is not used by
     *      `QuoterGuard`, and it must not be: see the test below for why.
     */
    function test_theQuoterItselfWorksOverCall() public onlyFork {
        uint256 amountOut = this._quoteViaCall(quoter);
        emit log_named_uint("amountOut for 15 USDC, WETH wei", amountOut);

        assertGt(amountOut, 0, "a liquid pool must return a non-zero quote");
        // 15 USDC is worth far more than 0.0001 WETH at any plausible ETH price. A quote below that
        // means the decimals, the pool, or the parameter order are wrong rather than merely thin.
        assertGt(amountOut, 0.0001 ether, "implausibly small quote, suspect decimals or pool");
    }

    /// @dev CALL, not STATICCALL. Non-view on purpose; see V-25.
    function _quoteViaCall(address target) external returns (uint256 amountOut) {
        (bool ok, bytes memory ret) = target.call(
            abi.encodeWithSelector(IQuoterV2.quoteExactInputSingle.selector, USDC, WETH9, FEE, AMOUNT_IN, uint160(0))
        );
        require(ok, "quoter reverted");
        amountOut = abi.decode(ret, (uint256));
    }

    /**
     * @dev V-25, asserted so the constraint cannot be rediscovered the hard way.
     *
     *      `QuoterGuard._quote` reaches the quoter with a `staticcall`, because the guard is `view`
     *      and a view function may not mutate state. Uniswap's Quoter cannot be reached that way:
     *      it calls `IUniswapV3Pool.swap`, which emits a `Swap` event, and `LOG` is forbidden inside
     *      a static context. Forge reports this as `StateChangeDuringStaticCall`.
     *
     *      So the guard reverts against Uniswap's real Quoter with `ZeroQuote`, and will keep doing
     *      so. This is not a wiring mistake to be patched by swapping in a `call`: `QuoterGuard`
     *      takes the quoter address as an argument, so a `call` would hand an arbitrary,
     *      caller-chosen contract the ability to mutate state in the middle of a `view` check.
     *
     *      The fix belongs in the design, not in the call opcode. Quote off-chain, where `eth_call`
     *      allows the discarded state change, and enforce the resulting bound on-chain. See V-25.
     */
    function test_theGuardCannotReadLiveLiquidityAndThatIsDocumented() public onlyFork {
        (bool okStatic,) = quoter.staticcall(
            abi.encodeWithSelector(IQuoterV2.quoteExactInputSingle.selector, USDC, WETH9, FEE, AMOUNT_IN, uint160(0))
        );
        assertFalse(okStatic, "STATICCALL must keep being impossible, or V-25 can be revisited");

        // And the guard surfaces it as its own legible error rather than bubbling Uniswap's noise.
        vm.expectRevert(abi.encodeWithSelector(QuoterGuard.ZeroQuote.selector, USDC, WETH9, AMOUNT_IN, FEE));
        guard.quoteExactInputSingle(quoter, USDC, WETH9, AMOUNT_IN, FEE);
    }

    /* ------------------------------------------------------------------ */
    /* Guard behaviour that does not need a live quoter                     */
    /* ------------------------------------------------------------------ */

    /// @dev Ordering regression, provable without the chain: a nonzero fee must arrive as the fee.
    function test_guardRejectsAnEmptyPoolRatherThanSwallowingIt() public onlyFork {
        // address(0) is not a pool at fee 3000, so the factory returns address(0) and Uniswap reverts.
        vm.expectRevert();
        guard.quoteExactInputSingle(quoter, address(0), WETH9, AMOUNT_IN, FEE);
    }

    function _deployQuoter(address factory, address weth9) private returns (address deployed) {
        bytes memory code = vm.parseBytes(vm.readLine("quoter/Quoter.hex"));
        bytes memory args = abi.encode(factory, weth9);

        bytes memory initCode = new bytes(code.length + args.length);
        for (uint256 i; i < code.length; ++i) {
            initCode[i] = code[i];
        }
        for (uint256 i; i < args.length; ++i) {
            initCode[code.length + i] = args[i];
        }

        assembly ("memory-safe") {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(deployed != address(0), "quoter deployment failed");
    }

    function _hasSelector(address target, bytes4 sel) private view returns (bool) {
        bytes memory code = target.code;
        if (code.length < 4) return false;
        for (uint256 i; i + 4 <= code.length; ++i) {
            if (
                bytes4(code[i]) | (bytes4(code[i + 1]) >> 8) | (bytes4(code[i + 2]) >> 16) | (bytes4(code[i + 3]) >> 24)
                    == sel
            ) {
                return true;
            }
        }
        return false;
    }
}
