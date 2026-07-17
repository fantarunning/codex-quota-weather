#!/bin/sh
set -eu
unset CDPATH

INSTALL_DIR=${CODEX_QUOTA_WEATHER_INSTALL_DIR:-"$HOME/Library/Application Support/CodexQuotaWeather"}
NODE="$INSTALL_DIR/runtime/node/bin/node"
LAUNCHER="$INSTALL_DIR/launcher/start-macos.sh"
CONFIG="$INSTALL_DIR/config.json"

if [ ! -x "$NODE" ] || [ ! -x "$LAUNCHER" ]; then
  printf 'Codex Quota Weather is not installed correctly. Rerun install-macos.sh.\n' >&2
  exit 1
fi

PORT=$("$NODE" - "$CONFIG" <<'NODEPORT'
const fs = require('fs');
let port = 8787;
try {
  const configured = Number(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).port);
  if (Number.isInteger(configured) && configured > 0 && configured <= 65535) port = configured;
} catch {}
process.stdout.write(String(port));
NODEPORT
)
BASE_URL="http://127.0.0.1:$PORT"

is_healthy() {
  curl -fsS --max-time 2 "$BASE_URL/health" >/dev/null 2>&1
}

panel_command() {
  curl -fsS --max-time 5 -X POST "$BASE_URL/panel/$1"
}

if is_healthy; then
  panel_command toggle
  printf '\n'
  exit 0
fi

"$LAUNCHER"
DEADLINE=$(($(date +%s) + 30))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if is_healthy; then
    panel_command show
    printf '\n'
    exit 0
  fi
  sleep 0.5
done

printf 'Codex Quota Weather did not start within 30 seconds.\n' >&2
printf 'Launcher log: %s\n' "$INSTALL_DIR/logs/launcher.log" >&2
printf 'macOS log: %s\n' "$HOME/Library/Logs/CodexQuotaWeather.log" >&2
exit 1
