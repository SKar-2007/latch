// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {EngineAccount} from "../mocks/EngineAccount.sol";
import {IERC20} from "../../contracts/interfaces/IERC20Probe.sol";
import {IComposableExecutionModule, IStorage} from "../../contracts/interfaces/IComposableExecution.sol";
import {IAggregatorV3} from "../../contracts/interfaces/IAggregatorV3.sol";
import {FeedGuard} from "../../contracts/FeedGuard.sol";
import {QuoterGuard} from "../../contracts/QuoterGuard.sol";
import {
    ComposableExecution,
    Constraint,
    ConstraintType,
    InputParam,
    InputParamFetcherType,
    InputParamType,
    OutputParam,
    OutputParamFetcherType
} from "../../contracts/interfaces/IComposabilityTypes.sol";

/// forge-config: default.fuzz.runs = 32

/**
 * @title LiveSmokeTest
 * @notice Layer D. Asserts the claims the blueprint makes about Base Sepolia, against Base Sepolia.
 *
 * @dev Layer C proves the contracts behave. Layer D proves the *document* is true.
 *
 *      Every other layer runs against mocks, so a wrong address in this repository would pass all
 *      124 tests and still fail the demo. That is the specific failure this suite exists to catch,
 *      and it is why several tests here assert things that look like regressions:
 *
 *      - `test_baseSepoliaQuoterIsNotQuoterV2` asserts a *missing* function, which would be a failing
 *        test in any other context. It is here because V-23 is a finding, and a finding that only
 *        lives in prose stops being true the moment someone fixes the code.
 *      - `test_aaveListsWethButNotUsdc` asserts USDC has no Aave market, because that caveat is what
 *        the runbook tells the demo operator to expect.
 *
 *      Nothing here submits a transaction. These are read-only checks plus a fork-local deployment,
 *      so the suite is safe to run against a public endpoint with no credentials.
 *
 *      Skips cleanly when `BASE_SEPOLIA_RPC_URL` is unset.
 */
