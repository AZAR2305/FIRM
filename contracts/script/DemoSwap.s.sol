// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Uses the quarantined testnet fixtures. Testnet only.

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {FirmRouter} from "../src/FirmRouter.sol";
import {RawRouter} from "../src/RawRouter.sol";
import {Scoreboard} from "../src/Scoreboard.sol";
import {Route} from "../src/libraries/RouteLib.sol";
import {HookStats} from "../src/interfaces/IScoreboard.sol";
import {IV4QuoterLite} from "../src/interfaces/IV4QuoterLite.sol";
import {MockToken} from "../test-fixtures/MockToken.sol";
import {Config} from "./Config.sol";
import {GasLimits} from "./GasLimits.sol";

/// @notice The headline demo, scripted. Same 1,000 tUSD trade through the unprotected RawRouter (picks the best
///         quote, Pool B, and eats the hidden fee) and through FirmRouter with routes [B, C, A] (rejects B, strikes
///         it, fills C). Reads addresses from deployments/10143.json.
///   forge script script/DemoSwap.s.sol --rpc-url $RPC --account $ACCOUNT --broadcast --slow
contract DemoSwap is Script {
    string internal j;

    function run() external {
        j = vm.readFile(vm.envOr("FIRM_DEPLOYMENTS_PATH", string("../deployments/10143.json")));
        FirmRouter firm = FirmRouter(vm.parseJsonAddress(j, ".core.firmRouter.address"));
        RawRouter raw = RawRouter(vm.parseJsonAddress(j, ".core.rawRouter.address"));
        Scoreboard sb = Scoreboard(vm.parseJsonAddress(j, ".core.scoreboard.address"));
        MockToken tUSD = MockToken(vm.parseJsonAddress(j, ".fixtures.tUSD.address"));
        bool z = vm.parseJsonBool(j, ".pools.zeroForOne");
        MockToken tokenOut = MockToken(vm.parseJsonAddress(j, ".fixtures.tUSDC.address"));

        PoolKey memory a = _key("A");
        PoolKey memory b = _key("B");
        PoolKey memory c = _key("C");
        uint128 amount = 1000e18;

        console2.log("quote A", _quote(a, z, amount));
        console2.log("quote C", _quote(c, z, amount));
        uint256 qB = _quote(b, z, amount);
        console2.log("quote B (best)", qB);

        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        tUSD.mint{gas: GasLimits.PUBLIC_MINT}(me, 3000e18);
        tUSD.approve{gas: GasLimits.APPROVE}(address(raw), type(uint256).max);
        tUSD.approve{gas: GasLimits.APPROVE}(address(firm), type(uint256).max);

        // 1) naive router trusts the best quote
        uint256 before = tokenOut.balanceOf(me);
        raw.swapExactInRaw{gas: GasLimits.RAW_SWAP}(_route(b, z), amount, 0, me);
        uint256 rawOut = tokenOut.balanceOf(me) - before;

        // 2) FIRM: [B, C, A]
        Route[] memory rs = new Route[](3);
        rs[0] = _route(b, z);
        rs[1] = _route(c, z);
        rs[2] = _route(a, z);
        before = tokenOut.balanceOf(me);
        (uint256 firmOut, int256 leg) = firm.swapExactIn{gas: GasLimits.FIRM_SWAP}(
            rs, amount, 0, me, uint64(block.timestamp + 1 hours)
        );
        vm.stopBroadcast();

        console2.log("RAW  router received", rawOut);
        console2.log("FIRM router received", firmOut);
        console2.log("FIRM filled leg index", uint256(leg));
        console2.log("tokens saved by FIRM", firmOut - rawOut);
        HookStats memory s = sb.stats(address(b.hooks));
        console2.log("Pool B hook strikes", s.strikes);
        console2.log("Pool B hook status (0 UNRATED,1 NORMAL,2 WATCH,3 BLOCKED)", uint8(s.status));
    }

    function _key(string memory n) internal view returns (PoolKey memory) {
        string memory p = string.concat(".pools.list.", n);
        return PoolKey({
            currency0: Currency.wrap(vm.parseJsonAddress(j, ".pools.currency0")),
            currency1: Currency.wrap(vm.parseJsonAddress(j, ".pools.currency1")),
            fee: uint24(vm.parseJsonUint(j, string.concat(p, ".fee"))),
            tickSpacing: 60,
            hooks: IHooks(vm.parseJsonAddress(j, string.concat(p, ".hook")))
        });
    }

    function _route(PoolKey memory k, bool z) internal pure returns (Route memory r) {
        r.key = k;
        r.zeroForOne = z;
    }

    function _quote(PoolKey memory k, bool z, uint128 amount) internal returns (uint256 q) {
        (q,) = IV4QuoterLite(Config.V4_QUOTER).quoteExactInputSingle(
            IV4QuoterLite.QuoteExactSingleParams({poolKey: k, zeroForOne: z, exactAmount: amount, hookData: ""})
        );
    }
}
