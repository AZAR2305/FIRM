#!/usr/bin/env bash
# Run Envio under WSL 2 (Envio does not run on native Windows).
#
#   wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-envio.sh <command...>
#   e.g.  ... wsl-envio.sh codegen | install | dev | dev-bg | logs [n] | stop | start | exec <shell command in the synced envio dir>
#
# It (1) puts a Node >= 22.15 first on PATH (installed under ~/tools/node, see below), (2) syncs ./envio from the Windows
# checkout into the Linux home (~/firm-envio) so npm and the generated code use the fast Linux filesystem and Linux
# binaries, and (3) runs the command there. A clean PATH is used on purpose: the inherited Windows PATH contains entries
# with spaces that break non-interactive shells.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$HOME/firm-envio"
NODE_VERSION="${NODE_VERSION:-22.20.0}"

export PATH="$HOME/tools/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/mnt/c/Program Files/Docker/Docker/resources/bin"

if [ ! -x "$HOME/tools/node/bin/node" ]; then
  echo "installing Node $NODE_VERSION into ~/tools/node"
  mkdir -p "$HOME/tools" && cd "$HOME/tools"
  curl -fsSL -o node.tar.xz "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
  tar -xJf node.tar.xz && mv "node-v$NODE_VERSION-linux-x64" node && rm node.tar.xz
fi

mkdir -p "$WORK"
# copy sources, never node_modules / generated output
( cd "$REPO/envio" && tar --exclude=node_modules --exclude=generated --exclude=.envio --exclude=build -cf - . ) | ( cd "$WORK" && tar -xf - )
cd "$WORK"

# Optional overlay for local forks: ENVIO_DEPLOYMENTS=<deployments json> [ENVIO_RPC=<rpc url>] rewrites the synced
# copy of config.yaml (never the checkout) with that deployment's addresses and RPC.
if [ -n "${ENVIO_DEPLOYMENTS:-}" ]; then
  node "$REPO/scripts/gen-indexer-config.mjs" --deployments "$ENVIO_DEPLOYMENTS" --config "$WORK/config.yaml" --out "$WORK/config.yaml" ${ENVIO_RPC:+--rpc "$ENVIO_RPC"}
elif [ -n "${ENVIO_RPC:-}" ]; then
  node "$REPO/scripts/gen-indexer-config.mjs" --rpc-only --config "$WORK/config.yaml" --out "$WORK/config.yaml" --rpc "$ENVIO_RPC"
fi

# ENVIO_START_BLOCK=<n> overrides start_block in the synced copy (e.g. a recent block, to try HyperSync without a full backfill)
if [ -n "${ENVIO_START_BLOCK:-}" ]; then sed -i "s/start_block: [0-9]*/start_block: $ENVIO_START_BLOCK/" "$WORK/config.yaml"; fi

cmd="${1:-codegen}"
shift || true
case "$cmd" in
  install) npm install --no-audit --no-fund ;;
  codegen) [ -d node_modules ] || npm install --no-audit --no-fund; npx envio codegen ;;
  dev)     [ -d node_modules ] || npm install --no-audit --no-fund; npx envio dev "$@" ;;
  start)   [ -d node_modules ] || npm install --no-audit --no-fund; npx envio start "$@" ;;
  dev-bg)  # detached: the dev stack (Postgres + Hasura in Docker, the indexer, GraphQL on :8080) keeps running after this returns
           [ -d node_modules ] || npm install --no-audit --no-fund
           : > "$HOME/envio-dev.log"
           # setsid: a new session, so the indexer is not torn down with this (short-lived) WSL invocation
           TUI_OFF=true setsid nohup npx envio dev --restart > "$HOME/envio-dev.log" 2>&1 < /dev/null &
           echo $! > "$HOME/envio-dev.pid"
           # stay attached until indexing has started (or failed), so the distro cannot idle out underneath it
           for _ in $(seq 1 90); do
             if grep -q "Starting indexing" "$HOME/envio-dev.log" 2>/dev/null; then echo "envio dev up (pid $(cat "$HOME/envio-dev.pid")), log: ~/envio-dev.log"; exit 0; fi
             if grep -q "ERROR" "$HOME/envio-dev.log" 2>/dev/null; then echo "envio dev failed to start:"; tail -n 12 "$HOME/envio-dev.log"; exit 1; fi
             sleep 2
           done
           echo "envio dev still starting; see ~/envio-dev.log" ;;
  logs)    tail -n "${1:-60}" "$HOME/envio-dev.log" ;;
  loggrep) grep -E "${1:?pattern}" "$HOME/envio-dev.log" | tail -n "${2:-20}" ;;
  config)  cat config.yaml ;;
  stop)    npx envio stop 2>&1 || true
           [ -f "$HOME/envio-dev.pid" ] && kill "$(cat "$HOME/envio-dev.pid")" 2>/dev/null || true; rm -f "$HOME/envio-dev.pid"
           pkill -f "node_modules/.bin/envio" 2>/dev/null || true; pkill -f "node_modules/envio" 2>/dev/null || true
           # `envio stop` can leave the compose containers up; stop exactly the two it creates (never anything else)
           docker stop generated-graphql-engine-1 generated-envio-postgres-1 >/dev/null 2>&1 || true
           sleep 2 ;;
  exec)    bash -c "$*" ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
