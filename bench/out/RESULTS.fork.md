# FIRM benchmark results

> **LOCAL FORK RUN. These are NOT Monad Testnet measurements.** The RPC was a local anvil fork of testnet state: contract behaviour is real (the deployed PoolManager and V4Quoter), but gas follows Ethereum rules, not Monad's repriced schedule, and block/timing numbers are meaningless. The testnet run replaces this file (`pnpm bench`).

| | |
|---|---|
| Generated | 2026-10-07T05:56:50.207Z |
| Commit | `8e0e42f7a8412fd1157da31bd5dc5c2b404d6c1c (+ uncommitted changes)` |
| Chain id | 10143 |
| Blocks | 68892965 to 68892965 |
| Trials per arm | 20 |
| Transactions sent | 0 |
| Duration | 2 s |
| Bench wallet (deployer / owner) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Scoreboard | `0x04f1A5b9BD82a5020C49975ceAd160E98d8B77Af` |
| FirmRouter | `0xde79380FBd39e08150adAA5C6c9dE3146f53029e` |
| RawRouter (unprotected comparator) | `0x38F6F2caE52217101D7CA2a5eC040014b4164E6C` |
| CanaryRunner | `0xbFD3c8A956AFB7a9754C951D03C9aDdA7EC5d638` |

## What this does and does not show

- The hooks under test are **our own quarantined fixtures** (`contracts/test-fixtures`). Catching them shows the mechanism works; it does not show that real malicious hooks in the field are caught.
- Between trials the bench owner **reinstates** a BLOCKED hook so each trial is a first encounter. In steady state a blocked hook is skipped, not retried.
- Numbers are reported as measured, including unfavourable ones. Nothing is rounded in our favour.

## Formulas

```
shortfall_bps          = max(0, quoted - settled) * 10000 / quoted
loss_vs_quote_bps      = shortfall_bps of the leg that actually paid the user
loss_vs_best_honest    = (best honest quote - received) / best honest quote * 10000
catch_rate             = strikes_recorded / deviating_executions_attempted
false_positive_rate    = strikes_on_honest_hook / total_honest_executions
```

## B1. FAILED

_Skipped: error: The contract function "balanceOf" returned no data ("0x").

This could be due to any of the following:
  - The contract does not have the function "balanceOf",
  - The parameters passed to the contract function may be invalid, or
  - The address is not a contract.
 
Contract Call:
  address:   0xd9abC93F81394Bd161a1b24B03518e0a570bDEAd
  function:  balanceOf(address a)
  args:               (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)

Docs: https://viem.sh/docs/contract/readContract
Version: viem@2.57.3_

## B2. FAILED

_Skipped: error: The contract function "balanceOf" returned no data ("0x").

This could be due to any of the following:
  - The contract does not have the function "balanceOf",
  - The parameters passed to the contract function may be invalid, or
  - The address is not a contract.
 
Contract Call:
  address:   0xd9abC93F81394Bd161a1b24B03518e0a570bDEAd
  function:  balanceOf(address a)
  args:               (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)

Docs: https://viem.sh/docs/contract/readContract
Version: viem@2.57.3_

## B3. FAILED

_Skipped: error: The contract function "balanceOf" returned no data ("0x").

This could be due to any of the following:
  - The contract does not have the function "balanceOf",
  - The parameters passed to the contract function may be invalid, or
  - The address is not a contract.
 
Contract Call:
  address:   0xd9abC93F81394Bd161a1b24B03518e0a570bDEAd
  function:  balanceOf(address a)
  args:               (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)

Docs: https://viem.sh/docs/contract/readContract
Version: viem@2.57.3_

## B4. FAILED

_Skipped: error: The contract function "balanceOf" returned no data ("0x").

This could be due to any of the following:
  - The contract does not have the function "balanceOf",
  - The parameters passed to the contract function may be invalid, or
  - The address is not a contract.
 
Contract Call:
  address:   0xd9abC93F81394Bd161a1b24B03518e0a570bDEAd
  function:  balanceOf(address a)
  args:               (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)

Docs: https://viem.sh/docs/contract/readContract
Version: viem@2.57.3_

## B5. FAILED

_Skipped: error: The contract function "balanceOf" returned no data ("0x").

This could be due to any of the following:
  - The contract does not have the function "balanceOf",
  - The parameters passed to the contract function may be invalid, or
  - The address is not a contract.
 
Contract Call:
  address:   0xd9abC93F81394Bd161a1b24B03518e0a570bDEAd
  function:  balanceOf(address a)
  args:               (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)

Docs: https://viem.sh/docs/contract/readContract
Version: viem@2.57.3_

## B6. FAILED

_Skipped: error: The contract function "balanceOf" returned no data ("0x").

This could be due to any of the following:
  - The contract does not have the function "balanceOf",
  - The parameters passed to the contract function may be invalid, or
  - The address is not a contract.
 
Contract Call:
  address:   0xd9abC93F81394Bd161a1b24B03518e0a570bDEAd
  function:  balanceOf(address a)
  args:               (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)

Docs: https://viem.sh/docs/contract/readContract
Version: viem@2.57.3_

## B7. Dashboard latency

_Skipped: ENVIO_GRAPHQL_URL is not set: no indexer to measure._

## B8. FAILED

_Skipped: error: The contract function "balanceOf" returned no data ("0x").

This could be due to any of the following:
  - The contract does not have the function "balanceOf",
  - The parameters passed to the contract function may be invalid, or
  - The address is not a contract.
 
Contract Call:
  address:   0xd9abC93F81394Bd161a1b24B03518e0a570bDEAd
  function:  balanceOf(address a)
  args:               (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)

Docs: https://viem.sh/docs/contract/readContract
Version: viem@2.57.3_
