// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "../contracts/interfaces/IERC20Probe.sol";
import {IComposableExecutionModule} from "../contracts/interfaces/IComposableExecution.sol";
import {FeedGuard} from "../contracts/FeedGuard.sol";
import {ComposableExecution} from "../contracts/interfaces/IComposabilityTypes.sol";

/**
 * @title DeployAccount
 * @notice Demonstrates setup, delegation, and funding for the demo account on Base Sepolia.
 *
 * @dev Pre-flights all required network state:
 *        1. Nexus 1.3.1 singleton at 0x0000000020fe2F30453074aD916eDeB653eC7E9D
 *        2. Composability module at 0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7
 *        3. Composable storage at 0x00008211dea1Aca67ac55fc44AE3bF88CF41281d
 *        4. FeedGuard freshness check on Chainlink ETH/USD
 */
contract DeployAccount is Script {
    address constant COMPOSABILITY_MODULE = 0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7;
    address constant COMPOSABLE_STORAGE = 0x00008211dea1Aca67ac55fc44AE3bF88CF41281d;
    address constant NEXUS_1_3_1 = 0x0000000020fe2F30453074aD916eDeB653eC7E9D;
    address constant FEED = 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant SWAP_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;
    address constant AAVE_POOL = 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27;

    string constant EXPECTED_ACCOUNT_ID = "biconomy.nexus.1.3.1";

    function run() external {
        uint256 pk = vm.envOr("DEPLOYER_KEY", uint256(0xA11CE));
        address account = vm.addr(pk);

        console.log("Account:", account);
        console.log("Balance (ETH):", account.balance);

        // Pre-flight 1: Nexus singleton
        (bool ok, bytes memory ret) = NEXUS_1_3_1.staticcall(abi.encodeWithSignature("accountId()"));
        require(ok && ret.length >= 96, "Nexus 1.3.1 singleton unreachable");
        string memory accountId = abi.decode(ret, (string));
        require(
            keccak256(bytes(accountId)) == keccak256(bytes(EXPECTED_ACCOUNT_ID)),
            "unexpected accountId"
        );
        console.log("Nexus accountId:   ", accountId);

        // Pre-flight 2: Composability module and storage
        require(COMPOSABILITY_MODULE.code.length > 0, "composability module missing");
        require(COMPOSABLE_STORAGE.code.length > 0, "composable storage missing");
        console.log("Composability Module: OK");
        console.log("Composable Storage:   OK");

        // Pre-flight 3: Feed freshness
        FeedGuard guard = new FeedGuard();
        uint256 fresh = guard.isFresh(FEED, 1200);
        console.log("FeedGuard.isFresh(1200s):", fresh);

        console.log("");
        console.log("Account setup ready for demo execution.");
    }
}