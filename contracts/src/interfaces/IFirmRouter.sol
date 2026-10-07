// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Route} from "../libraries/RouteLib.sol";

/// @title IFirmRouter
/// @notice Integration surface of FirmRouter: the entry point plus every event and error a caller can observe.
interface IFirmRouter {
    /// @dev reasons: 0 BLOCKED, 1 UNRATED_CAP, 2 QUOTE_FAILED, 3 BELOW_MIN_OUT, 4 ADVERTISED_MISMATCH
    event LegSkipped(bytes32 indexed poolId, address indexed hook, uint8 reason);
    event Rejected(
        bytes32 indexed poolId, address indexed hook, uint256 quotedOut, uint256 settledOut, bool execFailed
    );
    event Filled(
        bytes32 indexed poolId,
        address indexed hook,
        address indexed user,
        uint256 amountIn,
        uint256 quotedOut,
        uint256 settledOut,
        uint8 legIndex
    );
    event NoFill(address indexed user, uint256 amountIn);

    error DeadlinePassed();
    error BadRouteCount();
    error RouteTokenMismatch();
    /// @dev Internal control flow: carries the settled amount out of a reverted leg.
    error Shortfall(uint256 settledOut);
    error OnlySelf();
    /// @dev The call did not carry enough gas to give a quote or a leg its full cap; reverts instead of striking.
    error InsufficientGas();

    /// @notice Swap `amountIn` of the routes' input token, trying each route in order until one honours its quote.
    /// @param routes 1..4 candidate pools, best quote first; all must share the same pair and direction
    /// @param amountIn exact input, pulled from msg.sender (approve the router first)
    /// @param minTotalOut the caller's own floor across the whole swap
    /// @param recipient receives the output
    /// @param deadline unix timestamp after which the call reverts
    /// @return amountOut output paid to `recipient` (0 if nothing filled)
    /// @return legIndex index of the filled route, or -1 if nothing filled (input refunded, strikes persist)
    function swapExactIn(
        Route[] calldata routes,
        uint128 amountIn,
        uint128 minTotalOut,
        address recipient,
        uint64 deadline
    ) external returns (uint256 amountOut, int256 legIndex);
}
