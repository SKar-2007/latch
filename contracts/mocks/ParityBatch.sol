// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {
    ComposableExecution,
    Constraint,
    ConstraintType,
    InputParam,
    InputParamFetcherType,
    InputParamType,
    OutputParam,
    OutputParamFetcherType
} from "../interfaces/IComposabilityTypes.sol";

/**
 * @title ParityBatch
 * @notice The one batch both encoders are compared on.
 *
 * @dev Shared by `test/parity/AbiParity.t.sol` and `script/EmitAbiFixture.s.sol` so the fixture can
 *      never be generated from a different batch than the one the test verifies.
 *
 *      It is built to be awkward on purpose: packed `BALANCE` data, a `TARGET`, a capture, literal
 *      data with two constraints, a `STATIC_CALL` whose `paramData` is itself ABI-encoded, an `IN`
 *      range, and an `OR` carrying two sub-constraints. Anything wrong about offsets, nesting, padding
 *      or ordering shows up here.
 */
library ParityBatch {
    address internal constant ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address internal constant STORAGE = 0x00008211dea1Aca67ac55fc44AE3bF88CF41281d;
    address internal constant ACCOUNT = 0x1111111111111111111111111111111111111111;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;

    /**
     * @dev The batch's encoding as the module receives it: length word, then elements.
     *
     *      `abi.encode` of a dynamic array prefixes a 32-byte offset pointing at the array, which is
     *      part of the *calldata* wrapper rather than the argument. The module's dispatcher consumes
     *      that offset, so what the client has to reproduce is the content without it. Comparing
     *      against `abi.encode` directly would compare the client against the calldata wrapper and
     *      report a 32-byte disagreement that looks like a layout bug.
     */
    function encodeArgumentContent() internal pure returns (bytes memory content) {
        bytes memory wrapped = abi.encode(build());
        content = new bytes(wrapped.length - 32);
        for (uint256 i; i < content.length; i++) {
            content[i] = wrapped[i + 32];
        }
    }

    function build() internal pure returns (ComposableExecution[] memory batch) {
        batch = new ComposableExecution[](2);
        batch[0] = _entry0();
        batch[1] = _entry1();
    }

    function _entry0() private pure returns (ComposableExecution memory) {
        InputParam[] memory p = new InputParam[](2);
        p[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.BALANCE,
            paramData: abi.encodePacked(WETH, ACCOUNT),
            constraints: _one(_c(ConstraintType.GTE, abi.encode(uint256(1))))
        });
        p[1] = InputParam({
            paramType: InputParamType.TARGET,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encodePacked(ROUTER),
            constraints: new Constraint[](0)
        });

        OutputParam[] memory o = new OutputParam[](1);
        o[0] = OutputParam({
            fetcherType: OutputParamFetcherType.EXEC_RESULT,
            paramData: abi.encode(uint256(1), STORAGE, bytes32(uint256(0xAB)))
        });

        return ComposableExecution({functionSig: 0xdeadbeef, inputParams: p, outputParams: o});
    }

    function _entry1() private pure returns (ComposableExecution memory) {
        InputParam[] memory p = new InputParam[](2);
        p[0] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.RAW_BYTES,
            paramData: abi.encode(uint256(7), uint256(9)),
            constraints: _two(
                _c(ConstraintType.EQ, abi.encode(uint256(7))), _c(ConstraintType.LTE, abi.encode(uint256(100)))
            )
        });
        p[1] = InputParam({
            paramType: InputParamType.CALL_DATA,
            fetcherType: InputParamFetcherType.STATIC_CALL,
            paramData: abi.encode(USDC, abi.encodeWithSignature("balanceOf(address)", ACCOUNT)),
            constraints: _two(
                _c(ConstraintType.IN, abi.encode(uint256(1), uint256(100))), _c(ConstraintType.OR, _orPayload())
            )
        });

        return ComposableExecution({functionSig: 0xcafebabe, inputParams: p, outputParams: new OutputParam[](0)});
    }

    /**
     * @dev The `OR` payload, in the shape the engine actually decodes.
     *
     *      `ComposableExecutionLib` does `abi.decode(referenceData, (Constraint[]))`, so the payload is
     *      `abi.encode(Constraint[] memory)` -- an offset, a length, and the elements. An earlier
     *      version of this fixture used `abi.encode(c1, c2)`, which is a two-field tuple with no
     *      length word. It encodes and it decodes as *something*, so nothing rejected it, and it would
     *      have taught the client the wrong layout for every `OR` it ever builds.
     */
    function _orPayload() private pure returns (bytes memory) {
        Constraint[] memory subs = new Constraint[](2);
        subs[0] = _c(ConstraintType.EQ, abi.encode(uint256(5)));
        subs[1] = _c(ConstraintType.GTE, abi.encode(uint256(3)));
        return abi.encode(subs);
    }

    function _c(ConstraintType t, bytes memory ref) private pure returns (Constraint memory) {
        return Constraint({constraintType: t, referenceData: ref});
    }

    function _one(Constraint memory a) private pure returns (Constraint[] memory cs) {
        cs = new Constraint[](1);
        cs[0] = a;
    }

    function _two(Constraint memory a, Constraint memory b) private pure returns (Constraint[] memory cs) {
        cs = new Constraint[](2);
        cs[0] = a;
        cs[1] = b;
    }
}
