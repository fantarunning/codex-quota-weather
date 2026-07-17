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

step() {
  printf '\033[36m==> %s\033[0m\n' "$1"
}

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT HUP INT TERM

case "$INSTALL_DIR" in
  /*) ;;
  *) echo "Install path must be absolute: $INSTALL_DIR" >&2; exit 1 ;;
esac
if [ "$INSTALL_DIR" = "/" ] || [ "$INSTALL_DIR" = "$HOME" ]; then
  echo "Unsafe installation target: $INSTALL_DIR" >&2
  exit 1
fi

APP_DIR="$INSTALL_DIR/app"
RUNTIME_DIR="$INSTALL_DIR/runtime"
NODE_DIR="$RUNTIME_DIR/node"
ELECTRON="$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

stop_installed_app() {
  if command -v pgrep >/dev/null 2>&1; then
    PIDS=$(pgrep -f "$APP_DIR" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      printf '%s\n' "$PIDS" | while IFS= read -r PID; do
        kill "$PID" 2>/dev/null || true
      done
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

  if [ -f "$0" ]; then
    SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
    if [ -f "$SCRIPT_DIR/package.json" ]; then
      SOURCE_PATH="$SCRIPT_DIR"
      return
    fi
  fi

  step "Downloading the latest source from GitHub"
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/codex-quota-weather.XXXXXX")
  curl -fL --retry 3 --connect-timeout 20 "$ARCHIVE_URL" -o "$TEMP_DIR/source.tar.gz"
  tar -xzf "$TEMP_DIR/source.tar.gz" -C "$TEMP_DIR"
  SOURCE_PATH=""
  for CANDIDATE in "$TEMP_DIR"/"$REPO_NAME"-*; do
    if [ -d "$CANDIDATE" ]; then
      SOURCE_PATH="$CANDIDATE"
      break
    fi
  done
  if [ -z "$SOURCE_PATH" ] || [ ! -f "$SOURCE_PATH/package.json" ]; then
    echo "The downloaded archive did not contain package.json." >&2
    exit 1
  fi
}

install_node() {
  if [ -x "$NODE_DIR/bin/node" ]; then
    return
  fi

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
  if [ -z "$FILE_NAME" ] || [ -z "$EXPECTED" ]; then
    rm -rf "$TEMP_NODE"
    echo "Could not resolve the current Node.js 24 macOS archive." >&2
    exit 1
  fi

  curl -fL --retry 3 "https://nodejs.org/dist/$NODE_CHANNEL/$FILE_NAME" -o "$TEMP_NODE/$FILE_NAME"
  ACTUAL=$(shasum -a 256 "$TEMP_NODE/$FILE_NAME" | awk '{ print $1 }')
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    rm -rf "$TEMP_NODE"
    echo "Node.js archive checksum verification failed." >&2
    exit 1
  fi

  mkdir -p "$RUNTIME_DIR"
  tar -xzf "$TEMP_NODE/$FILE_NAME" -C "$RUNTIME_DIR"
  EXTRACTED=""
  for CANDIDATE in "$RUNTIME_DIR"/node-v*-darwin-*; do
    if [ -d "$CANDIDATE" ]; then
      EXTRACTED="$CANDIDATE"
      break
    fi
  done
  if [ -z "$EXTRACTED" ]; then
    rm -rf "$TEMP_NODE"
    echo "Node.js archive extraction failed." >&2
    exit 1
  fi
  mv "$EXTRACTED" "$NODE_DIR"
  rm -rf "$TEMP_NODE"
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

write_launch_agent() {
  mkdir -p "$HOME/Library/LaunchAgents"
  ESC_ELECTRON=$(xml_escape "$ELECTRON")
  ESC_APP=$(xml_escape "$APP_DIR")
  ESC_LOG=$(xml_escape "$HOME/Library/Logs/CodexQuotaWeather.log")
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ESC_ELECTRON</string>
    <string>$ESC_APP</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ESC_APP</string>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$ESC_LOG</string>
  <key>StandardErrorPath</key>
  <string>$ESC_LOG</string>
</dict>
</plist>
EOF
  chmod 600 "$PLIST"
}

resolve_source
step "Installing Codex Quota Weather to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
stop_installed_app

SOURCE_REAL=$(cd "$SOURCE_PATH" && pwd -P)
APP_REAL=""
if [ -d "$APP_DIR" ]; then
  APP_REAL=$(cd "$APP_DIR" && pwd -P)
fi
if [ "$SOURCE_REAL" != "$APP_REAL" ]; then
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
  (
    cd "$SOURCE_REAL"
    tar -cf - \
      --exclude='.git' \
      --exclude='node_modules' \
      --exclude='config.json' \
      --exclude='.tmp' \
      --exclude='docs/images/frames' \
      --exclude='scripts/__pycache__' \
      .
  ) | (cd "$APP_DIR" && tar -xf -)
fi

chmod +x "$APP_DIR/start-macos.sh" "$APP_DIR/install-macos.sh" "$APP_DIR/uninstall-macos.sh"
install_node

step "Installing Electron and verifying the application"
export PATH="$NODE_DIR/bin:$PATH"
export ELECTRON_GET_USE_PROXY="${ELECTRON_GET_USE_PROXY:-1}"
export npm_config_registry="https://registry.npmjs.org"
cd "$APP_DIR"
"$NODE_DIR/bin/node" "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js" ci --include=dev --no-audit --no-fund
"$NODE_DIR/bin/node" "scripts/smoke-test.js"

if [ ! -x "$ELECTRON" ]; then
  echo "Electron runtime is missing after installation: $ELECTRON" >&2
  exit 1
fi

if [ ! -f "$INSTALL_DIR/config.json" ] && [ -f "$SOURCE_REAL/config.json" ]; then
  step "Migrating settings from the legacy installation"
  cp "$SOURCE_REAL/config.json" "$INSTALL_DIR/config.json"
fi

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
if [ "$NO_STARTUP" = "1" ]; then
  rm -f "$PLIST"
else
  step "Enabling startup with macOS"
  write_launch_agent
fi

if [ "$NO_LAUNCH" != "1" ]; then
  step "Starting Codex Quota Weather"
  if [ "$NO_STARTUP" = "1" ]; then
    "$APP_DIR/start-macos.sh"
  else
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  fi
fi

printf '\n\033[32mCodex Quota Weather is installed and verified.\033[0m\n'
printf 'Install path: %s\n' "$APP_DIR"
printf 'User settings: %s\n' "$INSTALL_DIR/config.json"
