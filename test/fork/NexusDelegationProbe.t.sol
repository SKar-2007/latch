// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {IComposableExecution, IComposableExecutionModule} from "../../contracts/interfaces/IComposableExecution.sol";
import {ComposableExecution} from "../../contracts/interfaces/IComposabilityTypes.sol";

/**
 * @title NexusDelegationProbe
 * @notice Establishes what EIP-7702 delegation to the Nexus 1.3.1 account actually buys us.
 *
 * @dev V-24's recorded cause is "the module will not execute composed calls for a codeless caller",
 *      and the recorded fix is "needs a deployed account". The verification log describes
 *      `0x0000000020fe2F30453074aD916eDeB653eC7E9D` as "the EIP-7702 delegation target" without ever
 *      demonstrating that delegation reaches it. This does.
 *
 *      What the fork establishes, all of it measured:
 *
 *        - Delegation works. The EOA runs the Nexus runtime and `accountId()` answers
 *          `biconomy.nexus.1.3.1`, the build V-04 verified.
 *        - A delegated EOA is not codeless. Its code is a 23-byte `0xef0100||address` designator.
 *        - Delegation is nevertheless NOT sufficient. The account refuses `executeComposable` with
 *          `AccountAccessUnauthorized()`, and the approve step reaches `InvalidModule(address(0))`
 *          from the account itself. The composability module is not installed on that account, and it
 *          is not ours to install into.
 *
 *      So V-04 needs an account we own, with the module installed. Delegation tells us how the demo's
 *      account will *execute*; it does not tell us how to *obtain* one.
 *
 *      Uses a throwaway key. Never the deployer's.
 */
