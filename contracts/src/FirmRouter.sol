// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {SwapExecutor} from "./base/SwapExecutor.sol";
import {IScoreboard, Status} from "./interfaces/IScoreboard.sol";
import {Route, RouteLib} from "./libraries/RouteLib.sol";
import {QuoteLib} from "./libraries/QuoteLib.sol";
import {SafeCall} from "./libraries/SafeCall.sol";

/// @title FirmRouter
/// @notice Turns a quote into a promise. For every candidate route (best quote first) it asks the pool's
///         V4 Quoter for a quote *inside the same transaction*, executes the swap at the identical state, and
///         reverts only that leg if the settled output is below the floor. A shortfall is a public strike on
///         the hook (Scoreboard) and the router falls back to the next route. The user's funds are untouched
///         by a failed leg. Deterministic code decides everything; no oracle, no offchain input.
contract FirmRouter is SwapExecutor, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    // ------------------------------------------------------------------ constants / config
    uint256 public constant MAX_LEGS = 4;
    /// @dev Return data copied from a leg call: selector + one word is 36 bytes; 68 leaves headroom.
    uint256 internal constant LEG_RETURN_COPY = 68;
    /// @dev Gas kept back after a capped sub-call so the 63/64 rule can never starve the outer frame.
    uint256 internal constant GAS_RESERVE = 100_000;

    IScoreboard public immutable scoreboard;
    address public immutable quoter;

    /// @notice Gas cap for one leg (swap + hook callbacks). Monad charges the gas limit, so lower is cheaper.
    uint256 public legGasCap = 1_500_000;
    /// @notice Gas cap for one in-transaction Quoter call.
    uint256 public quoteGasCap = 1_500_000;
    /// @notice A leg is skipped if its in-tx quote is below advertisedOut by more than this (bps).
    uint16 public advTolBps = 50;

    // ------------------------------------------------------------------ events / errors
    /// reasons: 0 BLOCKED, 1 UNRATED_CAP, 2 QUOTE_FAILED, 3 BELOW_MIN_OUT, 4 ADVERTISED_MISMATCH
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
    event CapsSet(uint256 legGasCap, uint256 quoteGasCap, uint16 advTolBps);

    error DeadlinePassed();
    error BadRouteCount();
    error RouteTokenMismatch();
    error Shortfall(uint256 settledOut);
    error OnlySelf();
    error InsufficientGas();
    error CapOutOfBounds();

    constructor(IPoolManager poolManager_, address quoter_, IScoreboard scoreboard_, address owner_)
        SwapExecutor(poolManager_)
        Ownable(owner_)
    {
        quoter = quoter_;
        scoreboard = scoreboard_;
    }

    // ------------------------------------------------------------------ main entry
    /// @notice Swap `amountIn` of the routes' input token, trying each route in order until one honours its quote.
    /// @param routes 1..MAX_LEGS candidate pools, best quote first (from quote-api). All must share the same pair/direction.
    /// @param amountIn exact input; pulled from msg.sender (approve this router first)
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
    ) external nonReentrant returns (uint256 amountOut, int256 legIndex) {
        if (block.timestamp > deadline) revert DeadlinePassed();
        if (routes.length == 0 || routes.length > MAX_LEGS) revert BadRouteCount();
        (address tokenIn, address tokenOut) = _ends(routes);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        for (uint256 i = 0; i < routes.length; i++) {
            (bool filled, uint256 settled, uint256 used) = _attempt(routes[i], uint8(i), amountIn, minTotalOut);
            if (!filled) continue;

            IERC20(tokenOut).safeTransfer(recipient, settled);
            if (used < amountIn) IERC20(tokenIn).safeTransfer(msg.sender, amountIn - used);
            return (settled, int256(i));
        }

        // no route honoured its quote: refund everything; strikes written above persist
        IERC20(tokenIn).safeTransfer(msg.sender, amountIn);
        emit NoFill(msg.sender, amountIn);
        return (0, -1);
    }

    /// @notice Executes one leg and reverts with Shortfall(out) if the output is below `floor`.
    /// @dev Self-call only. Reverting here undoes the swap itself while the outer frame can still read the
    ///      settled amount from the revert data and write the strike.
    function executeLeg(Route calldata route, uint128 amountIn, uint256 floor)
        external
        returns (uint256 out, uint256 used)
    {
        if (msg.sender != address(this)) revert OnlySelf();
        (out, used) = _swapExactIn(
            Leg({key: route.key, zeroForOne: route.zeroForOne, hookData: route.hookData, amountIn: amountIn})
        );
        if (out < floor) revert Shortfall(out);
    }

    // ------------------------------------------------------------------ internals
    /// @dev Skip checks, quote, then execute one route. Returns filled=true only on a floor-honouring fill.
    function _attempt(Route calldata r, uint8 idx, uint128 amountIn, uint128 minTotalOut)
        private
        returns (bool filled, uint256 settled, uint256 used)
    {
        address hook = address(r.key.hooks);
        bytes32 pid = PoolId.unwrap(r.key.toId());

        Status st = scoreboard.statusOf(hook);
        if (st == Status.BLOCKED) {
            emit LegSkipped(pid, hook, 0);
            return (false, 0, 0);
        }
        if (st == Status.UNRATED && amountIn > scoreboard.unratedCap()) {
            emit LegSkipped(pid, hook, 1);
            return (false, 0, 0);
        }

        if (gasleft() < _needed(quoteGasCap)) revert InsufficientGas();
        (uint256 quotedOut,) = QuoteLib.tryQuote(quoter, quoteGasCap, r.key, r.zeroForOne, amountIn, r.hookData);
        if (quotedOut == 0) {
            emit LegSkipped(pid, hook, 2);
            return (false, 0, 0);
        }

        // Off-chain advertised quote vs in-tx quote. Not a strike: the market may simply have moved.
        if (r.advertisedOut != 0 && quotedOut < RouteLib.floorOf(r.advertisedOut, advTolBps)) {
            emit LegSkipped(pid, hook, 4);
            return (false, 0, 0);
        }

        uint256 floor = RouteLib.floorOf(quotedOut, scoreboard.toleranceBps(hook));
        if (floor < minTotalOut) {
            emit LegSkipped(pid, hook, 3);
            return (false, 0, 0);
        }

        if (gasleft() < _needed(legGasCap)) revert InsufficientGas();
        bool execFailed;
        (filled, settled, used, execFailed) = _tryLeg(r, amountIn, floor);

        if (filled) {
            if (hook != address(0)) scoreboard.recordFill(hook, pid, quotedOut, settled);
            emit Filled(pid, hook, msg.sender, used, quotedOut, settled, idx);
        } else {
            if (hook != address(0)) scoreboard.recordStrike(hook, pid, quotedOut, settled, execFailed);
            emit Rejected(pid, hook, quotedOut, settled, execFailed);
        }
    }

    /// @dev Capped-gas self-call to executeLeg. At most 68 bytes of return data are copied, so a hostile hook
    ///      cannot cause a return-data bomb. Any failure other than Shortfall is execFailed (settled = 0).
    function _tryLeg(Route calldata r, uint128 amountIn, uint256 floor)
        private
        returns (bool filled, uint256 settled, uint256 used, bool execFailed)
    {
        bytes memory data = abi.encodeCall(this.executeLeg, (r, amountIn, floor));
        (bool ok, bytes memory ret) = SafeCall.callCapped(address(this), legGasCap, data, LEG_RETURN_COPY);

        if (ok) {
            if (ret.length == 64) {
                (settled, used) = abi.decode(ret, (uint256, uint256));
                return (true, settled, used, false);
            }
            return (false, 0, 0, true);
        }
        if (ret.length == 36 && bytes4(ret) == Shortfall.selector) {
            assembly ("memory-safe") {
                settled := mload(add(ret, 0x24))
            }
            return (false, settled, 0, false);
        }
        return (false, 0, 0, true);
    }

    /// @dev Validates the route set and returns (tokenIn, tokenOut). Native currency is unsupported.
    function _ends(Route[] calldata routes) private pure returns (address tokenIn, address tokenOut) {
        tokenIn = Currency.unwrap(routes[0].zeroForOne ? routes[0].key.currency0 : routes[0].key.currency1);
        tokenOut = Currency.unwrap(routes[0].zeroForOne ? routes[0].key.currency1 : routes[0].key.currency0);
        if (tokenIn == address(0) || tokenOut == address(0)) revert NativeCurrencyUnsupported();
        for (uint256 i = 1; i < routes.length; i++) {
            Route calldata r = routes[i];
            address tIn = Currency.unwrap(r.zeroForOne ? r.key.currency0 : r.key.currency1);
            address tOut = Currency.unwrap(r.zeroForOne ? r.key.currency1 : r.key.currency0);
            if (tIn != tokenIn || tOut != tokenOut) revert RouteTokenMismatch();
        }
    }

    /// @dev gas that must be available so a capped call is really given its full cap (63/64 rule) plus a reserve.
    function _needed(uint256 cap) private pure returns (uint256) {
        return (cap * 64) / 63 + GAS_RESERVE;
    }

    // ------------------------------------------------------------------ owner
    /// @notice Tune gas caps from measured gas (docs/SPIKES.md) and the advertised-quote tolerance.
    function setCaps(uint256 legGasCap_, uint256 quoteGasCap_, uint16 advTolBps_) external onlyOwner {
        if (legGasCap_ < 100_000 || legGasCap_ > 5_000_000) revert CapOutOfBounds();
        if (quoteGasCap_ < 100_000 || quoteGasCap_ > 5_000_000) revert CapOutOfBounds();
        if (advTolBps_ > 1_000) revert CapOutOfBounds();
        legGasCap = legGasCap_;
        quoteGasCap = quoteGasCap_;
        advTolBps = advTolBps_;
        emit CapsSet(legGasCap_, quoteGasCap_, advTolBps_);
    }

    /// @notice Recover tokens sent here by mistake. nonReentrant, so it can never touch tokens mid-swap.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(to, amount);
    }
}
