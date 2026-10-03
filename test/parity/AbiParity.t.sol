// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {ParityBatch} from "../../contracts/mocks/ParityBatch.sol";
import {ComposableExecution, ConstraintType} from "../../contracts/interfaces/IComposabilityTypes.sol";

/**
 * @title AbiParity
 * @notice Pins the committed ABI fixture to Solidity's encoder.
 *
 * @dev Why a fixture at all. The client cannot use `viem` for this struct: `encodeAbiParameters`
 *      routes a nested tuple into its `bytes` encoder, whose `size()` helper returns `value.length`
 *      for a non-string, so a `ComposableExecution` is measured as a 3-byte `bytes4` and the call
 *      throws. The client hand-rolls the codec instead, and a hand-rolled codec tested only against
 *      itself proves nothing.
 *
 *      So the reference is Solidity's own `abi.encode` over the real struct types. This test asserts
 *      the committed fixture still matches it, and `client/test/abiParity.test.ts` asserts the
 *      TypeScript encoder reproduces the same bytes. Three implementations agreeing on one fixture is
 *      the actual guarantee.
 *
 *      Regenerate deliberately:
 *
 *          forge script script/EmitAbiFixture.s.sol --broadcast
 *
 *      The test never writes the file. A test that regenerates its own fixture always passes and
 *      leaves the tree dirty, so a format change would be invisible in review.
 */
contract AbiParityTest is Test {
    string constant FIXTURE = "client/test/fixtures/batch.abi.json";

    function test_committedFixtureMatchesSolidityEncoding() public view {
        bytes memory encoded = ParityBatch.encodeArgumentContent();

        assertGt(encoded.length, 0, "encoding must not be empty");
        assertEq(encoded.length % 32, 0, "a top-level array encoding is a whole number of words");

        assertTrue(
            _contains(vm.readFile(FIXTURE), vm.toString(encoded)),
            "fixture is stale: re-run forge script script/EmitAbiFixture.s.sol --broadcast"
        );
    }

    /// @dev Proves the fixture is a real batch rather than stable bytes, by decoding it again.
    function test_fixtureRoundTripsThroughSolidity() public pure {
        ComposableExecution[] memory batch = ParityBatch.build();
        ComposableExecution[] memory decoded = abi.decode(abi.encode(batch), (ComposableExecution[]));

        assertEq(decoded.length, batch.length, "entry count");
        assertEq(decoded[0].functionSig, batch[0].functionSig, "entry 0 selector");
        assertEq(decoded[1].functionSig, batch[1].functionSig, "entry 1 selector");
        assertEq(decoded[0].inputParams[0].paramData, batch[0].inputParams[0].paramData, "packed BALANCE data");
        assertEq(decoded[1].inputParams[1].paramData, batch[1].inputParams[1].paramData, "STATIC_CALL paramData");
        assertEq(decoded[0].outputParams[0].paramData, batch[0].outputParams[0].paramData, "capture data");

        assertEq(
            decoded[1].inputParams[1].constraints.length,
            batch[1].inputParams[1].constraints.length,
            "nested constraint count"
        );
        assertEq(
            uint8(decoded[1].inputParams[1].constraints[1].constraintType),
            uint8(ConstraintType.OR),
            "the OR survived the round trip"
        );
        assertEq(
            decoded[1].inputParams[1].constraints[1].referenceData,
            batch[1].inputParams[1].constraints[1].referenceData,
            "the OR's abi-encoded sub-constraints survived"
        );

        assertEq(abi.encode(decoded), abi.encode(batch), "re-encoding must be byte-identical");
    }

    /// @dev Substring search, so the fixture can be JSON without a parser.
    function _contains(string memory haystack, string memory needle) private pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;

        for (uint256 i; i <= h.length - n.length; i++) {
            bool hit = true;
            for (uint256 j; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }
}
