// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice TESTNET FIXTURE. Mock 18-decimal stable (tUSD / tUSDC). Public mint is capped per call so the demo
///         and agents can fund themselves; the owner can mint without a cap to seed pool liquidity.
contract MockToken is ERC20, Ownable {
    uint256 public constant MAX_PUBLIC_MINT = 10_000e18;

    error MintCapExceeded();

    constructor(string memory name_, string memory symbol_, address owner_) ERC20(name_, symbol_) Ownable(owner_) {}

    function mint(address to, uint256 amount) external {
        if (amount > MAX_PUBLIC_MINT) revert MintCapExceeded();
        _mint(to, amount);
    }

    function ownerMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
