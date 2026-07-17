#!/bin/sh
set -eu
unset CDPATH

REPO_OWNER="fantarunning"
REPO_NAME="codex-quota-weather"
ARCHIVE_URL="https://github.com/$REPO_OWNER/$REPO_NAME/archive/refs/heads/main.tar.gz"
NODE_CHANNEL="latest-v24.x"
INSTALL_DIR=${CODEX_QUOTA_WEATHER_INSTALL_DIR:-"$HOME/Library/Application Support/CodexQuotaWeather"}
SOURCE_DIR=${CODEX_QUOTA_WEATHER_SOURCE_DIR:-""}
NO_STARTUP=${CODEX_QUOTA_WEATHER_NO_STARTUP:-0}
NO_LAUNCH=${CODEX_QUOTA_WEATHER_NO_LAUNCH:-0}
LABEL="com.fantarunning.codex-quota-weather"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TEMP_DIR=""
TEMP_VERSION_DIR=""

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
cleanup() {
  if [ -n "$TEMP_VERSION_DIR" ] && [ -d "$TEMP_VERSION_DIR" ]; then rm -rf "$TEMP_VERSION_DIR"; fi
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then rm -rf "$TEMP_DIR"; fi
}
trap cleanup EXIT HUP INT TERM

case "$INSTALL_DIR" in /*) ;; *) echo "Install path must be absolute: $INSTALL_DIR" >&2; exit 1 ;; esac
if [ "$INSTALL_DIR" = "/" ] || [ "$INSTALL_DIR" = "$HOME" ]; then
  echo "Unsafe installation target: $INSTALL_DIR" >&2
  exit 1
fi

RUNTIME_DIR="$INSTALL_DIR/runtime"
NODE_DIR="$RUNTIME_DIR/node"
VERSIONS_DIR="$INSTALL_DIR/versions"
LAUNCHER_DIR="$INSTALL_DIR/launcher"
STATE_DIR="$INSTALL_DIR/state"
STATE_FILE="$STATE_DIR/update-state.json"
LEGACY_APP_DIR="$INSTALL_DIR/app"

stop_installed_app() {
  if command -v pgrep >/dev/null 2>&1; then
    PIDS=$(pgrep -f "$INSTALL_DIR" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      printf '%s\n' "$PIDS" | while IFS= read -r PID; do kill "$PID" 2>/dev/null || true; done
      sleep 1
    fi
  fi
}

resolve_source() {
  if [ -n "$SOURCE_DIR" ]; then
    if [ ! -f "$SOURCE_DIR/package.json" ]; then
      echo "Source directory does not contain package.json: $SOURCE_DIR" >&2
      exit 1
    fi
    SOURCE_PATH=$(cd "$SOURCE_DIR" && pwd -P)
    return
  fi
  SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
  if [ -f "$SCRIPT_DIR/package.json" ]; then SOURCE_PATH="$SCRIPT_DIR"; return; fi

  step "Downloading the latest source from GitHub"
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/codex-quota-weather.XXXXXX")
  curl -fL --retry 3 --connect-timeout 20 "$ARCHIVE_URL" -o "$TEMP_DIR/source.tar.gz"
  tar -xzf "$TEMP_DIR/source.tar.gz" -C "$TEMP_DIR"
  SOURCE_PATH=""
  for CANDIDATE in "$TEMP_DIR"/"$REPO_NAME"-*; do
    if [ -d "$CANDIDATE" ]; then SOURCE_PATH="$CANDIDATE"; break; fi
  done
  if [ -z "$SOURCE_PATH" ] || [ ! -f "$SOURCE_PATH/package.json" ]; then
    echo "The downloaded archive did not contain package.json." >&2
    exit 1
  fi
}

install_node() {
  if [ -x "$NODE_DIR/bin/node" ]; then return; fi
  case "$(uname -m)" in
    arm64|aarch64) NODE_ARCH="arm64" ;;
    x86_64|amd64) NODE_ARCH="x64" ;;
    *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  step "Downloading a private Node.js 24 runtime for macOS $NODE_ARCH"
  TEMP_NODE=$(mktemp -d "${TMPDIR:-/tmp}/codex-quota-node.XXXXXX")
  MANIFEST=$(curl -fsSL --retry 3 "https://nodejs.org/dist/$NODE_CHANNEL/SHASUMS256.txt")
  FILE_NAME=$(printf '%s\n' "$MANIFEST" | awk -v arch="$NODE_ARCH" '$2 ~ ("^node-v[0-9.]+-darwin-" arch "\\.tar\\.gz$") { print $2; exit }')
  EXPECTED=$(printf '%s\n' "$MANIFEST" | awk -v file="$FILE_NAME" '$2 == file { print $1; exit }')
  if [ -z "$FILE_NAME" ] || [ -z "$EXPECTED" ]; then rm -rf "$TEMP_NODE"; echo "Could not resolve Node.js." >&2; exit 1; fi
  curl -fL --retry 3 "https://nodejs.org/dist/$NODE_CHANNEL/$FILE_NAME" -o "$TEMP_NODE/$FILE_NAME"
  ACTUAL=$(shasum -a 256 "$TEMP_NODE/$FILE_NAME" | awk '{ print $1 }')
  if [ "$ACTUAL" != "$EXPECTED" ]; then rm -rf "$TEMP_NODE"; echo "Node.js checksum failed." >&2; exit 1; fi
  mkdir -p "$RUNTIME_DIR"
  tar -xzf "$TEMP_NODE/$FILE_NAME" -C "$RUNTIME_DIR"
  EXTRACTED=""
  for CANDIDATE in "$RUNTIME_DIR"/node-v*-darwin-*; do
    if [ -d "$CANDIDATE" ]; then EXTRACTED="$CANDIDATE"; break; fi
  done
  if [ -z "$EXTRACTED" ]; then rm -rf "$TEMP_NODE"; echo "Node.js extraction failed." >&2; exit 1; fi
  mv "$EXTRACTED" "$NODE_DIR"
  rm -rf "$TEMP_NODE"
}

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }

write_launch_agent() {
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  ESC_NODE=$(xml_escape "$NODE_DIR/bin/node")
  ESC_LAUNCHER=$(xml_escape "$LAUNCHER_DIR/launcher.js")
  ESC_ROOT=$(xml_escape "$INSTALL_DIR")
  ESC_LOG=$(xml_escape "$HOME/Library/Logs/CodexQuotaWeather.log")
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$ESC_NODE</string><string>$ESC_LAUNCHER</string></array>
  <key>WorkingDirectory</key><string>$ESC_ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$ESC_LOG</string>
  <key>StandardErrorPath</key><string>$ESC_LOG</string>
</dict></plist>
EOF
  chmod 600 "$PLIST"
}

configured_port() {
  "$NODE" - "$INSTALL_DIR/config.json" <<'NODEPORT'
const fs = require('fs');
const file = process.argv[2];
let port = 8787;
try {
  const configured = Number(JSON.parse(fs.readFileSync(file, 'utf8')).port);
  if (Number.isInteger(configured) && configured > 0 && configured <= 65535) port = configured;
} catch {}
process.stdout.write(String(port));
NODEPORT
}

wait_for_local_panel() {
  PORT=$1
  TIMEOUT_SECONDS=${2:-30}
  DEADLINE=$(($(date +%s) + TIMEOUT_SECONDS))
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    HEALTH=$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null || true)
    if printf '%s' "$HEALTH" | "$NODE" -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        try { process.exit(JSON.parse(input).ok === true ? 0 : 1); }
        catch { process.exit(1); }
      });
    '; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

resolve_source
step "Installing Codex Quota Weather to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$VERSIONS_DIR" "$LAUNCHER_DIR" "$STATE_DIR"
stop_installed_app
install_node
NODE="$NODE_DIR/bin/node"
VERSION=$("$NODE" -p "require(process.argv[1]).version" "$SOURCE_PATH/package.json")
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "Invalid package version: $VERSION" >&2; exit 1 ;;
esac
VERSION_DIR="$VERSIONS_DIR/$VERSION"
OLD_CURRENT=""
if [ -f "$STATE_FILE" ]; then
  OLD_CURRENT=$("$NODE" -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).currentVersion||"")}catch{}' "$STATE_FILE")
fi

if [ -d "$LEGACY_APP_DIR" ]; then
  LEGACY_VERSION="0.0.0-legacy"
  if [ -f "$LEGACY_APP_DIR/package.json" ]; then
    LEGACY_VERSION=$("$NODE" -e 'try{process.stdout.write(require(process.argv[1]).version||"0.0.0-legacy")}catch{process.stdout.write("0.0.0-legacy")}' "$LEGACY_APP_DIR/package.json")
  fi
  LEGACY_TARGET="$VERSIONS_DIR/$LEGACY_VERSION"
  if [ ! -d "$LEGACY_TARGET" ]; then
    step "Preserving the previously installed v$LEGACY_VERSION for rollback"
    mv "$LEGACY_APP_DIR" "$LEGACY_TARGET"
  else
    rm -rf "$LEGACY_APP_DIR"
  fi
  if [ -z "$OLD_CURRENT" ]; then OLD_CURRENT="$LEGACY_VERSION"; fi
fi

SOURCE_REAL=$(cd "$SOURCE_PATH" && pwd -P)
VERSION_REAL=""
if [ -d "$VERSION_DIR" ]; then VERSION_REAL=$(cd "$VERSION_DIR" && pwd -P); fi
if [ "$SOURCE_REAL" != "$VERSION_REAL" ]; then
  TEMP_VERSION_DIR="$VERSIONS_DIR/.$VERSION-$(date +%s)-$$"
  mkdir -p "$TEMP_VERSION_DIR"
  (
    cd "$SOURCE_REAL"
    tar -cf - --exclude='.git' --exclude='node_modules' --exclude='config.json' --exclude='.tmp' --exclude='release' .
  ) | (cd "$TEMP_VERSION_DIR" && tar -xf -)
  chmod +x "$TEMP_VERSION_DIR"/*.sh "$TEMP_VERSION_DIR/launcher/start-macos.sh"
  step "Installing Electron and verifying v$VERSION"
  export PATH="$NODE_DIR/bin:$PATH"
  export ELECTRON_GET_USE_PROXY="${ELECTRON_GET_USE_PROXY:-1}"
  export npm_config_registry="https://registry.npmjs.org"
  cd "$TEMP_VERSION_DIR"
  "$NODE" "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js" ci --include=dev --no-audit --no-fund
  "$NODE" "scripts/smoke-test.js"
  rm -rf "$VERSION_DIR"
  mv "$TEMP_VERSION_DIR" "$VERSION_DIR"
  TEMP_VERSION_DIR=""
else
  "$NODE" "$VERSION_DIR/scripts/smoke-test.js"
fi

step "Installing the stable launcher and version state"
cp "$VERSION_DIR/launcher/launcher.js" "$LAUNCHER_DIR/launcher.js"
cp "$VERSION_DIR/launcher/start-macos.sh" "$LAUNCHER_DIR/start-macos.sh"
chmod +x "$LAUNCHER_DIR/start-macos.sh"
cp "$VERSION_DIR/scripts/manage-codex-plugin.js" "$INSTALL_DIR/manage-codex-plugin.js"
cp "$VERSION_DIR/uninstall-macos.sh" "$INSTALL_DIR/uninstall-macos.sh"
chmod +x "$INSTALL_DIR/uninstall-macos.sh"

if [ ! -f "$INSTALL_DIR/config.json" ] && [ -f "$SOURCE_REAL/config.json" ]; then
  step "Migrating settings from the legacy installation"
  cp "$SOURCE_REAL/config.json" "$INSTALL_DIR/config.json"
fi

"$NODE" - "$STATE_FILE" "$VERSIONS_DIR" "$VERSION" "$OLD_CURRENT" <<'NODESTATE'
const fs = require('fs');
const path = require('path');
const [stateFile, versionsDir, version, oldCurrent] = process.argv.slice(2);
const installedVersions = fs.readdirSync(versionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(versionsDir, entry.name, 'package.json')))
  .map((entry) => ({ version: entry.name, installedAt: new Date().toISOString() }));
const state = {
  schemaVersion: 1,
  currentVersion: version,
  previousVersion: oldCurrent && oldCurrent !== version ? oldCurrent : null,
  pendingVersion: null,
  healthyVersion: version,
  installedVersions,
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
NODESTATE

step "Installing and enabling the Codex /quota plugin"
"$NODE" "$INSTALL_DIR/manage-codex-plugin.js" install "$VERSION_DIR/codex-plugin/quota-weather"

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
if [ "$NO_STARTUP" = "1" ]; then
  rm -f "$PLIST"
else
  step "Enabling startup with macOS"
  write_launch_agent
fi
if [ "$NO_LAUNCH" != "1" ]; then
  step "Starting Codex Quota Weather through the stable launcher"
  if [ "$NO_STARTUP" = "1" ]; then "$LAUNCHER_DIR/start-macos.sh"; else
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  fi

  HEALTH_PORT=$(configured_port)
  step "Waiting for the local panel to become ready"
  if ! wait_for_local_panel "$HEALTH_PORT"; then
    printf 'The panel did not start within 30 seconds.\n' >&2
    printf 'Launcher log: %s\n' "$INSTALL_DIR/logs/launcher.log" >&2
    printf 'macOS log: %s\n' "$HOME/Library/Logs/CodexQuotaWeather.log" >&2
    exit 1
  fi

  # A second launch reaches Electron's single-instance handler and explicitly
  # shows the already healthy panel, independent of process-name detection.
  "$LAUNCHER_DIR/start-macos.sh"
fi

if [ "$NO_LAUNCH" != "1" ]; then
  printf '\n\033[32mCodex Quota Weather v%s is installed, verified, and the panel has been opened.\033[0m\n' "$VERSION"
else
  printf '\n\033[32mCodex Quota Weather v%s is installed and verified.\033[0m\n' "$VERSION"
fi
printf 'Install path: %s\n' "$INSTALL_DIR"
printf 'Active version: %s\n' "$VERSION_DIR"
printf 'User settings: %s\n' "$INSTALL_DIR/config.json"
printf 'Codex command: /quota (restart Codex once after first install)\n'
