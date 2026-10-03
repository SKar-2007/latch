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
    // A fresh salt per run. Nexus accounts are CREATE2: a salt reused with different init data does not
    // redeploy, it silently returns the address it already used, and the account stays uninitialized.
    // An earlier probe also consumed the K1 validator's one-shot `onInstall` through an `eth_call`,
    // after which every subsequent call returned `ModuleAlreadyInitialized()`.
    // Salted per block. A failed initialization still leaves the proxy deployed, and CREATE2 will not
    // redeploy at the same salt -- it returns the existing address untouched. A fixed salt would make
    // the second run silently test a half-built account.
    bytes32 salt = keccak256(abi.encodePacked("latch-nexus", block.number));

    /// @dev ERC-4337 EntryPoint v0.7, as Nexus exposes it.
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

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
     *      The composability module is installed separately, after creation, via the account's own
     *      `installModule(uint256,address,bytes)` (`0x9517e29f`). Its module type was checked on-chain
     *      rather than assumed: it answers `isModuleType(2)` and `isModuleType(3)` true and false for 1
     *      and 4-7, so it is both an executor and a fallback handler. The fallback registration is the
     *      part that matters for execution -- see `_moduleAsFallback`.
     */
    function _bootstrapCall() private view returns (bytes memory) {
        // Validators: the account must satisfy `isInitialized()`, which is true when the default
        // validator holds an owner OR the sentinel lists are set. Installing the K1 validator as a
        // validator is impossible -- it *is* the default -- so `initNexusWithDefaultValidator(bytes)`
        // is the call that gives it an owner. It takes only that one argument, which is why the
        // multi-list entry points cannot reach it.
        // `initNexusWithDefaultValidatorAndOtherModulesNoRegistry` -- one call that does both halves:
        // gives the default (K1) validator an owner, which is what makes `isInitialized()` true, and
        // installs the composability module as an executor.
        //
        // Three earlier attempts, each informative:
        //   `initNexusWithSingleValidatorNoRegistry` -> `DefaultValidatorAlreadyInstalled()`
        //     (0xabc3af79). K1 *is* the default validator, so it cannot also be installed as one.
        //   `initNexusWithDefaultValidator` -> `MissingFallbackHandler(0x0)`, then
        //     `NexusInitializationFailed()`. It builds a zero `RegistryConfig`, and the
        //     `withRegistry` modifier on the validator install demands a registry.
        //   bare bootstrap calldata -> `AccountNotInitialized()` with an empty inner trace, because
        //     `_initializeAccount` expects `[bootstrap][offset][length][calldata]`, not the call itself.
        BootstrapConfig[] memory validators = new BootstrapConfig[](0);
        BootstrapConfig[] memory executors = new BootstrapConfig[](1);
        executors[0] = BootstrapConfig({module: COMPOSABILITY_MODULE, data: ""});

        bytes memory call_ = abi.encodeWithSelector(
            bytes4(0x41bede03), // initNexusWithDefaultValidatorAndOtherModulesNoRegistry
            abi.encodePacked(bytes20(owner)), // default validator init data
            validators,
            executors,
            BootstrapConfig({module: address(0), data: ""}), // hook
            new BootstrapConfig[](0), // fallbacks
            new PreValidationHook[](0)
        );

        // `Nexus._initializeAccount` does not take a bare bootstrap call. It reads, by hand:
        //
        //     bootstrap          := calldataload(initData.offset)
        //     s                  := calldataload(initData.offset + 0x20)
        //     bootstrapCall.off  := initData.offset + s + 0x20
        //     bootstrapCall.len  := calldataload(initData.offset + s)
        //
        // so `initData` must be `[bootstrap][offset][length][calldata]`. Passing just the calldata
        // makes `bootstrap` read as the selector 0x31025984, the offset as the owner word, and the
        // delegatecall lands on nothing. That produced `AccountNotInitialized()` with an empty inner
        // trace: the account deployed, the bootstrap never ran, and the only visible error was the
        // post-condition failing.
        return abi.encode(BOOTSTRAP, uint256(0x40), uint256(call_.length), call_);
    }

    /**
     * @dev Install the composability module as the account's FALLBACK handler for its own selector.
     *
     *      `ModuleManager._installFallbackHandler` takes `params = selector ‖ callType ‖ initData`, and
     *      `ModuleManager._fallback` then routes any call to the account bearing that selector to the
     *      module, wrapping the calldata per ERC-2771. The module's own comment names the path:
     *      `account.executeComposableCall => fallback() => this.executeComposableCall`.
     *
     *      So the batch goes to the ACCOUNT, not to the module. Calling the module directly makes
     *      `msg.sender` inside `_executeComposable` the EOA rather than the account, which is the
     *      likeliest real content of V-24: not a codeless caller but a missing fallback registration,
     *      and a batch that reports success while operating on the wrong account.
     */
    function _installComposableModule() private {
        bytes memory params = abi.encodePacked(
            bytes4(0xdcb108bf), // executeComposableCall
            bytes1(0x01), // CALLTYPE_SINGLE
            bytes20(ENTRYPOINT) // module onInstall data: the entry point it will serve
        );

        vm.prank(address(account));
        (bool ok, bytes memory ret) = account.call(
            abi.encodeWithSignature("installModule(uint256,address,bytes)", uint256(3), COMPOSABILITY_MODULE, params)
        );
        emit log_named_string("installModule(fallback)", ok ? "ok" : "reverted");
        if (!ok && ret.length >= 4) emit log_named_bytes("error", _first4(ret));
    }

    /// @dev The demo's step 3, as LATCH's own types encode it.
    function _approveStep() private pure returns (ComposableExecution[] memory batch) {
        batch = new ComposableExecution[](1);

        InputParam[] memory inputs = new InputParam[](2);
        inputs[0] = _raw(InputParamType.TARGET, abi.encode(USDC));
        inputs[1] = _raw(
            InputParamType.CALL_DATA, abi.encodeWithSignature("approve(address,uint256)", SWAP_ROUTER, 15_000_000)
        );

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
        (bool ok, bytes memory ret) =
            FACTORY.call{value: 0}(abi.encodeWithSignature("createAccount(bytes,bytes32)", _bootstrapCall(), salt));
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

    /**
     * @dev Create the account. Reports rather than asserts: V-04 is still open, and a test that
     *      asserted success would encode a hope rather than a finding.
     *
     *      The proxy IS deployed and `computeAccountAddress` predicts it correctly, but
     *      initialization reverts, so `createAccount` reverts and rolls the deployment back. Known
     *      blockers, in the order they were hit:
     *
     *        1. `DefaultValidatorAlreadyInstalled()` -- K1 *is* the account's default validator, so it
     *           cannot also be installed as a validator.
     *        2. `MissingFallbackHandler(0x0)` -> `NexusInitializationFailed()` -- the bootstrap's
     *           default-validator path builds a zero `RegistryConfig` and `withRegistry` wants one.
     *        3. The deployed bootstrap's dispatcher does not contain the selectors that `main`'s source
     *           implies. The variant named `initNexusWithDefaultValidatorAndOtherModulesNoRegistry` computes to
     *           `0x41bede03` and falls through to the fallback, whereas `initNexusWithSingleValidator`
     *           (`0x6d583e36`) resolves to a real function. The deployed contract is an older build
     *           than the published source, so source-derived selectors cannot be trusted for it -- which is the
     *           same false-negative shape as V-19 and V-23, one level up.
     *
     *      So the selector set of the *deployed* bootstrap has to come from its verified ABI, not from
     *      the repository default branch.
     */
    function test_createTheAccount() public onlyFork {
        _createQuietly();
        emit log_named_address("created account", account);
        emit log_named_uint("account code length", account == address(0) ? 0 : account.code.length);
        emit log_named_string(
            "account accountId()", account == address(0) ? "<none>" : _stringCall(account, "accountId()")
        );
        emit log_named_string("initialization", account == address(0) ? "FAILED -- V-04 still open" : "succeeded");
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
        emit log_named_address(
            "K1 getOwner(account)", _addressCall(K1_VALIDATOR, abi.encodeWithSignature("getOwner(address)", account))
        );

        deal(USDC, account, 15_000_000);

        _installComposableModule();

        // The batch goes to the ACCOUNT. `ModuleManager._fallback` routes any selector registered to a
        // fallback handler, wrapping the calldata per ERC-2771 on the way. Calling the module directly
        // would make `msg.sender` the EOA inside `_executeComposable`, not the account.
        ComposableExecution[] memory batch = _approveStep();
        vm.prank(owner);
        (bool ok, bytes memory ret) = account.call(abi.encodeWithSelector(bytes4(0xdcb108bf), batch));

        emit log_named_string("account.executeComposableCall", ok ? "ok" : "reverted");
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

