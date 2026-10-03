// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {IQuoterV2} from "../../contracts/interfaces/IQuoterV2.sol";

/**
 * @title SelectorPin
 * @notice Pins `IQuoterV2.quoteExactInputSingle` to the selector Uniswap actually dispatches on.
 *
 * @dev `IQuoterV2` once declared `uint256 amountIn, uint24 fee` where Uniswap declares `uint24 fee,
 *      uint256 amountIn`. Solidity is happy either way -- both orderings compile, both typecheck,
 *      and the mock quoters were written from the same mistaken interface, so the unit suite agreed
 *      with itself and disagreed with every real Uniswap contract on earth.
 *
 *      A selector is the one place where an interface that "looks right" is silently, totally wrong,
 *      and no amount of unit testing against your own mocks will find it. Only the constant below
 *      will, because it is transcribed from Uniswap's source rather than derived from ours.
 *
 *      Verified against `lib/v3-periphery/contracts/lens/Quoter.sol` at tag v1.0.0, the release
 *      Uniswap's own deployment table pins for Base Sepolia.
 */
contract SelectorPinTest is Test {
    /// @dev keccak256("quoteExactInputSingle(address,address,uint24,uint256,uint160)")[..4].
    bytes4 constant UNISWAP_SELECTOR = 0xf7729d43;

    /// @dev The transposed ordering this interface used to declare.
    bytes4 constant TRANSPOSED_SELECTOR = 0x1296323f;

    function test_interfaceMatchesUniswapSelector() public pure {
        assertEq(
            IQuoterV2.quoteExactInputSingle.selector,
            UNISWAP_SELECTOR,
            "IQuoterV2 must dispatch on the selector Uniswap actually uses"
        );
    }

    /**
     * @dev Guards the specific regression rather than just the current value, so the reason this
     *      file exists survives someone reading only the assertion above.
     */
    function test_transposedOrderIsStillDistinct() public pure {
        assertTrue(
            IQuoterV2.quoteExactInputSingle.selector != TRANSPOSED_SELECTOR,
            "the transposed ordering must never look equivalent"
        );
    }

    /**
     * @dev The exact selector Uniswap's `Quoter` exposes, recomputed here from the signature string
     *      rather than trusted as a literal. If this disagrees with `UNISWAP_SELECTOR`, the constant
     *      above was mistyped, which is the failure mode this whole file exists to catch.
     */
    function test_constantIsDerivedFromTheSignatureNotMemory() public pure {
        assertEq(
            UNISWAP_SELECTOR,
            bytes4(keccak256("quoteExactInputSingle(address,address,uint24,uint256,uint160)")),
            "UNISWAP_SELECTOR must be the keccak of the signature, not a remembered hex string"
        );
    }

    function test_constantIsNotTheTransposedSignature() public pure {
        assertTrue(
            UNISWAP_SELECTOR != bytes4(keccak256("quoteExactInputSingle(address,address,uint256,uint24,uint160)")),
            "UNISWAP_SELECTOR must not be the keccak of the transposed signature"
        );
    }

    // -------------------------------------------------------------------------------------------
    // SwapRouter02 exactInputSingle selector pin
    // -------------------------------------------------------------------------------------------

    /// @dev SwapRouter02 struct signature: exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
    bytes4 constant SWAP_ROUTER02_SELECTOR = 0x04e45aaf;

    /// @dev The flat form without recipient that does not exist on SwapRouter02.
    bytes4 constant FLAT_SWAP_SELECTOR = 0xa2608210;

    function test_swapRouter02MatchesCanonicalStructSelector() public pure {
        assertEq(
            SWAP_ROUTER02_SELECTOR,
            bytes4(keccak256("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))")),
            "SWAP_ROUTER02_SELECTOR must match the ExactInputSingleParams struct signature"
        );
    }

    function test_swapRouter02IsNotTheFlatForm() public pure {
        assertTrue(
            SWAP_ROUTER02_SELECTOR != bytes4(keccak256("exactInputSingle(address,address,uint24,uint256,uint256,uint160)")),
            "SwapRouter02 requires the struct tuple with recipient, not the flat signature"
        );
    }
}
