---
title: "Reference: ComposabilityDataTypes.sol"
status: draft
project: LATCH
last_reviewed: 2026-10-02
sources: appendix/sources.md (R1)
---

# Reference: `ComposabilityDataTypes.sol`

Verbatim excerpt. Unmodified.

- **Upstream:** [`bcnmy/erc8211-contracts`](https://github.com/bcnmy/erc8211-contracts)
- **Path:** `contracts/types/ComposabilityDataTypes.sol`
- **Licence:** MIT (SPDX reproduced below)
- **Retrieved:** 2026-10-02
- **Pinned to:** MEE v2.2.2 release

This file is the wire format. Every ABI tuple LATCH encodes is defined here. Enum **ordering** is
part of the encoding — a reorder upstream silently changes meaning. See verification item V-10.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Type of the input parameter
enum InputParamType {
    TARGET, // The target address
    VALUE, // The value
    CALL_DATA // The call data
}

// Parameter type for composition
enum InputParamFetcherType {
    RAW_BYTES, // Already encoded bytes
    STATIC_CALL, // Perform a static call
    BALANCE // Get the balance of an address
}

enum OutputParamFetcherType {
    EXEC_RESULT, // The return of the execution call
    STATIC_CALL // Call to some other function
}

// Constraint type for parameter validation
enum ConstraintType {
    EQ, // Equal to (bitwise equality; suitable for signed, unsigned, addresses, bytes32)
    GTE, // Greater than or equal to (unsigned)
    LTE, // Less than or equal to (unsigned)
    IN, // In range [lower, upper] (unsigned bytes32 comparison only — for signed ranges use IN_SIGNED)
    // GTE_SIGNED / LTE_SIGNED compare via int256(uint256(value)), so any value with the
    // high bit set is interpreted as negative under two's complement. Only use these when
    // the resolved value is known to live in the signed int256 domain (max int256.max =
    // 2**255 - 1). For values that may exceed 2**255 - 1, use the unsigned GTE / LTE; this
    // applies to both RAW_BYTES inputs and STATIC_CALL return data.
    GTE_SIGNED, // Greater than or equal to (signed int256)
    LTE_SIGNED, // Less than or equal to (signed int256)
    OR, // At least one sub-constraint must pass; referenceData = abi.encode(Constraint[]); sub-constraints must be leaf types (no nested OR)
    SKIP, // Always passes; referenceData must be empty. Use to ignore a specific 32-byte field while still checking later ones at fixed positions
    IN_SIGNED // In range [lower, upper] (signed int256 comparison). Bounds and value are reinterpreted as int256; rejects signed lower > upper. Use this for
    // signed ranges; for unsigned ranges use IN
}

// Constraint for parameter validation
struct Constraint {
    ConstraintType constraintType;
    bytes referenceData;
}

// Structure to define parameter composition
struct InputParam {
    InputParamType paramType;
    InputParamFetcherType fetcherType; // How to fetch the parameter
    bytes paramData;
    Constraint[] constraints;
}

// Structure to define return value handling
struct OutputParam {
    OutputParamFetcherType fetcherType;
 // How to fetch the parameter
    bytes paramData;
}

// Structure to define a composable execution
struct ComposableExecution {
    bytes4 functionSig;
    InputParam[] inputParams;
    OutputParam[] outputParams;
}
```

## Ordinal mapping

Required when hand-encoding. Most SDK versions handle this, but the decoder in `06` needs it.

| Enum | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| `InputParamType` | `TARGET` | `VALUE` | `CALL_DATA` | | | | | | |
| `InputParamFetcherType` | `RAW_BYTES` | `STATIC_CALL` | `BALANCE` | | | | | | |
| `OutputParamFetcherType` | `EXEC_RESULT` | `STATIC_CALL` | | | | | | | |
| `ConstraintType` | `EQ` | `GTE` | `LTE` | `IN` | `GTE_SIGNED` | `LTE_SIGNED` | `OR` | `SKIP` | `IN_SIGNED` |

## The three facts that drive LATCH design

1. **`SKIP` is a constraint, not a failure policy.** It sits in `ConstraintType`, always returns
   true, and exists to ignore one 32-byte field while later fields are still validated at fixed
   positions. It has nothing to do with skipping a call. See [05-failure-semantics.md](../05-failure-semantics.md).
2. **`InputParam` has no arithmetic field.** There is no expression, no formula, no operator. Values
   are literals, static-call returns or balances. `minAmountOut = price * (1 - slippage)` is not
   expressible. See [04-constraints-and-oracles.md](../04-constraints-and-oracles.md).
3. **Constraints have no access to `block.timestamp`.** Bounds are static 32-byte or 64-byte
   literals compared against a resolved word. A relational check such as
   `block.timestamp - updatedAt <= maxStaleness` cannot be expressed. `FeedGuard` closes this.