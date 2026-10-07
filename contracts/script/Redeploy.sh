#!/usr/bin/env bash
# One command that rebuilds everything from scratch (the testnet can reset: spec 14.3).
#
#   cd contracts && ./script/Redeploy.sh
#
# Env:
#   MONAD_TESTNET_RPC_URL   RPC to use (default: first entry of MONAD_TESTNET_RPC_URLS, else the public QuickNode RPC)
#   DEPLOYER_ACCOUNT        Foundry keystore name (preferred; `cast wallet import firm-deployer --interactive`)
#   DEPLOYER_PRIVATE_KEY    testnet-only raw key (used if DEPLOYER_ACCOUNT is unset; never commit it)
#   VERIFY=1                also verify every contract on MonadVision (Sourcify) after deployment
#
# Gas: Monad charges the gas LIMIT, not gas used, so the estimate multiplier is kept tight (120%).
set -euo pipefail
cd "$(dirname "$0")/.."

RPC="${MONAD_TESTNET_RPC_URL:-}"
if [ -z "$RPC" ] && [ -n "${MONAD_TESTNET_RPC_URLS:-}" ]; then RPC="${MONAD_TESTNET_RPC_URLS%%,*}"; fi
RPC="${RPC:-https://testnet-rpc.monad.xyz}"

AUTH=()
if [ -n "${DEPLOYER_ACCOUNT:-}" ]; then
  AUTH=(--account "$DEPLOYER_ACCOUNT")
elif [ -n "${DEPLOYER_PRIVATE_KEY:-}" ]; then
  AUTH=(--private-key "$DEPLOYER_PRIVATE_KEY")
else
  echo "Set DEPLOYER_ACCOUNT (keystore) or DEPLOYER_PRIVATE_KEY (testnet only)." >&2
  exit 1
fi

CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
if [ "$CHAIN_ID" != "10143" ]; then
  echo "RPC reports chain id $CHAIN_ID, expected 10143 (Monad Testnet). Refusing to deploy." >&2
  exit 1
fi

mkdir -p ../deployments/.stage
rm -f ../deployments/.stage/*.json

forge build

for S in Deploy DeployFixtures SeedPools; do
  echo "=== forge script $S ==="
  forge script "script/$S.s.sol:$S" --rpc-url "$RPC" "${AUTH[@]}" \
    --broadcast --slow --gas-estimate-multiplier 120
done

node ../scripts/build-deployments.mjs

if [ "${VERIFY:-0}" = "1" ]; then
  ./script/Verify.sh
  node ../scripts/build-deployments.mjs
fi

echo "Done. See ../deployments/10143.json and ../DEPLOYMENTS.md"
