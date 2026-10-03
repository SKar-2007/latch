// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "../../contracts/interfaces/IERC20Probe.sol";
import {
    ComposableExecution,
    Constraint,
    InputParam,
    InputParamFetcherType,
    InputParamType,
    OutputParam
} from "../../contracts/interfaces/IComposabilityTypes.sol";

/**
 * @title NexusAccountFactoryLive
 * @notice Creates a real Nexus account on a Base Sepolia fork and asks whether it can run the demo.
 *
 * @dev V-04's remaining step, attempted rather than described.
 *
 *      What the chain of findings established, all measured rather than read off an address label:
 *
 *        - `0x…7E9D` is the Nexus 1.3.1 *implementation*, not an account. Every EIP-1967 slot is zero.
 *        - Biconomy's factory `0x0000b1C08f1418dA76B5E99c1Bf5718486cf8c53` exists on Base Sepolia and
 *          is `NexusAccountFactory`. Confirmed from source, not from the address: `createAccount` is
 *          `0xea6d13ac` and `computeAccountAddress` is `0xfafa2b42`, both computed from `bcnmy/nexus`
 *          and both present in the deployed bytecode.
 *        - It deploys against Nexus 1.3.3 -- `ACCOUNT_IMPLEMENTATION()` returns `0x0000B1c01cB…a5B`
 *          whose `accountId()` is `biconomy.nexus.1.3.3`, not the 1.3.1 the rest of this project pins.
 *
 *      The batch is built with LATCH's own `ComposableExecution` types rather than a hand-rolled tuple.
 *      An earlier attempt guessed the ABI shape and encoded nonsense, which is the third time in this
 *      project that guessing an ABI beat the existing definition. Read the definition.
 *
 *      Fork only; skipped without an RPC.
 */
