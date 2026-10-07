#!/usr/bin/env bash
# Run an anvil fork of Monad Testnet inside WSL 2, so that Envio (also in WSL) and the Windows-side tools can both reach
# it: WSL forwards its listeners to Windows `localhost`, while the reverse direction is blocked by the Windows firewall.
#
#   wsl -d Ubuntu -- bash /mnt/c/Users/<you>/FIRM/scripts/wsl-anvil.sh [start|stop|status]
#
# Foundry is installed under ~/.foundry on first use (no sudo).
set -euo pipefail

export PATH="$HOME/.foundry/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PORT="${ANVIL_PORT:-8546}"
FORK_URL="${FORK_URL:-https://testnet-rpc.monad.xyz}"
LOG="$HOME/anvil-fork.log"
PIDFILE="$HOME/anvil-fork.pid"

install_foundry() {
  if [ ! -x "$HOME/.foundry/bin/anvil" ]; then
    echo "installing Foundry into ~/.foundry"
    curl -fsSL https://foundry.paradigm.xyz | bash
    "$HOME/.foundry/bin/foundryup"
  fi
}

case "${1:-start}" in
  start)
    install_foundry
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "already running (pid $(cat "$PIDFILE"))"; exit 0; fi
    nohup anvil --fork-url "$FORK_URL" --host 0.0.0.0 --port "$PORT" --silent > "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 60); do
      if curl -s -m 2 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "http://127.0.0.1:$PORT" | grep -q result; then
        echo "anvil fork up on :$PORT (pid $(cat "$PIDFILE"))"; exit 0
      fi
      sleep 2
    done
    echo "anvil did not come up; see $LOG" >&2; exit 1 ;;
  stop)
    if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; echo stopped; else echo "not running"; fi ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "running (pid $(cat "$PIDFILE"))"; else echo "not running"; fi ;;
  *) echo "usage: wsl-anvil.sh [start|stop|status]" >&2; exit 2 ;;
esac
