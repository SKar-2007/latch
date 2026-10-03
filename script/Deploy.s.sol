// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {FeedGuard} from "../contracts/FeedGuard.sol";
import {QuoterGuard} from "../contracts/QuoterGuard.sol";
import {FailSafeExecutor} from "../contracts/FailSafeExecutor.sol";
import {MockOracle} from "../contracts/mocks/MockOracle.sol";
import {IQuoterV2} from "../contracts/interfaces/IQuoterV2.sol";

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

    /// @dev What `accountId()` must return for the pinned address to be the build we verified.
    string constant EXPECTED_ACCOUNT_ID = "biconomy.nexus.1.3.1";

    /// @dev `executeComposable(ComposableExecution[])`, the capability the demo actually needs.
    bytes4 constant EXECUTE_COMPOSABLE_SELECTOR = 0x7eba07b8;

    // Uniswap's Base Sepolia V3 deployment, per Uniswap's own deployment table for chain 84532.
    address constant UNISWAP_V3_FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    address constant WETH9 = 0x4200000000000000000000000000000000000006;

    /// @dev Uniswap's `Quoter`, compiled once from v3-periphery v1.0.0 with solc 0.7.6.
    ///      Regenerate with `quoter/build.sh`; provenance is documented there.
    string constant QUOTER_ARTIFACT = "quoter/Quoter.hex";

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
        require(ok && ret.length >= 96, "Nexus 1.3.1 not deployed");

        // Assert the identity rather than logging it. A pre-flight that reports "Nexus 1.3.1 OK" and
        // then prints an empty id is worse than no pre-flight, because the log line is what a reader
        // trusts. `supportsExecutionMode` cannot be used for this: it returns true on the 1.2.0 build
        // too. See verification-log V-19.
        // `abi.decode`, not a hand-rolled string reader. This file had one, and it was wrong twice
        // over: it read words 0 and 1 as offset and length when word 0 is the `bytes memory` length,
        // and it then pointed `src` at the string's length word rather than its data. Both bugs
        // produced the same symptom -- an empty string and a "successful" pre-flight -- which is the
        // worst possible outcome for the one check that must never lie.
        string memory accountId = abi.decode(ret, (string));
        require(_eq(accountId, EXPECTED_ACCOUNT_ID), "unexpected account build at the pinned address");
        console.log("Nexus accountId:", accountId);

        // And assert the capability that actually matters, rather than inferring it from the address.
        bytes memory code = NEXUS_1_3_1.code;
        require(_contains(code, EXECUTE_COMPOSABLE_SELECTOR), "account cannot run a composable batch");

        vm.startBroadcast(pk);

        FeedGuard feedGuard = new FeedGuard();
        console.log("FeedGuard:        ", address(feedGuard));

        // Uniswap's own `Quoter`, deployed from pinned v3-periphery v1.0.0 bytecode.
        //
        // V-23 established that no third-party address on Base Sepolia implements
        // `quoteExactInputSingle`, so the demo's quoter is deployed here and its address is known
        // before the broadcast rather than discovered afterwards.
        //
        // The bytecode is Uniswap's, not ours: `Quoter` is `solc =0.7.6` and this project is 0.8.23,
        // and recompiling audited source under a different compiler is exactly the sort of quiet
        // change that is hard to notice and worse to ship. So it is compiled once, from the pinned
        // tag, with the settings in `quoter/README.md`, and the artifact is committed.
        address quoter = _deployQuoter(UNISWAP_V3_FACTORY, WETH9);

        // Check the quoter we just deployed against the interface `QuoterGuard` will call, rather
        // than assuming the compiler agreed. The whole V-23 saga was an interface whose parameter
        // order compiled cleanly and dispatched on a selector Uniswap does not use.
        require(
            _contains(quoter.code, IQuoterV2.quoteExactInputSingle.selector),
            "deployed quoter does not answer the interface QuoterGuard calls"
        );
        console.log("Quoter (Uniswap): ", quoter);

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
        console.log("  quoter:         ", quoter, "(Uniswap v1.0.0 bytecode)");
        console.log("  feedGuard:      ", address(feedGuard));
        console.log("  quoterGuard:    ", address(quoterGuard));
        console.log("  failSafe:       ", address(failSafe));
        console.log("  mockOracle:     ", address(mockOracle));
        console.log("");
        console.log("Next: verify feedGuard.isFresh(ETH_USD, 1200) == 1 before using anything.");
    }

    /// @dev Minimal ABI string reader. accountId() returns a dynamic string.
    /**
     * @dev Deploy Uniswap's `Quoter` from the committed pinned-tag bytecode.
     *
     *      `Quoter` takes `(address factory, address weth9)` in its constructor, and a raw
     *      `CREATE` needs those appended to the init code by hand. Done here rather than via a
     *      wrapper contract so the transaction Forge records is the quoter itself, with no throwaway
     *      address in between and nothing to unwind if the assertion below fires.
     */
    function _deployQuoter(address factory, address weth9) private returns (address deployed) {
        bytes memory code = _quoterCreationCode();
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

    /// @dev Creation code from `quoter/Quoter.artifact.json`, built by the command in that dir's README.
    function _quoterCreationCode() private view returns (bytes memory) {
        return vm.parseBytes(vm.readLine(QUOTER_ARTIFACT));
    }

    /// @dev Byte equality for strings. `keccak256` on the raw bytes, so no import is needed.
    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /// @dev Substring search over a hex string, lowercased, for a 4-byte selector.
    function _contains(bytes memory haystack, bytes4 needle) private pure returns (bool) {
        bytes memory n = abi.encodePacked(needle);
        if (n.length > haystack.length) return false;

        // Lowercase both sides. `address.code` is checksummed hex, so a literal selector never
        // matches it without this, and a silently-failing capability check is exactly what this
        // function exists to prevent.
        for (uint256 i; i <= haystack.length - n.length; i++) {
            bool hit = true;
            for (uint256 j; j < n.length; j++) {
                if (_lower(haystack[i + j]) != _lower(n[j])) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }

    function _lower(bytes1 c) private pure returns (bytes1) {
        return (c >= "A" && c <= "F") ? bytes1(uint8(c) + 32) : c;
    }
}
