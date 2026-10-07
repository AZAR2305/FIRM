// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title SafeCall
/// @notice Gas-capped low-level calls that copy at most `maxCopy` bytes of return data, so a hostile
///         callee cannot cause a return-data bomb in the caller.
library SafeCall {
    function callCapped(address target, uint256 gasCap, bytes memory data, uint256 maxCopy)
        internal
        returns (bool ok, bytes memory ret)
    {
        assembly ("memory-safe") {
            ok := call(gasCap, target, 0, add(data, 0x20), mload(data), 0, 0)
            let size := returndatasize()
            if gt(size, maxCopy) { size := maxCopy }
            ret := mload(0x40)
            mstore(ret, size)
            returndatacopy(add(ret, 0x20), 0, size)
            mstore(0x40, and(add(add(ret, add(size, 0x20)), 0x1f), not(0x1f)))
        }
    }
}
