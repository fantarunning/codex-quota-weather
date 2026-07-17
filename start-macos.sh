#!/bin/sh
set -eu
unset CDPATH

APP_DIR=$(cd "$(dirname "$0")" && pwd -P)
ELECTRON="$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/CodexQuotaWeather.log"

if [ ! -x "$ELECTRON" ]; then
  echo "Electron runtime is missing: $ELECTRON" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
nohup "$ELECTRON" "$APP_DIR" >>"$LOG_FILE" 2>&1 &
