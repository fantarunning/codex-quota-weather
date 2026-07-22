<div align="center">

# Codex Quota Weather

Keep Codex weekly quota and today's activity on your desktop, with live weather scenes that follow Codex automatically.

[中文](README.md) · [Install](#install) · [Use](#how-to-use) · [Uninstall](#uninstall)

![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-2563EB?logo=windows)
![macOS](https://img.shields.io/badge/macOS-13.5%2B-111827?logo=apple)
![Version](https://img.shields.io/badge/version-3.0.0-22C55E)
![License](https://img.shields.io/badge/license-MIT-64748B)

</div>

<img src="docs/images/usage-demo.gif" width="900" alt="Codex Quota Weather usage demo">

## v3.0.0

- Landscape, portrait, and all four dock orientations share the same weather backgrounds and effects.
- Dragging to left/right creates a horizontal dock; top/bottom creates a vertical dock; pull inward and release to restore.
- Completes one-command Windows/macOS installation, `/quota` launch, panel updates, rollback, and uninstall.
- Fixes layout-scale persistence, edge detection, held-drag growth, release-to-restore, and background switching.

## What it does

- Shows weekly quota, tokens used today, calls today, and sessions today.
- Switches among landscape, portrait, left/right dock, and top/bottom vertical dock layouts.
- Includes rain, meteor, blossom, snow, and beach scenes with multiple backgrounds.
- Follows Codex automatically, or starts and toggles from Codex with `/quota`.
- Updates, skips an update, and rolls back to installed versions from the panel.

All data stays on the device. The local service only listens on `127.0.0.1`.

## Install

No administrator access or preinstalled Node.js is required. A first install normally takes 1–3 minutes.

### Windows 10 / 11

Open **Command Prompt**, then run the full line:

```cmd
curl -fL https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install.cmd -o "%TEMP%\quota-install.cmd" && call "%TEMP%\quota-install.cmd"
```

### macOS 13.5+ (Apple Silicon / Intel)

Open Terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install-macos.sh | bash
```

After installation, restart Codex once and enter `/quota` in a new task. The same command starts the app again after you quit it from the tray or menu bar.

## How to use

| Action | Result |
| --- | --- |
| Click `Codex` | Landscape → portrait → dock → landscape |
| Click the quota ring | Change weather |
| Scroll or click the background dots | Change the current weather background |
| Drag a card to a screen edge | Horizontal dock on left/right; vertical dock on top/bottom |
| Pull a dock inward and release | Restore the card |
| Click `+` / `−` or drag a card edge | Resize |
| Click the bell | Keep the panel on top |
| Right-click the tray icon | Show, hide, restart, set auto weather, or quit |

![Five weather scenes](docs/images/themes-grid.png)

Weather changes automatically every 10 minutes by default. The tray menu can turn this off or select 1, 5, 10, or 30 minutes.

## Updates and rollback

- The download button only appears when a new release is available.
- You can install it or skip that release so it no longer prompts.
- Version history lists installed or downloadable formal releases.
- The stable launcher automatically restores the previous version if a new one fails to start.

Formal updates come from GitHub Tags and Releases. The technical repository name `codex-quota-weather` remains unchanged for upgrade and plugin compatibility.

## Uninstall

Uninstall closes the app and removes its files, startup entry, and `/quota` plugin.

### Windows Command Prompt

```cmd
"%LOCALAPPDATA%\Programs\CodexQuotaWeather\uninstall.cmd"
```

Keep personal settings:

```cmd
"%LOCALAPPDATA%\Programs\CodexQuotaWeather\uninstall.cmd" -KeepSettings
```

### macOS Terminal

```bash
bash "$HOME/Library/Application Support/CodexQuotaWeather/uninstall-macos.sh"
```

Keep personal settings:

```bash
bash "$HOME/Library/Application Support/CodexQuotaWeather/uninstall-macos.sh" --keep-settings
```

## Troubleshooting

- No panel after installation: restart Codex once, then enter `/quota`, or click the Codex Quota Weather tray/menu-bar icon.
- Windows installer looks idle: keep Command Prompt open while the private Node.js and Electron runtimes download.
- Windows log: `%LOCALAPPDATA%\Programs\CodexQuotaWeather\logs\launcher.log`
- macOS log: `~/Library/Application Support/CodexQuotaWeather/logs/launcher.log`

| Platform | Application | Settings |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\Programs\CodexQuotaWeather` | `%APPDATA%\CodexQuotaWeather\config.json` |
| macOS | `~/Library/Application Support/CodexQuotaWeather` | `config.json` in the application directory |

## Local development

Node.js `>= 22.12.0` is required:

```bash
git clone https://github.com/fantarunning/codex-quota-weather.git
cd codex-quota-weather
npm ci
npm test
npm start
```

Regenerate the current screenshots and animated demo with:

```bash
npm run capture:docs
python scripts/build-doc-gifs.py
```

See [SECURITY.md](SECURITY.md) and [LICENSE](LICENSE).
