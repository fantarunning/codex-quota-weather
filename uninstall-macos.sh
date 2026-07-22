#!/bin/sh
set -eu
unset CDPATH

INSTALL_DIR=${CODEX_QUOTA_WEATHER_INSTALL_DIR:-"$HOME/Library/Application Support/CodexQuotaWeather"}
KEEP_SETTINGS=${CODEX_QUOTA_WEATHER_KEEP_SETTINGS:-0}
LABEL="com.fantarunning.codex-quota-weather"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "${1:-}" = "--keep-settings" ]; then
  KEEP_SETTINGS=1
fi

case "$INSTALL_DIR" in
  /*) ;;
  *) echo "Install path must be absolute: $INSTALL_DIR" >&2; exit 1 ;;
esac
case "$(basename "$INSTALL_DIR")" in
  CodexQuotaWeather*) ;;
  *) echo "Refusing to remove an unsafe installation target: $INSTALL_DIR" >&2; exit 1 ;;
esac
if [ "$INSTALL_DIR" = "/" ] || [ "$INSTALL_DIR" = "$HOME" ]; then
  echo "Refusing to remove an unsafe installation target: $INSTALL_DIR" >&2
  exit 1
fi

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"

if command -v pgrep >/dev/null 2>&1; then
  PIDS=$(pgrep -f "$INSTALL_DIR" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    printf '%s\n' "$PIDS" | while IFS= read -r PID; do
      if [ "$PID" != "$$" ]; then kill "$PID" 2>/dev/null || true; fi
    done
    sleep 1
  fi
fi

SAVED_CONFIG=""
if [ "$KEEP_SETTINGS" = "1" ] && [ -f "$INSTALL_DIR/config.json" ]; then
  SAVED_CONFIG=$(mktemp "${TMPDIR:-/tmp}/codex-quota-config.XXXXXX")
  cp "$INSTALL_DIR/config.json" "$SAVED_CONFIG"
fi

NODE="$INSTALL_DIR/runtime/node/bin/node"
PLUGIN_MANAGER="$INSTALL_DIR/manage-codex-plugin.js"
if [ -x "$NODE" ] && [ -f "$PLUGIN_MANAGER" ]; then
  "$NODE" "$PLUGIN_MANAGER" remove >/dev/null 2>&1 || true
fi

rm -rf "$INSTALL_DIR"
if [ -n "$SAVED_CONFIG" ] && [ -f "$SAVED_CONFIG" ]; then
  mkdir -p "$INSTALL_DIR"
  mv "$SAVED_CONFIG" "$INSTALL_DIR/config.json"
fi

printf '\033[32mCodex Quota Weather has been uninstalled.\033[0m\n'
