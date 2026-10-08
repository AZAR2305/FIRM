#!/usr/bin/env bash
# One command that rebuilds everything from scratch (the testnet can reset: spec 14.3).
#
#   cd contracts && ./script/Redeploy.sh
#
# In order: preflight (chain id, deployer balance against the gas budget) -> forge build -> Deploy (Scoreboard, FirmRouter,
# CanaryRunner, RawRouter, reporters wired) -> DeployFixtures (mock tokens, liquidity helper, quarantined fixture hooks at
# mined CREATE2 addresses) -> SeedPools (pools A to E plus G, R, Q) -> deployments/10143.json + DEPLOYMENTS.md (addresses,
# block numbers, tx hashes, ABIs) -> gas report -> Verify.sh.
#
# Env (a missing variable is read from ../.env, which is git-ignored):
#   DEPLOYER_ACCOUNT        Foundry keystore name (preferred; `cast wallet import firm-deployer --interactive`)
#   DEPLOYER_PRIVATE_KEY    testnet-only raw key (used if DEPLOYER_ACCOUNT is unset; never commit it)
#   DEPLOYER_ADDRESS        needed with a keystore account so the balance can be checked before anything is sent
#   MONAD_TESTNET_RPC_URL   RPC to use (default: first entry of MONAD_TESTNET_RPC_URLS, else the public RPC)
#   VERIFY=0                skip Verify.sh (default: run it; on a local fork it only prints what it would verify)
#   FIRM_GAS_SCALE_PCT      scale every explicit gas limit (default 100); raise it only to retry after an out-of-gas
#   MIN_BALANCE_MON         override the computed minimum balance
#   FIRM_RUN_ID             bytes32 that separates the CREATE2 addresses of repeated runs on one chain (default: random)
#
# Gas: Monad charges the gas LIMIT, not gas used. Every transaction has an explicit limit from script/GasLimits.sol
# (FORK-MEASURED, not Monad-measured), and the preflight sums them. A local RPC (anvil fork) is detected and switches to
# FIRM_FORK=1, so the outputs are the git-ignored *.fork.* files and can never be mistaken for the real deployment.
set -euo pipefail
cd "$(dirname "$0")/.."

