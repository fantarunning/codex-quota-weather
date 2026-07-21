<div align="center">

# Codex Quota Weather

A live Codex quota tray panel with five animated weather scenes for Windows and macOS.

[中文](README.md) · [Install](#one-command-install) · [Usage](#usage) · [Troubleshooting](#troubleshooting)

</div>

![Animated weather showcase](docs/images/weather-showcase.gif)

## Highlights

- Refreshes the ChatGPT/Codex weekly account quota even while Codex is idle.
- Falls back to the newest Codex session snapshot when the live endpoint is unavailable.
- Shows today's tokens, current context, call count, and session count.
- Includes rain, meteor, blossom, snow, and ocean scenes with three backgrounds each.
- Rotates weather automatically; choose off, 1, 5, 10, or 30 minutes from the tray.
- Follows Codex Desktop (`ChatGPT` / `ChatGPT.exe`) and Codex CLI (`Codex` / `Codex.exe`).
- Accepts `/quota` directly in Codex: start the app when it is not running, or show/hide the panel when it is running.
- Supports Windows 10/11, Apple Silicon Macs, and Intel Macs.
- Supports a landscape card, a full-weather portrait card, an automatic edge-docked weekly-quota tab, pinning, resizing, Chinese/English, and reduced motion. Drag either card to the left or right display edge to dock it. The dock keeps the active weather background and animated effect, including automatic weather rotation. The portrait design uses a `240 × 520` base layout and initially opens at `120 × 260` (one quarter of the base area).
- Supports in-panel updates and version rollback, plus automatic recovery from a failed update.
- Processes data locally and binds its HTTP service only to `127.0.0.1`.

## What's new in v2.5.2

- Adds a `128 × 52` edge-docked HUD that keeps the active weather background and animation while showing only weekly quota, status, and `Codex`.
- Clicking `Codex` cycles landscape → portrait → dock → landscape; dragging either card to a display edge also docks it automatically.
- The dock ring changes weather, while the wheel or new vertical indicator changes backgrounds and keeps the active indicator synchronized.
- The dock can move along the edge or be pulled inward and restored on release; long-press growth, post-layout scaling, and resize regressions are fixed.
- Refines compact rain sizing, layout morphs, and rounded corners; the tray now includes Restart, while the minus button minimizes to the tray.

## One-command install

### Windows 10/11

Run in Command Prompt (recommended; Windows 10/11 includes `curl.exe`):

```cmd
curl -fL --retry 3 https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install.cmd -o "%TEMP%\quota-weather-install.cmd" && call "%TEMP%\quota-weather-install.cmd"
```

This downloads the lightweight [install.cmd](install.cmd) entry point, which calls the
full [install.ps1](install.ps1) installer. It does not permanently change the
PowerShell execution policy. A first install normally takes 1–3 minutes; keep the CMD window open. The installer reports progress, waits for a successful local health check, and explicitly opens the panel. Starting with `v2.3.0`, this is a one-time install;
later releases can be downloaded from the panel or tray. Existing users should run
the command once more to migrate from the old single-version layout.

Download failures are not hidden: the script runs only after it has been saved successfully. If GitHub Raw is unreachable, the connection times out, or TLS validation fails, Command Prompt reports the actual error instead of briefly showing a second Command Prompt banner and exiting.

Or run in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/fantarunning/codex-quota-weather/raw/main/install.ps1 | iex"
```

### macOS 13.5+ (Apple Silicon / Intel)

Run in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install-macos.sh | bash
```

A first install normally takes 1–3 minutes; keep Terminal open. The macOS installer reports progress, waits for the local health endpoint, and then explicitly opens the panel through Electron's single-instance handler. If startup fails, it prints the relevant log paths.

Neither installer requires administrator access or a preinstalled Node.js. It installs
a private Node.js 24 runtime, a stable launcher, Electron, and versioned application
directories. It verifies downloads, runs the smoke test, enables login startup, verifies the local service, and launches the panel.
It also installs and enables the cross-platform Codex `/quota` plugin. Restart Codex once after the first install or a plugin update, then send `/quota` in a new task. The same command starts the app again after **Quit**.

| Platform | Application | User settings |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\Programs\CodexQuotaWeather` | `%APPDATA%\CodexQuotaWeather\config.json` |
| macOS | `~/Library/Application Support/CodexQuotaWeather` | `config.json` in the same directory |

Updates and rollbacks preserve window position and preferences.
You can review the [CMD entry point](install.cmd), [Windows installer](install.ps1), or
[macOS installer](install-macos.sh) before executing it.

## In-panel updates and rollback

- The update entry exists only in the panel header and stays hidden when no newer release is available.
- Click the download icon to check, download, skip, restart into an update, or browse version history.
- Skipping a release hides its download icon until a newer version is published.
- Each release is downloaded into its own directory, verified with the GitHub Release SHA-256 digest, and smoke-tested before it becomes selectable.
- If the new version does not report a healthy renderer within 30 seconds, the stable launcher restores the previous version and configuration backup.
- The latest five versions are retained. Installed releases switch immediately; older remote releases can be downloaded on demand.
- Versions from `v2.3.0` onward can switch in both directions. A migrated pre-2.3 release is kept only as an automatic emergency fallback.

```text
CodexQuotaWeather/
├─ launcher/             stable startup entry point
├─ runtime/              private Node.js runtime
├─ versions/<version>/   versioned app and Electron runtime
├─ downloads/            temporary downloads
└─ state/update-state.json
```

A version tag triggers GitHub Actions to publish Windows x64, macOS Apple Silicon,
and macOS Intel archives plus `update-manifest.json` and `SHA256SUMS.txt`.

### Windows CMD install through a proxy

If GitHub, Node.js, or Electron requires a proxy, run these commands in the same
Command Prompt window:

```cmd
set HTTPS_PROXY=http://127.0.0.1:10808
set HTTP_PROXY=http://127.0.0.1:10808
curl -fL --retry 3 https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install.cmd -o "%TEMP%\quota-weather-install.cmd" && call "%TEMP%\quota-weather-install.cmd"
```

Replace `127.0.0.1:10808` with the local proxy address. These temporary variables
expire when that Command Prompt window closes.

## Manual install

Git and Node.js `>= 22.12.0` are required:

```bash
git clone https://github.com/fantarunning/codex-quota-weather.git
cd codex-quota-weather
npm ci
npm test
npm start
```

If Electron needs a proxy, configure it first. Windows PowerShell:

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:10808"
$env:HTTP_PROXY = "http://127.0.0.1:10808"
npm run setup:electron
```

macOS Terminal:

```bash
export HTTPS_PROXY=http://127.0.0.1:10808
export HTTP_PROXY=http://127.0.0.1:10808
npm run setup:electron
```

## Usage

| Action | Result |
| --- | --- |
| Send `/quota` in a new Codex task | Start the app when stopped; otherwise show or hide the panel |
| Click the quota ring | Switch to the next weather scene |
| Click the weather name | Change the current scene's background |
| Click `中 / EN` | Switch language |
| Click the download icon | Check/download updates, restart, or select a historical version |
| Click `Codex` in landscape, portrait, or the docked tab | Cycle through landscape → portrait → dock → landscape |
| Drag landscape or portrait to the left/right display edge | Collapse into a weekly-quota tab while keeping the weather background and effect |
| Click the docked ring | Switch to the next weather scene, matching the card interaction |
| Scroll over the docked tab | Switch the active weather scene's background |
| Click the vertical indicator on the dock's right side | Switch backgrounds and highlight the active one |
| Click `Codex` in the docked tab | Return to landscape at its previous size |
| Drag the docked tab vertically along the edge | Reposition it on the edge |
| Pull the docked tab inward and release | The compact tab follows the cursor; the previous card returns after mouse release |
| Click the portrait ring | Switch to the next weather scene, just like the landscape ring |
| Click the bottom dots / scroll in portrait layout | Switch among the current weather's three backgrounds; the dots track the active image |
| Drag portrait empty space | Move the portrait window |
| Click the bell | Toggle always-on-top |
| Click `−` | Minimize to the system tray, leaving only the tray icon |
| Click `×` | Hide the panel but keep the tray app running |
| Left-click the tray/menu bar icon | Show or hide the panel |
| Right-click the tray/menu bar icon | Configure following or weather, or restart/quit the app |
| `Ctrl + wheel` / drag an edge | Resize landscape or portrait; each layout remembers its own scale |

## What the numbers mean

| UI | Meaning | Source |
| --- | --- | --- |
| Ring | Weekly account quota remaining | ChatGPT usage endpoint, with session fallback |
| Used Today | Cumulative token growth produced today | `~/.codex/sessions` |
| Context subline | Latest call tokens / model context window | Latest Codex session |
| Calls Today | Token events recorded today | `~/.codex/sessions` |
| Sessions | Codex sessions active today | `~/.codex/sessions` |

The three daily metrics split records at local midnight using each event timestamp.
An overnight session therefore contributes only today's new tokens, calls, and activity,
without counting yesterday's usage again.

The ring uses a **remaining** percentage. If Codex says “26% used,” this app says
“74% remaining”; both represent the same quota snapshot.

## Scenes

![All five themes](docs/images/themes-grid.png)

![Blossom effect](docs/images/effect-blossom.gif)

![Snow effect](docs/images/effect-snow.gif)

![Meteor effect](docs/images/effect-meteor.gif)

## Configuration

The first run creates `%APPDATA%\CodexQuotaWeather\config.json` on Windows or
`~/Library/Application Support/CodexQuotaWeather/config.json` on macOS.

Important fields include `port`, `refreshMs`, `liveUsageMs`, `lang`, `scale`,
`portraitScale`, `minPortraitScale`, `maxPortraitScale`,
`windowX`, `windowY`, `defaultTheme`, `defaultBackgroundIndex`, `followCodex`,
`watchProcesses`, and `weatherSwitchIntervalMs`. [config.example.json](config.example.json)
contains the public default size and position; positions saved while running remain
in the per-user configuration only.

The current first-run landscape defaults are scale `0.696`, position `1213,647`,
and an approximate content size of `473 × 264`. Portrait scale defaults to `0.5`,
so its `240 × 520` base layout opens at `120 × 260`; its range is `0.35` to `1.25`.
Smaller displays clamp the position into the visible work area.

## Privacy and security

The app reads the existing token in `~/.codex/auth.json` only to request the ChatGPT
usage endpoint. The token is never returned by the local API, written into this
project, or printed in logs. Codex authentication and session files are read-only.
See [SECURITY.md](SECURITY.md).

## Troubleshooting

### The CMD installer appears to do nothing

The first install downloads roughly 150 MB of Electron and normally takes 1–3 minutes. Keep the window open until it says `Installation finished successfully`. The current installer prints an immediate start message, verifies the local health endpoint before reporting success, and explicitly opens the panel.

- If only a second Command Prompt banner appears before the original prompt returns, the old pipeline command did not download the script body and its `-s` flag hid the `curl` error. Copy the new one-command installer above; it saves the script first, runs it only after a successful download, and exposes network, proxy, and TLS errors.
- Run `curl -fL https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install.cmd -o NUL` to test GitHub Raw separately. A successful transfer reaches `100`; otherwise follow the reported error or configure a proxy.
- On installer failure, preserve the terminal output and inspect `%LOCALAPPDATA%\Programs\CodexQuotaWeather\logs\launcher.log`.
- The default health check is `curl http://127.0.0.1:8787/health`.

### The panel does not appear after macOS installation

- The installer waits for the local service and invokes the stable launcher a second time to explicitly show the panel. Keep Terminal open until it reports `the panel has been opened`.
- Check the default endpoint with `curl http://127.0.0.1:8787/health`. If `port` was changed in `config.json`, use that port instead.
- Inspect `~/Library/Application Support/CodexQuotaWeather/logs/launcher.log` and `~/Library/Logs/CodexQuotaWeather.log` after a startup failure.
- There is no need to uninstall first; rerun the same macOS one-command installer after an installer fix.

### `/quota` does not start the panel in Codex

- Fully restart Codex once after the first install or a plugin update, then send exactly `/quota` in a new task.
- The installer creates the personal marketplace entry and enables `quota-weather@personal`; no long plugin-qualified command is required.
- On Windows, verify `%USERPROFILE%\plugins\quota-weather\scripts\show-quota.ps1`. On macOS, verify `~/plugins/quota-weather/scripts/show-quota.sh`.
- Rerun the platform one-command installer if the script is missing.

### Weekly quota is offline or stale

1. Confirm that Codex is signed in.
2. Run `npm run test:live`.
3. Configure `HTTPS_PROXY` / `HTTP_PROXY` in `~/.codex/.env` or the environment if required.
4. Click the green Live badge to force a refresh.

### The panel does not appear with Codex

Left-click the Windows tray or macOS menu bar icon, verify that “Follow Codex” is enabled, and check the
`watchProcesses` setting.

### Electron download fails

Set `HTTPS_PROXY` and `HTTP_PROXY` in the same terminal window, then rerun the
platform-specific installer. In Command Prompt:

```cmd
set HTTPS_PROXY=http://127.0.0.1:10808
set HTTP_PROXY=http://127.0.0.1:10808
curl -fL --retry 3 https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install.cmd -o "%TEMP%\quota-weather-install.cmd" && call "%TEMP%\quota-weather-install.cmd"
```

### Command Prompt cannot find `curl`

Confirm Windows 10/11 and run `where curl`. If it is still unavailable, use the
PowerShell one-command installer above; no separate curl installation is required.

## Uninstall

Windows Command Prompt:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\CodexQuotaWeather\uninstall.ps1"
```

Append `-KeepSettings` to preserve preferences:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\CodexQuotaWeather\uninstall.ps1" -KeepSettings
```

macOS:

```bash
bash "$HOME/Library/Application Support/CodexQuotaWeather/uninstall-macos.sh"
```

Add `--keep-settings` to preserve preferences.

## Development

```powershell
npm ci
npm test
npm run test:electron
npm run test:app
npm run test:live
npm run capture:docs
python scripts/build-doc-gifs.py
```

The smoke tests validate JavaScript syntax, the Electron runtime, all 15 bundled
backgrounds, five themes, the local HTTP API, a hidden renderer, and the complete
tray application process.
GitHub Actions repeats them on Windows x64, Apple Silicon macOS, and Intel macOS.

To publish, update the package version and push the matching annotated tag:

```powershell
git tag -a v2.5.2 -m "Release v2.5.2"
git push origin v2.5.2
```

`.github/workflows/release.yml` builds the three archives, generates checksums,
and publishes the GitHub Release automatically.

## License

Code is released under the [MIT License](LICENSE). Background photos are not covered
by MIT; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This is an unofficial,
community-built project and is not an OpenAI product.
