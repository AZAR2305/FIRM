#!/usr/bin/env bash
# Simulates Envio Cloud's build of ./envio in a clean directory under WSL: pnpm 10.32.0 (the version Envio's docs name), no lockfile from us, then
# codegen and a type check. Run it before you push to the Envio deployment branch.
#
#   wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-envio-sim-check.sh
#
# It cannot prove the cloud build passes (we have no access to it), only that the project installs, generates and type-checks from scratch.
set -euo pipefail
export PATH="$HOME/tools/node/bin:/usr/local/bin:/usr/bin:/bin"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIM="$HOME/envio-cloud-sim"
PNPM="npx -y pnpm@10.32.0"

rm -rf "$SIM" && mkdir -p "$SIM"
(cd "$REPO/envio" && tar --exclude=node_modules --exclude=generated --exclude=.envio --exclude=build --exclude=package-lock.json -cf - .) | (cd "$SIM" && tar -xf -)
cd "$SIM"
echo "node $(node --version), pnpm $($PNPM --version)"
$PNPM install --no-frozen-lockfile > install.log 2>&1 || { tail -20 install.log; exit 1; }
echo "installed envio $(node -e 'console.log(require("./node_modules/envio/package.json").version)')"
$PNPM exec envio codegen > codegen.log 2>&1 || { tail -20 codegen.log; exit 1; }
# this Envio version writes .envio/ and envio-env.d.ts (older ones wrote generated/)
if [ -d .envio ] && [ -f envio-env.d.ts ]; then echo "codegen produced .envio/ and envio-env.d.ts"; elif [ -d generated ]; then echo "codegen produced generated/"; else echo "codegen produced no output"; cat codegen.log | tail -20; exit 1; fi
$PNPM exec tsc --noEmit && echo "tsc: ok"
echo "OK: the envio/ folder installs, generates and type-checks from a clean directory with pnpm."
