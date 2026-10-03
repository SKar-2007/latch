// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IERC20
 * @notice The subset of ERC-20 the test suites read. Declared locally to avoid a dependency.
 */
interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);

    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);

    function decimals() external view returns (uint8);
}
