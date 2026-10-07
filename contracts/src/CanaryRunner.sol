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

import {IScoreboard} from "./interfaces/IScoreboard.sol";
import {ProbeSender} from "./ProbeSender.sol";
import {Route} from "./libraries/RouteLib.sol";

/// @title CanaryRunner
/// @notice Permissionless onchain probe. Performs the same quote-versus-fill check as FirmRouter but from
///         rotating sender contracts (ProbeSender indices), so evidence against sender-aware hooks is computed
///         onchain and the keeper agent is only a trigger. The caller supplies the dust and gets the output back.
contract CanaryRunner is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;
    address public immutable quoter;
    IScoreboard public immutable scoreboard;

    uint256 public legGasCap = 700_000;
    uint256 public quoteGasCap = 700_000;

    event ProbeDone(
        bytes32 indexed poolId,
        address indexed hook,
        address indexed probeSender,
        uint128 amountIn,
        uint256 quotedOut,
        uint256 settledOut
    );
    event ProbeSenderDeployed(uint8 indexed idx, address sender);
    event CapsSet(uint256 legGasCap, uint256 quoteGasCap);

    error CapOutOfBounds();
    error NativeCurrencyUnsupported();
    error InsufficientGas();

    constructor(IPoolManager poolManager_, address quoter_, IScoreboard scoreboard_, address owner_)
        Ownable(owner_)
    {
        poolManager = poolManager_;
        quoter = quoter_;
        scoreboard = scoreboard_;
    }

    /// @notice Probe `route` with `amountIn` of dust, as sender identity `senderIdx`.
    /// @return quotedOut in-tx quote (0 means the quote failed; nothing was executed or recorded)
    /// @return settledOut what the swap really delivered (returned to the caller)
    function probe(Route calldata route, uint128 amountIn, uint8 senderIdx)
        external
        nonReentrant
        returns (uint256 quotedOut, uint256 settledOut)
    {
        address tokenIn = Currency.unwrap(route.zeroForOne ? route.key.currency0 : route.key.currency1);
        address tokenOut = Currency.unwrap(route.zeroForOne ? route.key.currency1 : route.key.currency0);
        if (tokenIn == address(0) || tokenOut == address(0)) revert NativeCurrencyUnsupported();
        if (gasleft() < ((quoteGasCap + legGasCap) * 64) / 63 + 150_000) revert InsufficientGas();

        ProbeSender ps = _senderFor(senderIdx);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(ps), amountIn);

        (quotedOut, settledOut) = ps.run(route, amountIn, quoteGasCap, legGasCap);

        // forward everything the probe sender returned to us (output + any unused input)
        uint256 outBal = IERC20(tokenOut).balanceOf(address(this));
        if (outBal > 0) IERC20(tokenOut).safeTransfer(msg.sender, outBal);
        uint256 inBal = IERC20(tokenIn).balanceOf(address(this));
        if (inBal > 0) IERC20(tokenIn).safeTransfer(msg.sender, inBal);

        address hook = address(route.key.hooks);
        bytes32 pid = PoolId.unwrap(route.key.toId());
        emit ProbeDone(pid, hook, address(ps), amountIn, quotedOut, settledOut);

        // quote failed => no evidence either way; hookless pools are never written to the Scoreboard
        if (quotedOut != 0 && hook != address(0)) {
            scoreboard.recordProbe(hook, pid, address(ps), amountIn, quotedOut, settledOut);
        }
    }

    /// @notice Deterministic address of probe sender `idx` (deployed lazily on first use).
    function probeSenderAddress(uint8 idx) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(uint256(idx)), keccak256(_initCode()))
        );
        return address(uint160(uint256(hash)));
    }

    function setCaps(uint256 legGasCap_, uint256 quoteGasCap_) external onlyOwner {
        if (legGasCap_ < 100_000 || legGasCap_ > 5_000_000) revert CapOutOfBounds();
        if (quoteGasCap_ < 100_000 || quoteGasCap_ > 5_000_000) revert CapOutOfBounds();
        legGasCap = legGasCap_;
        quoteGasCap = quoteGasCap_;
        emit CapsSet(legGasCap_, quoteGasCap_);
    }

    function _senderFor(uint8 idx) private returns (ProbeSender) {
        address predicted = probeSenderAddress(idx);
        if (predicted.code.length == 0) {
            ProbeSender deployed = new ProbeSender{salt: bytes32(uint256(idx))}(poolManager, quoter, address(this));
            assert(address(deployed) == predicted);
            emit ProbeSenderDeployed(idx, predicted);
        }
        return ProbeSender(predicted);
    }

    function _initCode() private view returns (bytes memory) {
        return abi.encodePacked(type(ProbeSender).creationCode, abi.encode(poolManager, quoter, address(this)));
    }
}
