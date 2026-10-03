// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IQuoterV2} from "../interfaces/IQuoterV2.sol";

/**
 * @title MockQuoter
 * @notice A Quoter whose output is a settable ratio, so slippage maths is deterministic in tests.
 */
contract MockQuoter is IQuoterV2 {
    error NoRoute();

    uint256 private _amountOut;

    constructor(uint256 amountOut_) {
        _amountOut = amountOut_;
    }

    function setAmountOut(uint256 amountOut) external {
        _amountOut = amountOut;
    }

    function quoteExactInputSingle(address, address, uint256, uint24, uint160)
        external
        view
        returns (uint256 amountOut, uint160, uint32, uint256)
    {
        if (_amountOut == 0) revert NoRoute();
        return (_amountOut, 0, 0, 0);
    }
}
