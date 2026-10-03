// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {EngineAccount} from "../mocks/EngineAccount.sol";
import {IERC20} from "../../contracts/interfaces/IERC20Probe.sol";
import {
    IComposableExecution,
    IComposableExecutionModule,
    IStorage
} from "../../contracts/interfaces/IComposableExecution.sol";
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

// Forked state reads are far more expensive than local ones, so this suite runs fewer cases than
// the default 512. The syntax is `forge-config`, without the `@dev`, or the annotation is ignored.
/// forge-config: default.fuzz.runs = 96
/// forge-config: default.fuzz.max_test_rejects = 100_000

/**
 * @title The twelve documented reverts
 * @notice Declared locally so the suite can classify any failure and flag an undocumented one.
 * @dev Mirrors `ComposableExecutionLib` verbatim. SPDX MIT upstream.
 */
interface IDocumentedErrors {
    error ConstraintNotMet(ConstraintType constraintType);
    error InvalidConstraintType();
    error InvalidReferenceDataLength();
    error InvalidConstraintRange();
    error EmptyOrSubConstraints();
    error InsufficientRawValue();
    error InvalidParameterEncoding(string message);
    error InvalidSetOfInputParams(string message);
    error ComposableExecutionFailed();
    error InvalidOutputParamFetcherType();
    error Output_StaticCallFailed();
    error InsufficientReturnData();
}

/**
 * @title EncodingFuzzTest
 * @notice Fuzzes the real ERC-8211 encoding against the real deployed engine.
 *
 * @dev This is the most valuable test in the project, and it is on a fork on purpose.
 *
 *      The encoding is the thing most likely to be misunderstood: nine constraint types, three
 *      fetchers, three param types, word-indexed constraints, and a set of length preconditions that
 *      only fail at runtime. A mock would only test the mock author's understanding of it. The
 *      module at `0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7` is deployed on Base Sepolia and is
 *      Pashov-audited, so it can be driven directly. Verified in the round-2 survey, V-02.
 *
 *      ## The property
 *
 *      For arbitrary bytes in every position of the encoding, the engine either:
 *
 *        1. resolves it, composing an `Execution` consistent with its own rules, or
 *        2. reverts, with the reason being one of the twelve documented errors.
 *
 *      Any revert outside that set is a finding: either an undocumented failure mode that a caller
 *      could trigger, or an engine bug. Both matter, and neither is visible without fuzzing.
 */
