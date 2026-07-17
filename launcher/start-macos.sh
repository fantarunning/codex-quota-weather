#!/bin/sh
set -eu
unset CDPATH

LAUNCHER_DIR=$(cd "$(dirname "$0")" && pwd -P)
INSTALL_ROOT=$(cd "$LAUNCHER_DIR/.." && pwd -P)
NODE="$INSTALL_ROOT/runtime/node/bin/node"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/CodexQuotaWeather.log"

if [ ! -x "$NODE" ]; then
  echo "Private Node.js runtime is missing: $NODE" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
nohup "$NODE" "$LAUNCHER_DIR/launcher.js" >>"$LOG_FILE" 2>&1 &