contract NexusDelegationProbeTest is Test {
    address constant NEXUS_1_3_1 = 0x0000000020fe2F30453074aD916eDeB653eC7E9D;
    address constant COMPOSABILITY_MODULE = 0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7;

    /// @dev Throwaway. Not the deployer, not funded on any real chain.
    uint256 constant PK = 0xA11CE;

    address delegatee;
    bool private forkActive;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forkActive = true;
        delegatee = vm.addr(PK);
    }

    modifier onlyFork() {
        if (!forkActive) {
            emit log("no BASE_SEPOLIA_RPC_URL, skipping delegation probe");
            return;
        }
        _;
    }

    /// @dev The V-24 precondition: before delegating, the caller is codeless.
    function test_theCallerIsCodelessBeforeDelegating() public onlyFork {
        assertEq(delegatee.code.length, 0, "an undelegated EOA has no code");
    }

    /**
     * @dev Delegation gives the EOA a designator, not a copy of the code.
     *
     *      Recorded because it reads as a failure if you expect `code.length` to equal the
     *      implementation's. It does not: `0xef0100 || address`, 23 bytes, and the account's runtime
     *      runs on call.
     */
    function test_delegationIsADesignatorNotACopy() public onlyFork {
        vm.signAndAttachDelegation(NEXUS_1_3_1, PK);

        bytes memory code = delegatee.code;
        assertEq(code.length, 23, "a delegated EOA carries a 23-byte designator");
        assertEq(uint256(uint8(code[0])), 0xef, "designator prefix is 0xef");
        assertEq(uint256(uint8(code[1])), 0x01, "designator version is 0x01");

        address impl = _addrBigEndian(code, 3);
        emit log_named_address("designator points at", impl);
        assertEq(impl, NEXUS_1_3_1, "designator must name the Nexus runtime");
    }

    /// @dev The load-bearing result: the delegated EOA really is running the verified Nexus build.
    function test_delegatedCallerReportsTheNexusAccountId() public onlyFork {
        vm.signAndAttachDelegation(NEXUS_1_3_1, PK);

        vm.prank(delegatee);
        (bool ok, bytes memory ret) = delegatee.staticcall(abi.encodeWithSignature("accountId()"));
        assertTrue(ok, "delegated account must answer accountId()");

        string memory id = abi.decode(ret, (string));
        emit log_named_string("accountId()", id);
        assertEq(id, "biconomy.nexus.1.3.1", "delegated runtime must be the build V-04 verified");
    }

    /**
     * @dev And the reason delegation is not the whole answer.
     *
     *      `AccountAccessUnauthorized()`, selector `0xac52ccbe`, resolved against Biconomy's published
     *      Nexus error list rather than guessed. Guessing at error selectors has already produced
     *      several wrong turns in this project.
     */
    function test_accountRefusesExecuteComposableWithAccountAccessUnauthorized() public onlyFork {
        vm.signAndAttachDelegation(NEXUS_1_3_1, PK);

        ComposableExecution[] memory empty = new ComposableExecution[](0);

        vm.prank(delegatee);
        (bool ok, bytes memory ret) =
            delegatee.call(abi.encodeWithSelector(IComposableExecution.executeComposable.selector, empty));

        assertFalse(ok, "expected the account to refuse");
        assertEq(bytes4(_first4(ret)), bytes4(keccak256("AccountAccessUnauthorized()")), "unexpected error selector");
        emit log_named_bytes("error", _first4(ret));
    }

    /**
     * @dev The module surface, as observed from a delegated caller. Reported, not asserted.
     *
     *      `executeComposableCall` is the entry point the demo uses. Reverting here is consistent with
     *      the module refusing the caller for want of an installed module, which is what the approve-step
     *      probe in `DemoBatch.t.sol` then confirms by name.
     */
    function test_moduleEntryPointFromADelegatedCaller() public onlyFork {
        vm.signAndAttachDelegation(NEXUS_1_3_1, PK);

        ComposableExecution[] memory batch = new ComposableExecution[](0);
        bytes memory data = abi.encodeWithSelector(IComposableExecutionModule.executeComposableCall.selector, batch);

        vm.prank(delegatee);
        (bool ok,) = COMPOSABILITY_MODULE.call(data);

        emit log_named_string("module.executeComposableCall([])", ok ? "accepted" : "reverted");
        emit log_named_address("composability module", COMPOSABILITY_MODULE);
        emit log_named_uint("module code length", COMPOSABILITY_MODULE.code.length);
    }

    /**
     * @dev A call to an address with no code trivially succeeds.
     *
     *      Kept because an earlier version of this probe used exactly that as its control and read the
     *      vacuous success as "the codeless path is fine". It measures nothing.
     */
    function test_codelessCallSucceedsTriviallyAndMeansNothing() public onlyFork {
        address plain = vm.addr(0xB0B);
        (bool ok,) = plain.call(abi.encodeWithSelector(IComposableExecution.executeComposable.selector));

        assertEq(plain.code.length, 0, "no code, so nothing can fail");
        emit log_named_string("raw call to codeless address", ok ? "succeeds -- vacuously" : "reverts");
    }

    /**
     * @dev Read `n` bytes at `from` as the least significant bytes of a uint160.
     *
     *      Revert data for an error taking one address is 36 bytes: a 4-byte selector then a 32-byte
     *      word whose leading 28 bytes are zero padding. That padding is not present in the returndata,
     *      so the address occupies only the final 4 bytes and reading a full word runs off the end.
     */
    function _lowBytes(bytes memory b, uint256 from, uint256 n) private pure returns (uint160 out) {
        require(from + n <= b.length, "read past end of returndata");
        for (uint256 i; i < n; ++i) {
            out |= uint160(uint8(b[from + i])) << (8 * i);
        }
    }

    /**
     * @dev Read 20 bytes at `from` as a left-aligned address.
     *
     *      Two different byte orders in one file, deliberately. A delegation designator stores the
     *      address left-aligned in its final 20 bytes, so it is read big-endian. Revert data stores an
     *      address right-aligned in a 32-byte word, so it is read little-endian by `_lowBytes`. Using
     *      the same helper for both produced `0x9d7eec53b6DE6E91ad743045302ffe2000000000`, which is the
     *      correct address byte-reversed.
     */
    function _addrBigEndian(bytes memory b, uint256 from) private pure returns (address out) {
        require(from + 20 <= b.length, "read past end of designator");
        uint160 v;
        for (uint256 i; i < 20; ++i) {
            v |= uint160(uint8(b[from + i])) << (8 * (19 - i));
        }
        return address(v);
    }

    function _first4(bytes memory b) private pure returns (bytes memory out) {
        out = new bytes(4);
        for (uint256 i; i < 4; ++i) {
            out[i] = b[i];
        }
    }
}