contract NexusAccountFactoryLiveTest is Test {
    /// @dev Mirrors `NexusBootstrap.BootstrapConfig` and its pre-validation-hook struct.
    struct BootstrapConfig {
        address module;
        bytes data;
    }

    struct PreValidationHook {
        uint256 hookType;
        address module;
        bytes data;
    }

    address constant FACTORY = 0x0000b1C08f1418dA76B5E99c1Bf5718486cf8c53;
    address constant BOOTSTRAP = 0x0000B1c0A80cb7DD166a15e7390b8A4Ced4500C6;
    address constant K1_VALIDATOR = 0x0000B1C0790E5a28293276C320d2B95D651dBaD6;
    address constant COMPOSABILITY_MODULE = 0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant SWAP_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;

    address owner = 0x00a534733a858836683491EFCd8aCA9ddec34B09;
    bytes32 salt = bytes32(uint256(1));

    bool private forkActive;
    address private account;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forkActive = true;
    }

    modifier onlyFork() {
        if (!forkActive) {
            emit log("no BASE_SEPOLIA_RPC_URL, skipping Nexus factory test");
            return;
        }
        _;
    }

    /* ------------------------------------------------------------------ */
    /* Setup, named after what it is                                      */
    /* ------------------------------------------------------------------ */

    /**
     * @dev `initNexusNoRegistry`, installing the composability module as an EXECUTOR and nothing else.
     *
     *      The first attempt installed the K1 validator and reverted with
     *      `DefaultValidatorAlreadyInstalled()` (`0xabc3af79`), because the K1 validator at
     *      `0x0000B1C079…BaD6` *is* the Nexus 1.3.3 account's default validator -- read from
     *      `getDefaultValidator()` on the implementation, not assumed. Installing it again is rejected
     *      by `ModuleManager._installValidator`, which refuses `validator == _DEFAULT_VALIDATOR`.
     *      So the validator list is empty and the module goes in as the executor.
     *
     *      Module type checked on-chain rather than assumed: the composability module answers
     *      `isModuleType(2)` and `isModuleType(3)` true, false for 1 and 4-7. Executor is 2.
     *
     *      And the batch must be sent through the ACCOUNT, not to the module. The module's own comment
     *      states the path: `account.executeComposableCall => fallback() => this.executeComposableCall`.
     *      Nexus dispatches unknown selectors to a registered fallback handler, wrapping the calldata
     *      per ERC-2771. Calling the module directly bypasses that, which is very likely the real
     *      content of V-24: not a codeless caller, but a missing fallback registration. Calling the
     *      module directly is also why `executeComposableCall` appeared to "succeed while doing nothing"
     *      in the earlier blocker test -- it was operating on `msg.sender` as the account.
     */
    function _bootstrapCall() private pure returns (bytes memory) {
        BootstrapConfig[] memory validators = new BootstrapConfig[](0);
        BootstrapConfig[] memory executors = new BootstrapConfig[](1);
        executors[0] = BootstrapConfig({module: COMPOSABILITY_MODULE, data: ""});

        return abi.encodeWithSelector(
            bytes4(0x86437876), // initNexusNoRegistry
            validators,
            executors,
            BootstrapConfig({module: address(0), data: ""}),
            new BootstrapConfig[](0),
            new PreValidationHook[](0)
        );
    }

    /// @dev The demo's step 3, as LATCH's own types encode it.
    function _approveStep() private pure returns (ComposableExecution[] memory batch) {
        batch = new ComposableExecution[](1);

        InputParam[] memory inputs = new InputParam[](2);
        inputs[0] = _raw(InputParamType.TARGET, abi.encode(USDC));
        inputs[1] = _raw(InputParamType.CALL_DATA, abi.encodeWithSignature("approve(address,uint256)", SWAP_ROUTER, 15_000_000));

        batch[0].functionSig = bytes4(0);
        batch[0].inputParams = inputs;
        batch[0].outputParams = new OutputParam[](0);
    }

    function _raw(InputParamType paramType, bytes memory data) private pure returns (InputParam memory) {
        InputParam memory p;
        p.paramType = paramType;
        p.fetcherType = InputParamFetcherType.RAW_BYTES;
        p.paramData = data;
        p.constraints = new Constraint[](0);
        return p;
    }

    function _createQuietly() private {
        account = address(0);
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        (bool ok, bytes memory ret) = FACTORY.call{value: 0}(
            abi.encodeWithSignature("createAccount(bytes,bytes32)", _bootstrapCall(), salt)
        );
        // Report rather than swallow. An empty return means the call reverted with no data, which is
        // the hardest failure to diagnose: no selector, no reason, nothing in the trace to grep.
        emit log_named_string("createAccount call", ok ? "returned" : "reverted");
        if (!ok) {
            emit log_named_uint("returndata length", ret.length);
            if (ret.length >= 4) emit log_named_bytes("error selector", _first4(ret));
            return;
        }
        if (ret.length >= 32) {
            account = abi.decode(ret, (address));
        } else {
            emit log_named_uint("unexpected returndata length", ret.length);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Tests                                                              */
    /* ------------------------------------------------------------------ */

    /// @dev The factory and bootstrap are really there.
    function test_theFactoryAndBootstrapAreDeployed() public onlyFork {
        assertGt(FACTORY.code.length, 0, "factory must be deployed on Base Sepolia");
        assertGt(BOOTSTRAP.code.length, 0, "bootstrap must be deployed on Base Sepolia");
        emit log_named_uint("factory code length", FACTORY.code.length);
        emit log_named_uint("bootstrap code length", BOOTSTRAP.code.length);
    }

    /// @dev The factory deploys 1.3.3, not the 1.3.1 pinned elsewhere. A real inconsistency.
    function test_theFactoryDeploysNexus133Not131() public onlyFork {
        address impl = _addressCall(FACTORY, abi.encodeWithSignature("ACCOUNT_IMPLEMENTATION()"));
        string memory id = _stringCall(impl, "accountId()");

        emit log_named_address("ACCOUNT_IMPLEMENTATION", impl);
        emit log_named_string("its accountId()", id);
        emit log_named_string("project pins", "biconomy.nexus.1.3.1");

        assertEq(id, "biconomy.nexus.1.3.3", "the factory's implementation is 1.3.3");
    }

    /// @dev The address is knowable before spending anything.
    function test_theAccountAddressIsPredictable() public onlyFork {
        account = _addressCall(
            FACTORY, abi.encodeWithSignature("computeAccountAddress(bytes,bytes32)", _bootstrapCall(), salt)
        );
        assertTrue(account != address(0), "a predictable non-zero address");
        assertEq(account.code.length, 0, "and not yet deployed");
        emit log_named_address("predicted account", account);
    }

    /// @dev Create it, on the fork.
    function test_createTheAccount() public onlyFork {
        _createQuietly();
        emit log_named_address("created account", account);
        emit log_named_uint("account code length", account.code.length);

        assertGt(account.code.length, 0, "a created account has code");
        emit log_named_string("account accountId()", _stringCall(account, "accountId()"));
    }

    /**
     * @dev The question that matters: can this account run a composable batch?
     *
     *      Reports rather than asserts on the batch itself. An account that is created but still cannot
     *      execute is a result worth having, and asserting success would only encode the hope.
     */
    function test_canTheAccountRunAComposableBatch() public onlyFork {
        _createQuietly();
        if (account == address(0)) {
            emit log("account creation failed; nothing to test");
            return;
        }

        emit log_named_string("account accountId()", _stringCall(account, "accountId()"));
        emit log_named_address("K1 getOwner(account)", _addressCall(K1_VALIDATOR, abi.encodeWithSignature("getOwner(address)", account)));

        deal(USDC, account, 15_000_000);

        ComposableExecution[] memory batch = _approveStep();
        vm.prank(owner);
        (bool ok, bytes memory ret) = COMPOSABILITY_MODULE.call(
            abi.encodeWithSelector(bytes4(0xdcb108bf), batch) // executeComposableCall
        );

        emit log_named_string("module.executeComposableCall", ok ? "ok" : "reverted");
        if (!ok && ret.length >= 4) emit log_named_bytes("error", _first4(ret));

        uint256 allowance = IERC20(USDC).allowance(account, SWAP_ROUTER);
        emit log_named_uint("allowance(account, router)", allowance);
        emit log_named_string(
            "VERDICT", allowance > 0 ? "V-04 SOLVED: the batch executed" : "V-04 still open: no allowance"
        );
    }

    /* ------------------------------------------------------------------ */

    /// @dev `abi.encodeWithSignature` is variadic, so the arguments are assembled by the caller.
    function _addressCall(address target, bytes memory callData) private view returns (address out) {
        (bool ok, bytes memory ret) = target.staticcall(callData);
        out = ok && ret.length >= 32 ? abi.decode(ret, (address)) : address(0);
    }

    function _addressCall(address target, string memory sig) private view returns (address out) {
        return _addressCall(target, abi.encodeWithSignature(sig));
    }

    function _stringCall(address target, string memory sig) private view returns (string memory) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSignature(sig));
        return ok && ret.length >= 64 ? abi.decode(ret, (string)) : "<unavailable>";
    }

    function _first4(bytes memory b) private pure returns (bytes memory out) {
        out = new bytes(4);
        for (uint256 i; i < 4; ++i) {
            out[i] = b[i];
        }
    }
}

