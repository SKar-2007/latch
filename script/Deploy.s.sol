// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {FeedGuard} from "../contracts/FeedGuard.sol";
import {QuoterGuard} from "../contracts/QuoterGuard.sol";
import {FailSafeExecutor} from "../contracts/FailSafeExecutor.sol";
import {MockOracle} from "../contracts/mocks/MockOracle.sol";

/**
 * @title Deploy
 * @notice Deploys LATCH to Base Sepolia. See docs/10-deployment-runbook.md for the full procedure.
 *
 * @dev FailSafeExecutor is deployed but deliberately NOT installed. Per adr-0002 the default is
 *      REVERT_BATCH everywhere, and installing an unaudited executor by default would undercut the
 *      atomicity claim in adr-0001.
 */
contract Deploy is Script {
    // Verified on Base Sepolia, 2026-10-02. See docs/appendix/verification-log.md.
    address constant COMPOSABILITY_MODULE = 0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7;
    address constant COMPOSABLE_STORAGE = 0x00008211dea1Aca67ac55fc44AE3bF88CF41281d;
    address constant NEXUS_1_3_1 = 0x0000000020fe2F30453074aD916eDeB653eC7E9D;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        console.log("LATCH deployer:", deployer);
        console.log("Balance:", deployer.balance);

        // Pre-flight. Both must be non-empty, or the composability layer is absent on this chain.
        require(COMPOSABILITY_MODULE.code.length > 0, "composability module missing on this chain");
        require(COMPOSABLE_STORAGE.code.length > 0, "composable storage missing on this chain");
        console.log("Composability module: OK");
        console.log("Composable storage:   OK");

        // The account that will run batches must itself support composable execution.
        // The address Biconomy documents is a 1.2.0 build without it. See verification-log V-04.
        (bool ok, bytes memory ret) = NEXUS_1_3_1.staticcall(abi.encodeWithSignature("accountId()"));
        require(ok && ret.length >= 32, "Nexus 1.3.1 not deployed");
        console.log("Nexus accountId:", _decodeString(ret));

        vm.startBroadcast(pk);

        FeedGuard feedGuard = new FeedGuard();
        console.log("FeedGuard:        ", address(feedGuard));

        QuoterGuard quoterGuard = new QuoterGuard();
        console.log("QuoterGuard:      ", address(quoterGuard));

        // Deployed and left uninstalled. See adr-0002.
        FailSafeExecutor failSafe = new FailSafeExecutor(COMPOSABILITY_MODULE, COMPOSABLE_STORAGE);
        console.log("FailSafeExecutor: ", address(failSafe), "(deployed, NOT installed)");

        MockOracle mockOracle = new MockOracle(8, "MOCK / ETH-USD");
        console.log("MockOracle:       ", address(mockOracle), "(testnet only)");

        vm.stopBroadcast();

        console.log("");
        console.log("Add to deployments/84532.json:");
        console.log("  feedGuard:      ", address(feedGuard));
        console.log("  quoterGuard:    ", address(quoterGuard));
        console.log("  failSafe:       ", address(failSafe));
        console.log("  mockOracle:     ", address(mockOracle));
        console.log("");
        console.log("Next: verify feedGuard.isFresh(ETH_USD, 1200) == 1 before using anything.");
    }

    /// @dev Minimal ABI string reader. accountId() returns a dynamic string.
    function _decodeString(bytes memory encoded) private pure returns (string memory out) {
        if (encoded.length < 64) return "";

        uint256 offset;
        uint256 length;
        assembly {
            offset := mload(encoded)
            length := mload(add(encoded, 0x20))
        }
        if (length == 0 || offset + 32 + length > encoded.length) return "";

        out = new string(length);
        assembly {
            // Copy straight from the calldata-derived buffer into the string's bytes.
            mstore(add(out, 0x20), length)
            let src := add(add(encoded, 0x20), offset)
            let dst := add(out, 0x20)
            for { let i := 0 } lt(i, length) { i := add(i, 32) } {
                mstore(add(dst, i), mload(add(src, i)))
            }
        }
    }
}
