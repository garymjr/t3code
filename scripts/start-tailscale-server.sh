#!/usr/bin/env bash

set -euo pipefail

host="$(tailscale ip -4 | head -n 1)"
port="3773"

if [[ -z "$host" ]]; then
  echo "Failed to resolve a Tailscale IPv4 address." >&2
  exit 1
fi

bun run --cwd apps/server start -- --host "$host" --port "$port" --no-browser &
server_pid=$!
caffeinate_pid=""
interrupted="0"

cleanup() {
  if [[ -n "$caffeinate_pid" ]] && kill -0 "$caffeinate_pid" 2>/dev/null; then
    kill "$caffeinate_pid" 2>/dev/null || true
  fi
}

handle_interrupt() {
  interrupted="1"

  if kill -0 "$server_pid" 2>/dev/null; then
    kill -INT "$server_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap handle_interrupt INT

caffeinate -is -w "$server_pid" &
caffeinate_pid=$!

set +e
wait "$server_pid"
server_status=$?
set -e

wait "$caffeinate_pid" || true

if [[ "$interrupted" == "1" && "$server_status" -eq 130 ]]; then
  exit 0
fi

exit "$server_status"
