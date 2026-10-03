// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {ParityBatch} from "../contracts/mocks/ParityBatch.sol";

/**
 * @title EmitAbiFixture
 * @notice Writes the canonical ABI encoding of `ParityBatch` for the TypeScript parity test.
 *
 * @dev Run deliberately, never as part of `forge test`:
 *
 *          forge script script/EmitAbiFixture.s.sol --broadcast
 *
 *      The point of the fixture is to be reviewed. Regenerating it as a side effect of a test run
 *      would make every run pass and leave the working tree dirty, so a change in the wire format
 *      would never show up in a diff. Here it is an explicit act, and the diff is the review.
 */
contract EmitAbiFixture is Script {
    function run() external {
        string memory path = "client/test/fixtures/batch.abi.json";
        bytes memory encoded = ParityBatch.encodeArgumentContent();

        vm.writeFile(path, string.concat('{\n  "encoded": "', vm.toString(encoded), '"\n}\n'));

        console.log("wrote", path);
        console.logBytes(encoded);
    }
}
