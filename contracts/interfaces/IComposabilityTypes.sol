// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IComposabilityTypes
 * @notice The ERC-8211 wire format. Enum ordering is part of the encoding.
 * @dev Mirrors `ComposabilityDataTypes.sol` from bcnmy/erc8211-contracts, which is MIT licensed.
 *      Reproduced verbatim in docs/technical-reference/composability-data-types.md.
 *      If upstream reorders these enums, every previously signed batch decodes differently.
 *      Tracked as V-10 in docs/appendix/verification-log.md.
 */

enum InputParamType {
    TARGET,
    VALUE,
    CALL_DATA
}

enum InputParamFetcherType {
    RAW_BYTES,
    STATIC_CALL,
    BALANCE
}

enum OutputParamFetcherType {
    EXEC_RESULT,
    STATIC_CALL
}

enum ConstraintType {
    EQ,
    GTE,
    LTE,
    IN,
    GTE_SIGNED,
    LTE_SIGNED,
    OR,
    SKIP,
    IN_SIGNED
}

struct Constraint {
    ConstraintType constraintType;
    bytes referenceData;
}

struct InputParam {
    InputParamType paramType;
    InputParamFetcherType fetcherType;
    bytes paramData;
    Constraint[] constraints;
}

struct OutputParam {
    OutputParamFetcherType fetcherType;
    bytes paramData;
}

struct ComposableExecution {
    bytes4 functionSig;
    InputParam[] inputParams;
    OutputParam[] outputParams;
}