contract LiveSmokeTest is Test {
    address constant MODULE = 0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7; // V-02
    address constant STORAGE = 0x00008211dea1Aca67ac55fc44AE3bF88CF41281d; // V-03
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // V-09
    address constant WETH = 0x4200000000000000000000000000000000000006;

    // V-06, verified. See docs/appendix/verification-log.md.
    address constant V3_FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    address constant SWAP_ROUTER_02 = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;
    address constant WETH_USDC_3000 = 0x46880b404CD35c165EDdefF7421019F8dD25F4Ad;

    // V-07, verified, with the USDC caveat.
    address constant AAVE_PROVIDER = 0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00;
    address constant AAVE_POOL = 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27;

    // V-23, found.
    address constant LABELLED_QUOTER_V2 = 0xC5290058841028F1614F3A6F0F5816cAd0df5E27;

    address constant FEED = 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1; // K-02

    /// @dev The feed is 40 seconds old at this block, so a 1-hour heartbeat is comfortably fresh
    ///      and a 30-second one is comfortably stale. Both bounds are asserted, not assumed.
    uint256 constant FRESH_HEARTBEAT = 1 hours;
    uint256 constant STALE_HEARTBEAT = 30 seconds;

    EngineAccount internal account;
    FeedGuard internal guard;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            emit log("BASE_SEPOLIA_RPC_URL is unset; skipping the Layer D smoke suite.");
            vm.skip(true);
        }

        vm.createSelectFork(rpc, _block());

        account = new EngineAccount();
        guard = new FeedGuard();
    }

    function _block() internal pure returns (uint256) {
        return 47_590_000;
    }

    // -------------------------------------------------------------------------------------------
    // FeedGuard against the live feed
    // -------------------------------------------------------------------------------------------

    /// @dev Runbook step 1: deploy `FeedGuard`, then confirm code is present.
    function test_deployedGuardHasCode() public view {
        assertGt(address(guard).code.length, 0, "the deployed guard must have code");
    }

    /// @dev Runbook step 2: `isFresh` on ETH/USD returns 1.
    function test_isFreshReturnsOneOnTheLiveEthUsdFeed() public view {
        assertEq(guard.isFresh(FEED, FRESH_HEARTBEAT), 1, "the live feed must be fresh at this block");
    }

    /// @dev The other half of the boundary. Without this, "returns 1" could be a constant.
    function test_isFreshReturnsZeroWhenTheHeartbeatIsTighterThanTheFeedAge() public view {
        assertEq(guard.isFresh(FEED, STALE_HEARTBEAT), 0, "a 30s heartbeat must reject a 40s-old feed");
    }

    /// @dev The guard's verdict must come from the round's own fields, not a guess.
    function test_liveFeedSatisfiesTheGuardsOwnConditions() public view {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            IAggregatorV3(FEED).latestRoundData();

        assertGt(answer, 0, "the feed must report a price");
        assertGe(answeredInRound, roundId, "the round must be answered");
        assertLe(updatedAt, block.timestamp, "the round must not be from the future");
        assertEq(updatedAt, startedAt, "Chainlink reports both timestamps equal here");

        // Pin the numbers this suite depends on. If a rebase of the pinned block changes them, this
        // fails loudly instead of the freshness assertions quietly testing something else.
        assertEq(updatedAt, 1_790_948_248, "pinned block feed timestamp moved");
        assertEq(block.timestamp - updatedAt, 40, "pinned block feed age moved");
    }

    /// @dev `answerIfFresh` must stay one word, because a single SDK constraint reads word 0 only.
    function test_answerIfFreshReturnsExactlyOneWord() public view {
        (bool ok, bytes memory ret) =
            address(guard).staticcall(abi.encodeCall(FeedGuard.answerIfFresh, (FEED, FRESH_HEARTBEAT)));
        assertTrue(ok, "answerIfFresh must not revert on a fresh feed");
        assertEq(ret.length, 32, "a single constraint reads word 0 and nothing else");
    }

    // -------------------------------------------------------------------------------------------
    // Namespacing
    // -------------------------------------------------------------------------------------------

    /// @dev Runbook step: the on-chain slot must match the off-chain computation.
    ///
    ///      This is the check that a client can do cheaply, and it is the one that silently breaks
    ///      if a namespace derivation changes while the docs stay put.
    function test_namespaceMatchesOffChainComputation() public view {
        address caller = address(MODULE);
        bytes32 expected = keccak256(abi.encodePacked(address(account), caller));

        bytes32 onChain = IStorage(STORAGE).getNamespace(address(account), caller);
        assertEq(onChain, expected, "on-chain namespace disagrees with the local derivation");
    }

    // -------------------------------------------------------------------------------------------
    // Engine: a real batch resolves, and a bad bound trips the documented error
    // -------------------------------------------------------------------------------------------

    /// @dev Runbook step: `eth_call` simulate succeeds and resolves to the true balance.
    function test_engineResolvesALiveBatch() public {
        address holder = address(0xB0B);
        uint256 expected = IERC20(USDC).balanceOf(holder);

        account.clearCaptured();
        account.setDispatchReturnData(abi.encode(uint256(0)));

        vm.prank(address(account));
        (bool ok,) = MODULE.call(
            abi.encodeWithSelector(
                IComposableExecutionModule.executeComposableCall.selector, _balanceOf(USDC, holder, new Constraint[](0))
            )
        );

        assertTrue(ok, "a well-formed batch must resolve");
        (,, bytes memory callData,) = account.capturedAt(0);
        assertEq(callData.length, 36, "selector plus one resolved word");
        assertEq(uint256(bytes32(_slice32(callData, 4))), expected, "resolved to the true balance");
    }

    /// @dev Runbook step: simulating with an out-of-band bound fails with `ConstraintNotMet`.
    ///
    ///      This is the whole product in one assertion. A batch that encodes a bound is rejected by
    ///      the engine rather than by the client's own bookkeeping, so the user cannot be shown a
    ///      green tick for a batch that will not execute.
    function test_outOfBandBoundTripsConstraintNotMet() public {
        Constraint[] memory constraints = new Constraint[](1);
        // A bound no account could satisfy. If the engine honoured this, no batch could ever run.
        constraints[0] = Constraint({constraintType: ConstraintType.GTE, referenceData: abi.encode(type(uint256).max)});

        account.clearCaptured();
        account.setDispatchReturnData(abi.encode(uint256(0)));

        vm.prank(address(account));
        (bool ok, bytes memory ret) = MODULE.call(
            abi.encodeWithSelector(
                IComposableExecutionModule.executeComposableCall.selector, _balanceOf(USDC, address(0xB0B), constraints)
            )
        );

        assertFalse(ok, "an unsatisfiable bound must not resolve");
        assertEq(bytes4(ret), IDocumentedErrors.ConstraintNotMet.selector, "wrong failure reason");
    }

    // -------------------------------------------------------------------------------------------
    // Protocol claims in the blueprint
    // -------------------------------------------------------------------------------------------

    /// @dev V-06. The routers are cross-consistent and the pool has real liquidity.
    function test_dexAddressesAreCrossConsistentAndLiquid() public view {
        assertGt(V3_FACTORY.code.length, 0, "factory must have code");
        assertGt(SWAP_ROUTER_02.code.length, 0, "router must have code");

        // The router must point at the factory this suite names, not at some other deployment.
        (bool ok, bytes memory ret) = SWAP_ROUTER_02.staticcall(abi.encodeWithSignature("factory()"));
        assertTrue(ok, "router must expose factory()");
        assertEq(address(uint160(uint256(bytes32(_slice32(ret, 0))))), V3_FACTORY, "router points elsewhere");

        (bool poolOk, bytes memory poolRet) =
            V3_FACTORY.staticcall(abi.encodeWithSignature("getPool(address,address,uint24)", WETH, USDC, uint24(3000)));
        assertTrue(poolOk, "factory must expose getPool");
        assertEq(address(uint160(uint256(bytes32(_slice32(poolRet, 0))))), WETH_USDC_3000, "pool address moved");
        (bool liqOk, bytes memory liq) = WETH_USDC_3000.staticcall(abi.encodeWithSignature("liquidity()"));
        assertTrue(liqOk, "pool must expose liquidity()");
        assertGt(uint256(bytes32(_slice32(liq, 0))), 0, "the pool must have liquidity for the demo swap");
    }

    /// @dev V-07. Aave is live on Base Sepolia and the provider agrees with the pool.
    function test_aavePoolIsLiveAndProviderAgrees() public view {
        assertGt(AAVE_PROVIDER.code.length, 0, "provider must have code");
        assertGt(AAVE_POOL.code.length, 0, "pool must have code");

        (bool ok, bytes memory ret) = AAVE_PROVIDER.staticcall(abi.encodeWithSignature("getPool()"));
        assertTrue(ok, "provider must expose getPool()");
        assertEq(address(uint160(uint256(bytes32(_slice32(ret, 0))))), AAVE_POOL, "provider points elsewhere");
    }

    /**
     * @dev V-07's caveat, asserted so it cannot quietly become false.
     *
     *      The runbook tells the demo operator to supply WETH. That instruction is only correct
     *      while USDC has no Aave market on this chain, so the suite checks the premise.
     */
    function test_aaveListsWethButNotUsdc() public view {
        _assertIsAaveMarket(WETH, true, "WETH");
        _assertIsAaveMarket(USDC, false, "USDC");
    }

    /**
     * @dev V-23, asserted so the finding stays true.
     *
     *      If this test starts failing, someone deployed a real `QuoterV2` at the documented address
     *      and `QuoterGuard` can be pointed at live liquidity. That is good news, and it is exactly
     *      when this assertion should be deleted.
     */
    function test_baseSepoliaQuoterIsNotQuoterV2() public view {
        bytes memory code = LABELLED_QUOTER_V2.code;
        bytes4 v2Sig = IQuoterV2Probe.quoteExactInputSingle.selector;

        bool present;
        for (uint256 i = 0; i + 32 <= code.length; i++) {
            if (bytes4(_slice32(code, i)) == v2Sig) {
                present = true;
                break;
            }
        }

        assertFalse(
            present, "the documented QuoterV2 now implements the interface; drop this test and unblock the demo"
        );
    }

    /// @dev The practical consequence of V-23: the guard cannot read Base Sepolia liquidity today.
    function test_quoterGuardCannotUseTheBaseSepoliaQuoterYet() public {
        QuoterGuard qg = new QuoterGuard();

        vm.expectRevert();
        qg.minAmountOut(LABELLED_QUOTER_V2, WETH, USDC, 1e18, 3000, 50);
    }

    // -------------------------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------------------------

    /**
     * @dev Is `asset` in the Pool's `getReservesList()`?
     *
     *      Membership in that list is the definition of "is a market", and it is the list the runbook
     *      quotes. An earlier version probed `getReserveConfigurationMap`, which is a mapping getter
     *      and therefore reverts for an unlisted asset *and* gave a misleading answer for a listed
     *      one, so it could not distinguish the two cases this test exists to separate.
     */
    function _isAaveMarket(address asset) private view returns (bool) {
        (bool ok, bytes memory ret) = AAVE_POOL.staticcall(abi.encodeWithSignature("getReservesList()"));
        require(ok && ret.length >= 64, "getReservesList() must be readable");

        // A dynamic `address[]` is encoded as [offset][length][elements...]. Reading word 0 as the
        // length reads the *offset* instead, which reported 32 markets where there are 6.
        uint256 offset = uint256(bytes32(_slice32(ret, 0)));
        require(offset + 32 <= ret.length, "getReservesList() offset out of range");

        uint256 n = uint256(bytes32(_slice32(ret, offset)));
        require(n <= (ret.length - offset - 32) / 32, "getReservesList() returned an implausible length");

        for (uint256 i = 0; i < n; i++) {
            uint256 at = offset + 32 + i * 32;
            if (address(uint160(uint256(bytes32(_slice32(ret, at))))) == asset) return true;
        }
        return false;
    }

    function _assertIsAaveMarket(address asset, bool expected, string memory label) private view {
        assertEq(_isAaveMarket(asset), expected, string.concat(label, " reserve presence changed; update the runbook"));
    }

    function _balanceOf(address token, address holder, Constraint[] memory constraints)
        private
        pure
        returns (ComposableExecution[] memory entries)
    {
        InputParam[] memory params = new InputParam[](2);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.BALANCE,
            paramData: abi.encodePacked(token, holder), // exactly 40 bytes
            constraints: constraints
        });
        params[1] = InputParam({
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(address(0xdead)),
            constraints: new Constraint[](0)
        });

        entries = new ComposableExecution[](1);
        entries[0] = ComposableExecution(bytes4(0), params, new OutputParam[](0));
    }

    function _slice32(bytes memory b, uint256 start) private pure returns (bytes memory out) {
        out = new bytes(32);
        for (uint256 i = 0; i < 32; i++) {
            out[i] = b[start + i];
        }
    }
}

/// @dev Minimal local declarations, so this file asserts the interface rather than a mock of it.
interface IDocumentedErrors {
    error ConstraintNotMet(ConstraintType constraintType);
}

interface IQuoterV2Probe {
    function quoteExactInputSingle(address, address, uint24, uint256, uint160)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}