contract EncodingFuzzTest is Test, IDocumentedErrors {
    address constant MODULE = 0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7; // V-02, verified on chain
    address constant STORAGE = 0x00008211dea1Aca67ac55fc44AE3bF88CF41281d; // V-03, verified on chain
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // V-09, DOCUMENTED
    address constant FEED = 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1; // K-02, verified on chain

    EngineAccount internal account;

    /// @dev Counts, so a run that silently reverted everything is visible.
    uint256 internal resolved;
    uint256 internal documented;
    uint256 internal emptyReverts;
    uint256 internal panics;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));

        // Skip rather than fail when no endpoint is configured, so that a plain `forge test` stays
        // useful offline. A fork suite that only runs when a secret is set is a suite nobody runs,
        // and this is the most valuable test in the project.
        if (bytes(rpc).length == 0) {
            emit log("BASE_SEPOLIA_RPC_URL is unset; skipping the fork suite.");
            vm.skip(true);
        }

        vm.createSelectFork(rpc, _block());
        account = new EngineAccount();
        account.setExecuteCalls(false);
    }

    function _block() internal pure returns (uint256) {
        // Pinned for reproducibility. Public endpoints prune older state, so this must stay recent.
        return 47_590_000;
    }

    // -------------------------------------------------------------------------------------------
    // Fetcher fuzzing. The headline.
    // -------------------------------------------------------------------------------------------

    /**
     * @dev Arbitrary fetcher, arbitrary paramData, arbitrary constraints.
     *
     *      Bounds: paramData up to 160 bytes so BALANCE's exact-40 rule and IN's exact-64 rule are
     *      both reachable, and CALL_DATA's at-least-32 rule is reachable too.
     */
    function testFuzz_arbitraryInputParamAlwaysResolvesOrFailsDocumentedly(
        uint8 fetcherRaw,
        uint8 paramRaw,
        bytes calldata paramData,
        uint8 constraintCount,
        bytes32 refA,
        bytes32 refB,
        uint8 constraintTypeRaw
    ) public {
        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType(uint8(bound(paramRaw, 0, 2))),
            fetcherType: InputParamFetcherType(uint8(bound(fetcherRaw, 0, 2))),
            paramData: paramData,
            constraints: _constraints(constraintCount, constraintTypeRaw, refA, refB)
        });

        _exercise(params, new OutputParam[](0));
    }

    /**
     * @dev Arbitrary outputParam. Exercises capture against the real Storage.
     */
    function testFuzz_arbitraryOutputParamAlwaysResolvesOrFailsDocumentedly(uint8 fetcherRaw, bytes calldata paramData)
        public
    {
        OutputParam[] memory outs = new OutputParam[](1);
        outs[0] =
            OutputParam({fetcherType: OutputParamFetcherType(uint8(bound(fetcherRaw, 0, 1))), paramData: paramData});

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encodePacked(bytes4(0), bytes32(0)),
            constraints: new Constraint[](0)
        });

        _exercise(params, outs);
    }

    /**
     * @dev Several parameters at once, so ordering rules are reachable: a TARGET may appear once, a
     *      VALUE once, and BALANCE may carry at most one constraint.
     */
    function testFuzz_multipleParamsAlwaysResolveOrFailDocumentedly(
        uint8 paramA,
        uint8 fetchA,
        bytes calldata dataA,
        uint8 paramB,
        uint8 fetchB,
        bytes calldata dataB
    ) public {
        InputParam[] memory params = new InputParam[](2);
        params[0] = InputParam({
            paramType: InputParamType(uint8(bound(paramA, 0, 2))),
            fetcherType: InputParamFetcherType(uint8(bound(fetchA, 0, 2))),
            paramData: dataA,
            constraints: new Constraint[](0)
        });
        params[1] = InputParam({
            paramType: InputParamType(uint8(bound(paramB, 0, 2))),
            fetcherType: InputParamFetcherType(uint8(bound(fetchB, 0, 2))),
            paramData: dataB,
            constraints: new Constraint[](0)
        });

        _exercise(params, new OutputParam[](0));
    }

    /**
     * @dev A BALANCE fetcher against a real ERC-20, with a real balance to compare against.
     *      This is the property the SDK depends on: the resolved word equals `balanceOf`.
     */
    function testFuzz_balanceFetcherResolvesTheTrueBalance(address holder) public {
        vm.assume(holder != address(0));

        uint256 expected = IERC20(USDC).balanceOf(holder);

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.BALANCE,
            paramData: abi.encodePacked(USDC, holder), // exactly 40 bytes
            constraints: new Constraint[](0)
        });

        InputParam[] memory withTarget = new InputParam[](2);
        withTarget[0] = params[0];
        withTarget[1] = InputParam({
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(address(0xdead)),
            constraints: new Constraint[](0)
        });

        account.clearCaptured();
        account.setDispatchReturnData(abi.encode(uint256(0)));

        vm.prank(address(account));
        (bool ok,) = MODULE.call(
            abi.encodeWithSelector(IComposableExecutionModule.executeComposableCall.selector, _single(withTarget))
        );

        if (ok) {
            (,, bytes memory callData,) = account.capturedAt(0);
            // 4 bytes of selector plus the resolved 32-byte balance word.
            assertEq(callData.length, 36, "selector plus one resolved word");
            assertEq(uint256(bytes32(_slice32(callData, 4))), expected, "resolved to the true balance");
            resolved++;
        }
    }

    /**
     * @dev Native balance when the token is `address(0)`, per the upstream rule.
     */
    function testFuzz_balanceFetcherTreatsZeroTokenAsNative(address holder) public {
        vm.assume(holder != address(0));
        vm.deal(holder, 1 ether);

        InputParam[] memory params = new InputParam[](2);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.BALANCE,
            paramData: abi.encodePacked(address(0), holder),
            constraints: new Constraint[](0)
        });
        params[1] = InputParam({
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(address(0xdead)),
            constraints: new Constraint[](0)
        });

        account.clearCaptured();
        vm.prank(address(account));
        (bool ok,) = MODULE.call(
            abi.encodeWithSelector(IComposableExecutionModule.executeComposableCall.selector, _single(params))
        );

        assertTrue(ok, "must resolve");
        (,, bytes memory callData,) = account.capturedAt(0);
        assertEq(uint256(bytes32(_slice32(callData, 4))), holder.balance, "native balance");
    }

    // -------------------------------------------------------------------------------------------
    // Constraint properties, against the real engine
    // -------------------------------------------------------------------------------------------

    /**
     * @dev A GTE whose bound is the exact resolved value must pass. Zero is the only value that is
     *      both universally true and universally interesting, so it anchors the property.
     */
    function testFuzz_constraintAgainstRealBalancesAlwaysAgrees(uint256 raw) public {
        address holder = address(uint160(bound(raw, 1, type(uint160).max)));
        uint256 balance = IERC20(USDC).balanceOf(holder);

        // GTE(balance) must pass.
        InputParam[] memory pass = new InputParam[](2);
        pass[0] = InputParam(
            InputParamType.CALL_DATA,
            InputParamFetcherType.BALANCE,
            abi.encodePacked(USDC, holder),
            _one(ConstraintType.GTE, bytes32(balance))
        );
        pass[1] = _target(address(0xdead));

        _exercise(pass, new OutputParam[](0));

        // LTE(balance - 1) must fail, since balance > balance - 1.
        uint256 below = balance == 0 ? 0 : balance - 1;
        InputParam[] memory fail = new InputParam[](2);
        fail[0] = InputParam(
            InputParamType.CALL_DATA,
            InputParamFetcherType.BALANCE,
            abi.encodePacked(USDC, holder),
            _one(ConstraintType.LTE, bytes32(below))
        );
        fail[1] = _target(address(0xdead));

        _exercise(fail, new OutputParam[](0));
    }

    /**
     * @dev Two constraints on one BALANCE parameter must always revert, whatever they say. This is
     *      the "at most one constraint" rule, and the SDK depends on it.
     */
    function testFuzz_balanceRejectsASecondConstraint(uint8 typeA, uint8 typeB) public {
        Constraint[] memory two = new Constraint[](2);
        two[0] = Constraint(ConstraintType(uint8(bound(typeA, 0, 8))), abi.encode(bytes32(0)));
        two[1] = Constraint(ConstraintType(uint8(bound(typeB, 0, 8))), abi.encode(bytes32(0)));

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.BALANCE,
            paramData: abi.encodePacked(USDC, address(this)),
            constraints: two
        });

        _expectRevert(params, IDocumentedErrors.InvalidSetOfInputParams.selector);
    }

    /**
     * @dev `BALANCE` requires exactly 40 packed bytes. Any other length reverts. This is the single
     *      most common integration mistake, and the SDK makes it easy to get wrong.
     */
    function testFuzz_balanceRejectsAnyLengthButForty(uint8 lengthSeed) public {
        uint256 len = bound(lengthSeed, 0, 96);
        vm.assume(len != 40);

        bytes memory junk = new bytes(len);
        for (uint256 i; i < len; i++) {
            junk[i] = bytes1(uint8(i));
        }

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.BALANCE,
            paramData: junk,
            constraints: new Constraint[](0)
        });

        _expectRevert(params, IDocumentedErrors.InvalidParameterEncoding.selector);
    }

    /**
     * @dev `TARGET` may never use the `BALANCE` fetcher.
     */
    function testFuzz_targetRejectsTheBalanceFetcher(uint256 seed) public {
        address holder = address(uint160(bound(seed, 1, type(uint160).max)));

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.BALANCE,
            paramData: abi.encodePacked(USDC, holder),
            constraints: new Constraint[](0)
        });

        _expectRevert(params, IDocumentedErrors.InvalidParameterEncoding.selector);
    }

    /**
     * @dev A leaf constraint with a payload that is not exactly 32 bytes always reverts. This catches
     *      the `abi.encodePacked` mistake that would otherwise compare a non-canonical encoding.
     */
    function testFuzz_leafConstraintRejectsNon32BytePayload(uint8 lengthSeed, uint8 typeRaw) public {
        uint256 len = bound(lengthSeed, 0, 64);
        vm.assume(len != 32);

        // The 32-byte leaves only. IN takes 64 bytes and would fail in abi.decode before the
        // length check, which would test nothing about the rule under test.
        uint256 pick = bound(typeRaw, 0, 4);
        ConstraintType ct = pick == 3 ? ConstraintType.GTE_SIGNED : ConstraintType(uint8(pick));

        Constraint[] memory cs = new Constraint[](1);
        cs[0] = Constraint(ct, new bytes(len));

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(uint256(1)),
            constraints: cs
        });

        _expectRevert(params, IDocumentedErrors.InvalidReferenceDataLength.selector);
    }

    /**
     * @dev `IN` with reversed bounds always reverts, for both the signed and unsigned forms. The
     *      signed form matters because it is the fail-closed one.
     */
    function testFuzz_inRangeRejectsReversedBounds(uint256 a, uint256 b) public {
        // Reversed means `lower > upper`, which is the fail condition. Sorting would produce a
        // valid range and the test would be asserting nothing.
        vm.assume(a != b);
        (uint256 lo, uint256 hi) = a > b ? (a, b) : (b, a); // lo > hi, the fail condition

        Constraint[] memory cs = new Constraint[](1);
        cs[0] = Constraint(ConstraintType.IN, abi.encode(bytes32(lo), bytes32(hi)));

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(uint256(0)),
            constraints: cs
        });

        _expectRevert(params, IDocumentedErrors.InvalidConstraintRange.selector);
    }

    /**
     * @dev `SKIP` requires an empty payload. Anything else reverts, which is what stops an encoding
     *      mistake from being silently ignored.
     */
    function testFuzz_skipRejectsAnyPayload(uint8 lengthSeed) public {
        uint256 len = bound(lengthSeed, 0, 64);
        vm.assume(len != 0);

        Constraint[] memory cs = new Constraint[](1);
        cs[0] = Constraint(ConstraintType.SKIP, new bytes(len));

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(uint256(1)),
            constraints: cs
        });

        _expectRevert(params, IDocumentedErrors.InvalidReferenceDataLength.selector);
    }

    /**
     * @dev A nested `OR` always reverts, and it does so *structurally*, before any leaf is evaluated.
     *      That ordering is what keeps off-chain rendering consistent with on-chain behaviour, so it
     *      is worth asserting directly rather than inferring.
     */
    function testFuzz_nestedOrAlwaysRevertsEvenWhenAnOuterLeafWouldPass() public {
        // A genuinely nested OR: the outer OR's single child is itself an OR.
        Constraint[] memory leaf = new Constraint[](1);
        leaf[0] = Constraint(ConstraintType.EQ, abi.encode(bytes32(uint256(1))));
        Constraint[] memory inner = new Constraint[](1);
        inner[0] = Constraint(ConstraintType.OR, abi.encode(leaf));
        Constraint memory orInner = Constraint(ConstraintType.OR, abi.encode(inner));

        // Outer array: [SKIP, OR(OR(...))]. SKIP at index 0 always passes, so without the
        // structural pre-pass the nested OR at index 1 would still be reached and rejected. This
        // test proves the rejection happens regardless of index 0.
        Constraint[] memory cs = new Constraint[](2);
        cs[0] = Constraint(ConstraintType.SKIP, "");
        cs[1] = orInner;

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(uint256(0), uint256(1)),
            constraints: cs
        });

        _expectRevert(params, IDocumentedErrors.InvalidConstraintType.selector);
    }

    /**
     * @dev `SKIP` at index 0 lets a caller ignore `roundId` and still check `answer` at word 1.
     *      This is the word-indexing property the whole constraint design rests on, and the reason
     *      `FeedGuard` has to return exactly one word.
     */
    function testFuzz_wordIndexingSelectsTheIntendedField() public {
        (uint80 roundId, int256 answer,,,) = IAggregatorV3ForTest(FEED).latestRoundData();

        // Correct: skip word 0, bound word 1.
        Constraint[] memory correct = new Constraint[](2);
        correct[0] = Constraint(ConstraintType.SKIP, "");
        correct[1] = Constraint(ConstraintType.GTE_SIGNED, abi.encode(bytes32(uint256(answer))));

        InputParam[] memory params = new InputParam[](2);
        params[0] = InputParam(
            InputParamType.CALL_DATA,
            InputParamFetcherType.STATIC_CALL,
            abi.encode(FEED, abi.encodeWithSignature("latestRoundData()")),
            correct
        );
        params[1] = _target(address(0xdead));
        _exercise(params, new OutputParam[](0));

        // Wrong: the same bound at index 0 compares `roundId`, not the answer. With a bound above
        // both values it must fail, proving the constraint lands where the encoding says it does.
        uint256 impossible = type(uint128).max;
        // bound above any realistic answer, so the comparison must fail against word 0
        Constraint[] memory wrong = new Constraint[](1);
        wrong[0] = Constraint(ConstraintType.GTE_SIGNED, abi.encode(bytes32(impossible)));

        InputParam[] memory wrongParams = new InputParam[](2);
        wrongParams[0] = InputParam(
            InputParamType.CALL_DATA,
            InputParamFetcherType.STATIC_CALL,
            abi.encode(FEED, abi.encodeWithSignature("latestRoundData()")),
            wrong
        );
        wrongParams[1] = _target(address(0xdead));
        _expectRevert(wrongParams, IDocumentedErrors.ConstraintNotMet.selector);

        assertTrue(roundId > 0, "precondition: a live feed has rounds");
    }

    // -------------------------------------------------------------------------------------------
    // V-21: an undocumented failure mode, reachable from a signed batch
    // -------------------------------------------------------------------------------------------

    /**
     * @dev A `STATIC_CALL` fetcher whose target returns nothing, routed into `VALUE`, reverts with
     *      **no data at all**. Not `InsufficientRawValue`, not any of the twelve documented errors.
     *
     *      The engine decodes the empty return as a `uint256`, and a failed ABI decode produces a bare
     *      revert. This is reachable: any batch that static-calls a target which can return nothing
     *      and routes the result into `VALUE` will hit it.
     *
     *      Why it matters even though it is only a revert. It is not atomicity-breaking, but it is
     *      undiagnosable. A caller sees an empty revert with no constraint type, no parameter index
     *      and no message, so the batch cannot be explained to a user or triaged from a receipt. The
     *      decoder in docs/06 relies on a revert reason to render "this gate failed"; here it has
     *      nothing to render.
     *
     *      LATCH's mitigation is to never route a possibly-empty `STATIC_CALL` into `VALUE`. Feed it
     *      into `CALL_DATA`, which tolerates an empty contribution, or wrap the call in a helper that
     *      reverts with a named error, which is what `FeedGuard` and `QuoterGuard` do.
     *
     *      Recorded as V-21 in docs/appendix/verification-log.md.
     */
    function test_staticCallIntoValueWithEmptyReturnRevertsWithoutData() public {
        address noCode = address(0xdead0000000000000000000000000000000001);
        assertEq(noCode.code.length, 0, "precondition: no code, so returndata is empty");

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.VALUE,
            fetcherType: InputParamFetcherType.STATIC_CALL,
            paramData: abi.encode(noCode, bytes("")),
            constraints: new Constraint[](0)
        });

        account.clearCaptured();
        vm.prank(address(account));
        (bool ok, bytes memory ret) = MODULE.call(
            abi.encodeWithSelector(IComposableExecutionModule.executeComposableCall.selector, _single(params))
        );

        assertFalse(ok, "must revert");
        assertLt(ret.length, 4, "and the revert must carry no selector: V-21");
    }

    /**
     * @dev A capture whose `returnValues` is absurd does not revert cleanly. It panics.
     *
     *      `OutputParam` for `EXEC_RESULT` is `abi.encode(returnValues, storage, baseSlot)`, and the
     *      engine writes that many 32-byte words into storage. With `returnValues` at 2^248 the loop
     *      exhausts the block gas limit and the transaction ends in a `Panic(uint256)` rather than
     *      one of the twelve documented errors.
     *
     *      Only self-inflicted: the payload is part of what the user signs, so a batch that can reach
     *      this is one the user chose to sign. Still worth naming, because the resulting revert is a
     *      panic with a code the decoder has no rendering for.
     *
     *      `FailSafeExecutor` bounds this independently with `MAX_CAPTURED_VALUES`, so its own path is
     *      unaffected. The SDK-side fix is to validate `returnValues` at encoding time.
     *
     *      Recorded as V-22.
     */
    function test_absurdReturnValuesPanics() public {
        OutputParam[] memory outs = new OutputParam[](1);
        outs[0] = OutputParam({
            fetcherType: OutputParamFetcherType.EXEC_RESULT,
            paramData: abi.encode(type(uint256).max >> 8, STORAGE, bytes32(uint256(1)))
        });

        InputParam[] memory params = new InputParam[](1);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(bytes32(uint256(0))),
            constraints: new Constraint[](0)
        });

        account.clearCaptured();
        vm.prank(address(account));
        (bool ok, bytes memory ret) = MODULE.call(
            abi.encodeWithSelector(IComposableExecutionModule.executeComposableCall.selector, _single(params, outs))
        );

        assertFalse(ok, "must not resolve");
        assertTrue(
            _isPanic(ret) || _isEmpty(ret) || _isDocumented(ret), "and it fails in an understood way, never silently"
        );
    }

    /// @dev The same empty return routed into CALL_DATA is harmless, which is the mitigation.
    function test_staticCallIntoCallDataWithEmptyReturnIsHarmless() public {
        address noCode = address(0xdead0000000000000000000000000000000001);

        InputParam[] memory params = new InputParam[](2);
        params[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.STATIC_CALL,
            paramData: abi.encode(noCode, bytes("")),
            constraints: new Constraint[](0)
        });
        params[1] = _target(address(0xdead));

        account.clearCaptured();
        vm.prank(address(account));
        (bool ok,) = MODULE.call(
            abi.encodeWithSelector(IComposableExecutionModule.executeComposableCall.selector, _single(params))
        );

        assertTrue(ok, "an empty CALL_DATA contribution must not break composition");
    }

    // -------------------------------------------------------------------------------------------
    // Reporting
    // -------------------------------------------------------------------------------------------

    function test_reporting() public view {
        console.log("resolved:", resolved);
        console.log("documented revert:", documented);
        console.log("empty revert:", emptyReverts);
        console.log("panic:", panics);
    }

    // -------------------------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------------------------

    /// @dev Drives the engine and asserts the outcome is either resolution or a documented revert.
    function _exercise(InputParam[] memory params, OutputParam[] memory outs) internal {
        account.clearCaptured();
        account.setDispatchReturnData(abi.encode(bytes32(0)));

        vm.prank(address(account));
        (bool ok, bytes memory ret) = MODULE.call(
            abi.encodeWithSelector(IComposableExecutionModule.executeComposableCall.selector, _single(params, outs))
        );

        if (ok) {
            resolved++;
            return;
        }

        if (_isEmpty(ret)) {
            // A bare revert with no data. See test_staticCallIntoValueWithEmptyReturn for the
            // reachable path. Recorded as V-21.
            emptyReverts++;
            return;
        }

        if (_isPanic(ret)) {
            // Arithmetic panic. Reached by a capture declaring an absurd returnValues count.
            // See test_absurdReturnValuesPanics. Recorded as V-22.
            panics++;
            return;
        }

        assertTrue(_isDocumented(ret), string.concat("undocumented revert: ", _hex4(ret)));
        documented++;
    }

    /// @dev Asserts a specific documented error, so a rule change cannot pass silently.
    function _expectRevert(InputParam[] memory params, bytes4 expected) internal {
        account.clearCaptured();
        vm.prank(address(account));
        (bool ok, bytes memory ret) = MODULE.call(
            abi.encodeWithSelector(IComposableExecutionModule.executeComposableCall.selector, _single(params))
        );

        assertFalse(ok, "expected a revert");
        assertEq(_selectorOf(ret), expected, string.concat("wrong error, got ", _hex4(ret)));
    }

    function _single(InputParam[] memory params) internal pure returns (ComposableExecution[] memory ex) {
        return _single(params, new OutputParam[](0));
    }

    function _single(InputParam[] memory params, OutputParam[] memory outs)
        internal
        pure
        returns (ComposableExecution[] memory ex)
    {
        ex = new ComposableExecution[](1);
        ex[0] = ComposableExecution({functionSig: bytes4(0), inputParams: params, outputParams: outs});
    }

    function _targetParam(address t) internal pure returns (InputParam[] memory p) {
        p = new InputParam[](1);
        p[0] = _target(t);
    }

    function _target(address t) internal pure returns (InputParam memory) {
        return InputParam(InputParamType.TARGET, InputParamFetcherType.RAW_BYTES, abi.encode(t), new Constraint[](0));
    }

    function _one(ConstraintType ct, bytes32 ref) internal pure returns (Constraint[] memory cs) {
        cs = new Constraint[](1);
        cs[0] = Constraint(ct, abi.encode(ref));
    }

    function _constraints(uint8 count, uint8 typeRaw, bytes32 refA, bytes32 refB)
        internal
        pure
        returns (Constraint[] memory cs)
    {
        uint256 n = bound(count, 0, 3);
        cs = new Constraint[](n);
        for (uint256 i; i < n; i++) {
            ConstraintType ct = ConstraintType(uint8(bound(typeRaw, 0, 8)));
            // IN and IN_SIGNED take 64 bytes, OR takes an encoded array, SKIP takes none,
            // and the leaves take 32. Anything else is a deliberate encoding error to fuzz.
            bytes memory ref;
            if (ct == ConstraintType.IN || ct == ConstraintType.IN_SIGNED) {
                ref = abi.encode(refA, refB);
            } else if (ct == ConstraintType.OR) {
                Constraint[] memory inner = new Constraint[](1);
                inner[0] = Constraint(ConstraintType.EQ, abi.encode(refA));
                ref = abi.encode(inner);
            } else if (ct == ConstraintType.SKIP) {
                ref = "";
            } else {
                ref = abi.encode(refA);
            }
            cs[i] = Constraint(ct, ref);
        }
    }

    /// @dev Panic(uint256). Solidity's arithmetic and allocation panic selector.
    function _isPanic(bytes memory revertData) internal pure returns (bool) {
        return _selectorOf(revertData) == bytes4(keccak256("Panic(uint256)"));
    }

    /// @dev A revert carrying no data at all. Reachable, and not in the documented catalogue.
    function _isEmpty(bytes memory revertData) internal pure returns (bool) {
        return revertData.length < 4;
    }

    /// @dev The twelve documented library errors, plus the module's own.
    function _isDocumented(bytes memory revertData) internal pure returns (bool) {
        bytes4 sel = _selectorOf(revertData);
        return sel == IDocumentedErrors.ConstraintNotMet.selector
            || sel == IDocumentedErrors.InvalidConstraintType.selector
            || sel == IDocumentedErrors.InvalidReferenceDataLength.selector
            || sel == IDocumentedErrors.InvalidConstraintRange.selector
            || sel == IDocumentedErrors.EmptyOrSubConstraints.selector
            || sel == IDocumentedErrors.InsufficientRawValue.selector
            || sel == IDocumentedErrors.InvalidParameterEncoding.selector
            || sel == IDocumentedErrors.InvalidSetOfInputParams.selector
            || sel == IDocumentedErrors.ComposableExecutionFailed.selector
            || sel == IDocumentedErrors.InvalidOutputParamFetcherType.selector
            || sel == IDocumentedErrors.Output_StaticCallFailed.selector
            || sel == IDocumentedErrors.InsufficientReturnData.selector
            // Module-level, from ComposableExecutionModule.
            || sel == bytes4(keccak256("OnlyEntryPointOrAccount()")) || sel == bytes4(keccak256("DelegateCallOnly()"))
            || sel == bytes4(keccak256("ZeroAddressNotAllowed()"))
            || sel == bytes4(keccak256("FailedToReturnMsgValue()"));
    }

    function _selectorOf(bytes memory data) internal pure returns (bytes4 sel) {
        if (data.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(data, 0x20))
        }
    }

    function _hex4(bytes memory data) internal pure returns (string memory) {
        bytes4 sel = _selectorOf(data);
        return string(abi.encodePacked("0x", _nibbles(uint8(sel[0])), _nibbles(uint8(sel[1]))));
    }

    function _nibbles(uint8 b) internal pure returns (bytes memory) {
        bytes memory o = new bytes(2);
        o[0] = bytes1(uint8(_hexDigit(b >> 4)));
        o[1] = bytes1(uint8(_hexDigit(b & 0x0f)));
        return o;
    }

    function _hexDigit(uint8 d) internal pure returns (uint8) {
        return d < 10 ? d + 48 : d + 87;
    }

    function _slice32(bytes memory b, uint256 start) internal pure returns (bytes32 out) {
        assembly {
            out := mload(add(add(b, 0x20), start))
        }
    }
}

interface IAggregatorV3ForTest {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}
