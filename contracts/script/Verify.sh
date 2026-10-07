#!/usr/bin/env bash
# Verifies every deployed contract on MonadVision via Sourcify (command from docs.monad.xyz verify guide):
#   forge verify-contract <address> <contract_name> --chain 10143 --verifier sourcify \
#     --verifier-url https://sourcify-api-monad.blockvision.org/
# Writes ../deployments/.stage/verified.json (address -> "verified" | "failed"), which build-deployments.mjs merges
# into DEPLOYMENTS.md. A failure never aborts the run: verification status is reported honestly.
set -uo pipefail
cd "$(dirname "$0")/.."

VERIFIER_URL="https://sourcify-api-monad.blockvision.org/"
OUT="../deployments/.stage/verified.json"
LIST="$(node ../scripts/list-contracts.mjs)"   # lines: <address> <path:ContractName>

echo "{" > "$OUT"
FIRST=1
while read -r ADDR NAME; do
  [ -z "${ADDR:-}" ] && continue
  if forge verify-contract "$ADDR" "$NAME" --chain 10143 --verifier sourcify --verifier-url "$VERIFIER_URL" --watch; then
    STATUS="verified"
  else
    STATUS="failed"
  fi
  [ $FIRST -eq 0 ] && echo "," >> "$OUT"
  FIRST=0
  printf '  "%s": "%s"' "$ADDR" "$STATUS" >> "$OUT"
done <<< "$LIST"
echo "" >> "$OUT"
echo "}" >> "$OUT"
cat "$OUT"
