// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {BaseTest} from "./Base.t.sol";
import {Route} from "../src/libraries/RouteLib.sol";
import {Status, HookStats} from "../src/interfaces/IScoreboard.sol";

/// @notice Stateful invariants (spec 8.10) driven by random swaps over hookless, honest, spoofing and gas-grief pools.
///         The test contract itself is the invariant handler: `handlerSwap` is the only fuzzed entry point.
contract InvariantsTest is BaseTest {
    PoolKey[] keys; // 0 hookless, 1 honest, 2 context-spoofing, 3 gas-grief
    address[] hooks;
    uint256 constant N = 4;

    // ghost state
    bool contextHookFilled;
    bool strikesDecreased;
    bool blockedLeft;
    bool accountingBroken;
    uint32[N] lastStrikes;
    bool[N] everBlocked;
    uint256 public swaps;

    function setUp() public override {
        super.setUp();
        IPoolManager ipm = IPoolManager(address(pm));
        keys.push(_initPool(address(0), 2500));
        hooks.push(address(0));

        address honest = _deployHook("FixtureHooks.sol:FixtureHonestHook", abi.encode(ipm, 13), AFTER_SWAP_DELTA);
        keys.push(_initPool(honest, 500));
        hooks.push(honest);

        address ctx = _deployHook(
            "FixtureHooks.sol:FixtureContextHook", abi.encode(ipm, address(quoter), 1800), AFTER_SWAP_DELTA
        );
        keys.push(_initPool(ctx, 1000));
        hooks.push(ctx);

        address grief =
            _deployHook("FixtureHooks.sol:FixtureGasGriefHook", abi.encode(ipm, address(quoter)), BEFORE_SWAP);
        keys.push(_initPool(grief, 3000));
        hooks.push(grief);

        targetContract(address(this));
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = this.handlerSwap.selector;
        targetSelector(FuzzSelector({addr: address(this), selectors: sels}));
    }

    /// @dev random amount, random subset and order of up to 4 distinct pools
    function handlerSwap(uint256 amountSeed, uint256 orderSeed, uint8 count) public {
        uint128 amount = uint128(bound(amountSeed, 1e15, 3000e18));
        uint256 n = bound(count, 1, N);

        Route[] memory rs = new Route[](n);
        uint256[] memory idx = new uint256[](n);
        uint256 used; // bitmask of pools already in the list
        for (uint256 i = 0; i < n; i++) {
            uint256 pick = (orderSeed >> (i * 8)) % N;
            while (used & (1 << pick) != 0) pick = (pick + 1) % N;
            used |= 1 << pick;
            idx[i] = pick;
            rs[i] = _route(keys[pick]);
        }

        uint256 u0 = token0.balanceOf(user);
        uint256 u1 = token1.balanceOf(user);
        (uint256 out, int256 leg) = _swap(rs, amount, 0);
        swaps++;

        // accounting is exact: either (amount in, out out) or nothing moved
        if (leg >= 0) {
            if (u0 - token0.balanceOf(user) != amount || token1.balanceOf(user) - u1 != out || out == 0) {
                accountingBroken = true;
            }
            if (idx[uint256(leg)] == 2) contextHookFilled = true;
        } else if (token0.balanceOf(user) != u0 || token1.balanceOf(user) != u1) {
            accountingBroken = true;
        }

        // reputation properties
        for (uint256 i = 0; i < N; i++) {
            if (hooks[i] == address(0)) continue;
            HookStats memory s = sb.stats(hooks[i]);
            if (s.strikes < lastStrikes[i]) strikesDecreased = true;
            lastStrikes[i] = s.strikes;
            if (s.status == Status.BLOCKED) everBlocked[i] = true;
            else if (everBlocked[i]) blockedLeft = true;
        }
    }

    function invariant_routerHoldsNothing() public view {
        _assertRouterEmpty();
    }

    function invariant_userAccountingIsExact() public view {
        assertFalse(accountingBroken, "user balances moved by something other than (amountIn, out) or nothing");
    }

    function invariant_contextSpoofingHookNeverFills() public view {
        assertFalse(contextHookFilled, "an 18% hidden-fee pool must never be the filled leg");
    }

    function invariant_strikesNeverDecrease() public view {
        assertFalse(strikesDecreased);
    }

    function invariant_blockedOnlyLeavesViaReinstate() public view {
        assertFalse(blockedLeft);
    }

    function invariant_noValueStuckInPoolManagerAccountingForRouter() public view {
        // the router owes nothing and is owed nothing once a call has returned
        assertEq(token0.balanceOf(address(router)) + token1.balanceOf(address(router)), 0);
    }
}
