// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {V4Quoter} from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";

import {Scoreboard} from "../src/Scoreboard.sol";
import {FirmRouter} from "../src/FirmRouter.sol";
import {RawRouter} from "../src/RawRouter.sol";
import {CanaryRunner} from "../src/CanaryRunner.sol";
import {Route} from "../src/libraries/RouteLib.sol";
import {Status, Params} from "../src/interfaces/IScoreboard.sol";

import {MockToken} from "../test-fixtures/MockToken.sol";
import {FixtureLiquidityHelper} from "../test-fixtures/FixtureLiquidityHelper.sol";

/// @notice Shared harness: a real PoolManager and the real V4Quoter (from v4-periphery), our contracts, two mock
///         tokens, and helpers to mine-free hook placement (deployCodeTo) and pool seeding.
abstract contract BaseTest is Test {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 internal constant AFTER_SWAP_DELTA = Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
    uint160 internal constant BEFORE_SWAP = Hooks.BEFORE_SWAP_FLAG;
    int24 internal constant TICK_SPACING = 60;
    uint256 internal constant LIQUIDITY = 1e27;

    IPoolManager internal pm;
    IV4Quoter internal quoter;
    Scoreboard internal sb;
    FirmRouter internal router;
    RawRouter internal raw;
    CanaryRunner internal canary;
    FixtureLiquidityHelper internal lp;

    MockToken internal token0; // lower address
    MockToken internal token1;

    address internal user = address(0xBEEF);
    uint256 internal hookCounter;

    function setUp() public virtual {
        pm = _newPoolManager();
        quoter = _newQuoter(pm);
        sb = new Scoreboard(address(this));
        router = new FirmRouter(IPoolManager(address(pm)), address(quoter), sb, address(this));
        raw = new RawRouter(IPoolManager(address(pm)));
        canary = new CanaryRunner(IPoolManager(address(pm)), address(quoter), sb, address(this));
        lp = new FixtureLiquidityHelper(IPoolManager(address(pm)));
        sb.setReporter(address(router), true);
        sb.setReporter(address(canary), true);

        MockToken a = new MockToken("tUSD", "tUSD", address(this));
        MockToken b = new MockToken("tUSDC", "tUSDC", address(this));
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);

        // pool liquidity funding (owner mint is uncapped)
        token0.ownerMint(address(this), 1e30);
        token1.ownerMint(address(this), 1e30);
        token0.approve(address(lp), type(uint256).max);
        token1.approve(address(lp), type(uint256).max);

        // user funding + approvals
        token0.ownerMint(user, 1_000_000e18);
        token1.ownerMint(user, 1_000_000e18);
        vm.startPrank(user);
        token0.approve(address(router), type(uint256).max);
        token0.approve(address(raw), type(uint256).max);
        token0.approve(address(canary), type(uint256).max);
        token1.approve(address(router), type(uint256).max);
        vm.stopPrank();

        // demo-sized cap so 1,000-token swaps may route through UNRATED hooks (tests override where needed)
        Params memory p = sb.getParams();
        p.unratedCap = 10_000e18;
        sb.setParams(p);
    }

    // ---------------------------------------------------------------- overridable core (fork tests swap in the real ones)
    function _newPoolManager() internal virtual returns (IPoolManager) {
        return IPoolManager(address(new PoolManager(address(this))));
    }

    function _newQuoter(IPoolManager pm_) internal virtual returns (IV4Quoter) {
        return IV4Quoter(address(new V4Quoter(pm_)));
    }

    // ---------------------------------------------------------------- helpers
    function _hookAddress(uint160 flags) internal returns (address) {
        hookCounter++;
        return address((uint160(0xF100 + hookCounter) << 144) | flags);
    }

    function _deployHook(string memory artifact, bytes memory args, uint160 flags) internal returns (address hook) {
        hook = _hookAddress(flags);
        deployCodeTo(artifact, args, hook);
    }

    function _initPool(address hook, uint24 fee) internal returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: fee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
        pm.initialize(key, SQRT_PRICE_1_1);
        lp.addLiquidity(key, TickMath.minUsableTick(TICK_SPACING), TickMath.maxUsableTick(TICK_SPACING), LIQUIDITY);
    }

    function _route(PoolKey memory key) internal pure returns (Route memory r) {
        r.key = key;
        r.zeroForOne = true;
    }

    function _routes1(PoolKey memory a) internal pure returns (Route[] memory rs) {
        rs = new Route[](1);
        rs[0] = _route(a);
    }

    function _routes2(PoolKey memory a, PoolKey memory b) internal pure returns (Route[] memory rs) {
        rs = new Route[](2);
        rs[0] = _route(a);
        rs[1] = _route(b);
    }

    function _routes3(PoolKey memory a, PoolKey memory b, PoolKey memory c) internal pure returns (Route[] memory rs) {
        rs = new Route[](3);
        rs[0] = _route(a);
        rs[1] = _route(b);
        rs[2] = _route(c);
    }

    function _swap(Route[] memory rs, uint128 amountIn, uint128 minOut) internal returns (uint256 out, int256 leg) {
        vm.prank(user);
        return router.swapExactIn(rs, amountIn, minOut, user, uint64(block.timestamp + 1 hours));
    }

    function _poolId(PoolKey memory key) internal pure returns (bytes32) {
        return PoolId.unwrap(key.toId());
    }

    function _assertRouterEmpty() internal view {
        assertEq(token0.balanceOf(address(router)), 0, "router token0 dust");
        assertEq(token1.balanceOf(address(router)), 0, "router token1 dust");
    }
}