# ---- read ../.env for variables that are not already set (the shell wins; no `source`, so nothing is executed)
if [ -f ../.env ]; then
  while IFS= read -r LINE || [ -n "$LINE" ]; do
    LINE="${LINE%$'\r'}"
    case "$LINE" in ''|'#'*) continue ;; esac
    KEY="${LINE%%=*}"; VAL="${LINE#*=}"
    [[ "$KEY" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    VAL="${VAL%%  #*}"; VAL="${VAL%"${VAL##*[![:space:]]}"}"
    if [ -z "${!KEY:-}" ] && [ -n "$VAL" ]; then export "$KEY=$VAL"; fi
  done < ../.env
fi

RPC="${MONAD_TESTNET_RPC_URL:-}"
if [ -z "$RPC" ] && [ -n "${MONAD_TESTNET_RPC_URLS:-}" ]; then RPC="${MONAD_TESTNET_RPC_URLS%%,*}"; fi
RPC="${RPC:-https://testnet-rpc.monad.xyz}"

fail() { echo "ERROR: $*" >&2; exit 1; }

# ---- local RPC <=> fork mode, so a fork run cannot overwrite (or be mistaken for) the real deployment
case "$RPC" in
  http://127.0.0.1*|http://localhost*|http://\[::1\]*)
    export FIRM_FORK=1 ;;
  *)
    [ "${FIRM_FORK:-0}" != "1" ] || fail "FIRM_FORK=1 but the RPC ($RPC) is not local. Unset FIRM_FORK for a real deployment." ;;
esac
FORK="${FIRM_FORK:-0}"
if [ "$FORK" = "1" ]; then
  echo "MODE: LOCAL FORK ($RPC). Outputs go to deployments/10143.fork.json and DEPLOYMENTS.fork.md (git-ignored)."
else
  echo "MODE: REAL MONAD TESTNET ($RPC). This sends transactions and spends MON."
fi

AUTH=()
if [ -n "${DEPLOYER_ACCOUNT:-}" ]; then
  AUTH=(--account "$DEPLOYER_ACCOUNT")
elif [ -n "${DEPLOYER_PRIVATE_KEY:-}" ]; then
  AUTH=(--private-key "$DEPLOYER_PRIVATE_KEY")
else
  fail "set DEPLOYER_ACCOUNT (keystore) or DEPLOYER_PRIVATE_KEY (testnet only), in the shell or in ../.env."
fi

# ---- preflight 1: right chain
CHAIN_ID="$(cast chain-id --rpc-url "$RPC")" || fail "cannot reach $RPC"
[ "$CHAIN_ID" = "10143" ] || fail "RPC reports chain id $CHAIN_ID, expected 10143 (Monad Testnet). Refusing to deploy."

# ---- preflight 2: the deployer can pay the gas LIMITS of every transaction (checked before anything is sent)
ADDR="${DEPLOYER_ADDRESS:-}"
if [ -n "${DEPLOYER_ACCOUNT:-}" ]; then
  [ -n "$ADDR" ] || ADDR="$(cast wallet address --account "$DEPLOYER_ACCOUNT")"
else
  # the address that pays is the one the key controls; a stale DEPLOYER_ADDRESS must not be checked instead
  KEY_ADDR="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
  if [ -n "$ADDR" ] && [ "$(echo "$ADDR" | tr 'A-F' 'a-f')" != "$(echo "$KEY_ADDR" | tr 'A-F' 'a-f')" ]; then
    fail "DEPLOYER_ADDRESS ($ADDR) is not the address of DEPLOYER_PRIVATE_KEY ($KEY_ADDR). Fix one of them."
  fi
  ADDR="$KEY_ADDR"
fi
[ -n "$ADDR" ] || fail "cannot determine the deployer address; set DEPLOYER_ADDRESS."

# On a fork the price is the fork's own (a few gwei and falling), which would understate the real cost, so a dry run prices the
# preflight at the live testnet's gas price when it can be read.
GAS_PRICE="$(cast gas-price --rpc-url "$RPC")"
PRICE_NOTE=""
if [ "$FORK" = "1" ]; then
  if LIVE_PRICE="$(cast gas-price --rpc-url https://testnet-rpc.monad.xyz 2>/dev/null)" && [ -n "$LIVE_PRICE" ]; then
    GAS_PRICE="$LIVE_PRICE"; PRICE_NOTE=" (live testnet price, read for the dry run)"
  fi
fi
SCALE="${FIRM_GAS_SCALE_PCT:-100}"
BUDGET="$(node ../scripts/gas-budget.mjs --gas-price-wei "$GAS_PRICE" --scale-pct "$SCALE" --json)"
NEED_MON="$(node -e 'const b=JSON.parse(process.argv[1]);console.log((Number(b.needWei)/1e18).toFixed(4))' "$BUDGET")"
BUDGET_GAS="$(node -e 'console.log(JSON.parse(process.argv[1]).gas)' "$BUDGET")"
NEED_MON="${MIN_BALANCE_MON:-$NEED_MON}"
BAL="$(cast balance "$ADDR" --rpc-url "$RPC" --ether)"
echo "preflight: deployer $ADDR"
echo "preflight: gas budget $BUDGET_GAS (sum of explicit gas limits, fork-measured) x gas price $((GAS_PRICE / 1000000000)) gwei$PRICE_NOTE + 25% buffer"
echo "preflight: needs about $NEED_MON MON, holds $BAL MON"
if ! awk -v b="$BAL" -v m="$NEED_MON" 'BEGIN { exit !(b + 0 >= m + 0) }'; then
  SHORT="$(awk -v b="$BAL" -v m="$NEED_MON" 'BEGIN { printf "%.4f", m - b }')"
  echo "" >&2
  echo "ERROR: deployer balance too low. Nothing was sent." >&2
  echo "  deployer : $ADDR" >&2
  echo "  holds    : $BAL MON" >&2
  echo "  needs    : about $NEED_MON MON (Monad charges the gas limit of every transaction)" >&2
  echo "  short by : $SHORT MON" >&2
  echo "Fund the deployer at https://faucet.monad.xyz (browser only) and run this again." >&2
  exit 1
fi
echo "preflight: OK"

# ---- build and deploy
mkdir -p ../deployments/.stage
rm -f ../deployments/.stage/*.json
rm -rf broadcast/Deploy.s.sol broadcast/DeployFixtures.s.sol broadcast/SeedPools.s.sol

if [ -z "${FIRM_RUN_ID:-}" ]; then FIRM_RUN_ID="$(cast keccak "firm-$(date +%s)-$RANDOM")"; fi
export FIRM_RUN_ID
echo "run id $FIRM_RUN_ID"

forge build

for S in Deploy DeployFixtures SeedPools; do
  echo "=== forge script $S ==="
  # --skip-simulation: without it Foundry replaces the limit of the FIRST transaction of a script with its own estimate
  # (checked: 59,385 instead of the 50,000 given). The script still runs in full on a local EVM before anything is sent.
  forge script "script/$S.s.sol:$S" --rpc-url "$RPC" "${AUTH[@]}" --broadcast --slow --skip-simulation
done

echo "=== deployments file ==="
node ../scripts/build-deployments.mjs

echo "=== gas: limits vs used (the limit is what Monad charges) ==="
node ../scripts/gas-report.mjs --gas-price-wei "$GAS_PRICE" --budget-gas "$BUDGET_GAS"

echo "=== verification ==="
if [ "${VERIFY:-1}" = "0" ]; then
  echo "skipped (VERIFY=0)"
elif [ "$FORK" = "1" ]; then
  DRY_RUN=1 ./script/Verify.sh
else
  ./script/Verify.sh
  node ../scripts/build-deployments.mjs
fi

if [ "$FORK" = "1" ]; then
  echo "Done (FORK). See ../deployments/10143.fork.json. Do not commit it."
else
  echo "Done. See ../deployments/10143.json and ../DEPLOYMENTS.md; commit both."
fi
