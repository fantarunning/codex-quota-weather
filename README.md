<div align="center">

# Codex Quota Weather

把 Codex 周额度、今日调用和上下文用量放进一个会自动跟随 Codex 的天气悬浮窗。

[English](README.en.md) · [安装](#一行安装) · [使用说明](#使用说明) · [故障排查](#故障排查)

![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-2563EB?logo=windows)
![macOS](https://img.shields.io/badge/macOS-13.5%2B-111827?logo=apple)
![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron)
![License](https://img.shields.io/badge/code-MIT-22C55E)

</div>

![五种天气特效演示](docs/images/weather-showcase.gif)

## 功能

- 实时读取 ChatGPT/Codex 账户周额度，空闲时也会自动刷新。
- 当实时接口暂时不可用时，自动回退到最新 Codex 会话快照。
- 展示今日 Token、当前上下文、今日调用次数和会话数。
- 内置雨景、流星、花瓣、雪景和海浪五套天气，每套包含三张背景。
- 默认每 10 分钟自动换天气，可在托盘菜单切换为关闭、1、5、10 或 30 分钟。
- 跟随 Codex Desktop 或 Codex CLI 自动显示/隐藏，也可从 Windows 系统托盘或 macOS 菜单栏手动控制。
- 原生支持 Windows 10/11、Apple Silicon Mac 和 Intel Mac。
- 支持横版、沿用完整天气背景与特效的 `240 × 520` 竖版、悬浮球、置顶、缩放、拖动、中英文和减少动态效果。
- 支持悬浮窗内下载更新、历史版本回退和新版本启动失败自动恢复。
- 所有数据只在本机处理，本地服务仅监听 `127.0.0.1`。

## 一行安装

### Windows 10/11

在 CMD 中运行（推荐，命令更短；Windows 10/11 自带 `curl.exe`）：

```cmd
curl -Ls https://github.com/fantarunning/codex-quota-weather/raw/main/install.cmd|cmd
```

这条命令先下载只有一行的 [install.cmd](install.cmd)，再调用完整的
[install.ps1](install.ps1)。它不会永久修改 PowerShell 执行策略。安装完成后会自动启动悬浮窗。
安装 `v2.3.2` 或更高版本后只需安装一次，后续版本可直接在悬浮窗中下载；更早版本用户再运行一次该命令即可完成目录迁移。
已经安装 `v2.3.0` 或 `v2.3.1` 的用户需要再运行一次安装命令，以修复 Windows 临时 ZIP 解压问题；此后可直接使用面板更新。

也可以在 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install.ps1 | iex"
```

### macOS 13.5+（Apple Silicon / Intel）

在“终端”中运行：

```bash
curl -fsSL https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install-macos.sh | bash
```

两个安装器都无需管理员权限，也不要求电脑预先安装 Node.js。它们会：

1. 下载最新源码；
2. 安装独立的 Node.js 24、Electron、固定启动器和多版本目录；
3. 校验 Node.js 下载文件的 SHA-256；
4. 安装依赖并执行烟雾测试；
5. 创建 Windows Startup 或 macOS LaunchAgent 开机启动项；
6. 启动悬浮窗，并保留最近 5 个可回退版本。

| 平台 | 应用目录 | 个人设置 |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\Programs\CodexQuotaWeather` | `%APPDATA%\CodexQuotaWeather\config.json` |
| macOS | `~/Library/Application Support/CodexQuotaWeather` | 同目录下的 `config.json` |

首次安装后，窗口位置、缩放和自动天气设置会在升级、回退时保留。执行前可先查看
[CMD 安装入口](install.cmd)、[Windows 安装脚本](install.ps1)或 [macOS 安装脚本](install-macos.sh)。

## 面板更新与历史版本

- 更新入口只显示在悬浮窗顶部。没有新版本时下载图标完全隐藏；检测到新 GitHub Release 后才会自动出现。
- 点击下载图标可查看版本、下载进度和历史版本，并选择“下载更新”或“跳过此次更新”。
- 跳过后会记住该版本，即使重启也不再显示下载图标；发布更高版本后会重新提醒。
- 新版本会先下载到独立目录，校验 GitHub Release 的 SHA-256，再执行烟雾测试；不会覆盖正在运行的版本。
- 切换后 30 秒内未能正常启动时，固定启动器会自动恢复上一版本和切换前的配置备份。
- 默认保留最近 5 个版本。已安装版本可以立即回退，远端历史版本可以先下载再切换。
- 从 `v2.3.0` 起的版本可在更新面板中双向切换；迁移时保留的更早版本只作为新版启动失败时的应急自动回退。

```text
CodexQuotaWeather/
├─ launcher/             固定启动器和开机启动入口
├─ runtime/              私有 Node.js 运行时
├─ versions/<version>/   各版本应用与 Electron
├─ downloads/            临时下载
└─ state/update-state.json
```

每个正式版本由 Git Tag 触发 GitHub Actions，自动生成 Windows x64、macOS Apple Silicon、macOS Intel 三个平台包、
`update-manifest.json` 和 `SHA256SUMS.txt`，然后发布到同名 GitHub Release。

### Windows CMD 代理安装

如果 GitHub、Node.js 或 Electron 下载需要代理，在同一个 CMD 窗口执行：

```cmd
set HTTPS_PROXY=http://127.0.0.1:10808
set HTTP_PROXY=http://127.0.0.1:10808
curl -Ls https://github.com/fantarunning/codex-quota-weather/raw/main/install.cmd|cmd
```

请把 `127.0.0.1:10808` 换成本机代理地址。关闭该 CMD 窗口后，这两个临时环境变量自动失效。

## 手动安装

需要 Git 和 Node.js `>= 22.12.0`：

```bash
git clone https://github.com/fantarunning/codex-quota-weather.git
cd codex-quota-weather
npm ci
npm test
npm start
```

如果 Electron 下载需要代理，请先设置。Windows PowerShell：

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:10808"
$env:HTTP_PROXY = "http://127.0.0.1:10808"
npm run setup:electron
```

macOS 终端：

```bash
export HTTPS_PROXY=http://127.0.0.1:10808
export HTTP_PROXY=http://127.0.0.1:10808
npm run setup:electron
```

## 使用说明

| 操作 | 结果 |
| --- | --- |
| 点击左侧额度圆环 | 切换到下一种天气 |
| 点击顶部天气名称 | 更换当前天气的背景 |
| 点击 `中 / EN` | 切换界面语言 |
| 点击下载图标（仅有更新时显示） | 下载更新、跳过此次更新、查看进度或选择历史版本 |
| 点击 `−` | 从横版切换到 `240 × 520` 竖版；竖版继续沿用当前天气背景与动态特效 |
| 单击竖版（未拖动） | 继续切换到悬浮球，再单击悬浮球恢复横版 |
| 拖动竖版或悬浮球 | 移动当前小窗位置 |
| 点击铃铛图标 | 开关窗口置顶 |
| 点击 `×` | 隐藏面板，程序仍留在系统托盘 |
| 左键托盘/菜单栏图标 | 显示或隐藏面板 |
| 右键托盘/菜单栏图标 | 设置跟随 Codex、自动天气或退出 |
| `Ctrl + 滚轮` / 拖动边缘 | 调整面板大小 |

“跟随 Codex”会识别 Windows 的 `Codex.exe` / `ChatGPT.exe`，以及 macOS 的
`Codex` / `ChatGPT`。手动隐藏后，本次 Codex 运行期间不会反复弹出。

## 数据含义

| 位置 | 含义 | 数据来源 |
| --- | --- | --- |
| 圆环 | 账户周额度剩余百分比 | ChatGPT usage 接口；失败时回退会话快照 |
| 本日已用 | 今天产生的会话累计 Token 增量 | `~/.codex/sessions` |
| 上下文小字 | 最近一次调用 Token / 模型上下文上限 | 最新 Codex 会话 |
| 今日调用 | 今天记录到的 Token 事件数 | `~/.codex/sessions` |
| 今日会话 | 今天有活动的 Codex 会话数 | `~/.codex/sessions` |

三个“今日”指标按本机时区的午夜和每条事件时间戳切分。即使一个会话从昨天持续到今天，今天新增的
Token、调用和活动会话也会实时计入，不会重复累计昨天的数据。

周额度圆环显示的是“剩余”，因此 Codex 原生界面显示“已用 26%”时，本应用显示“74%”是同一份数据的两种口径。

## 天气预览

![五套主题总览](docs/images/themes-grid.png)

### 花瓣

![花瓣特效](docs/images/effect-blossom.gif)

### 雪景

![雪景特效](docs/images/effect-snow.gif)

### 流星

![流星特效](docs/images/effect-meteor.gif)

静态大图：[雨景](docs/images/theme-rain.png) ·
[流星](docs/images/theme-meteor.png) ·
[花瓣](docs/images/theme-blossom.png) ·
[雪景](docs/images/theme-snow.png) ·
[海浪](docs/images/theme-beach.png)

## 配置

首次运行会创建个人配置：Windows 位于 `%APPDATA%\CodexQuotaWeather\config.json`，
macOS 位于 `~/Library/Application Support/CodexQuotaWeather/config.json`。修改后重启应用生效。

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| `port` | `8787` | 本地数据服务端口 |
| `refreshMs` | `4000` | 界面轮询间隔 |
| `liveUsageMs` | `60000` | 周额度实时刷新间隔 |
| `alwaysOnTop` | `true` | 默认置顶 |
| `lang` | `zh` | `zh` 或 `en` |
| `scale` | `0.696` | 面板缩放，对应默认内容尺寸约 `473 × 264` |
| `windowX` | `1213` | 默认窗口左上角横坐标，小屏幕会自动限制在可视区域 |
| `windowY` | `647` | 默认窗口左上角纵坐标，小屏幕会自动限制在可视区域 |
| `defaultTheme` | `rain` | `rain / meteor / blossom / snow / beach` |
| `defaultBackgroundIndex` | `1` | 默认背景序号，范围 `0-2` |
| `followCodex` | `true` | 跟随 Codex 自动显示/隐藏 |
| `watchProcesses` | `Codex, ChatGPT` | 被识别为 Codex 的进程名 |
| `weatherSwitchIntervalMs` | `600000` | 自动换天气间隔，`0` 为关闭 |
| `skippedUpdateVersion` | `null` | 用户跳过的版本；更高版本发布后自动重新提醒 |

仓库中的 [config.example.json](config.example.json) 保存公开的默认大小和位置；运行时拖动或缩放产生的个人位置仍只保存在用户配置中。

## 隐私与安全

- 服务只绑定 `127.0.0.1`，不会向局域网开放。
- 应用会读取 `~/.codex/auth.json` 中现有的访问令牌来请求 ChatGPT usage 接口。
- 令牌不会写入项目、不会通过本地 API 返回，也不会打印到日志。
- 应用不会修改 Codex 的认证文件或会话文件。

详细边界见 [SECURITY.md](SECURITY.md)。

## 故障排查

### 周额度显示离线或长时间不更新

1. 确认 Codex 已正常登录；
2. 在项目目录运行 `npm run test:live`；
3. 如果 ChatGPT 需要代理，在 `~/.codex/.env` 或系统环境变量中配置
   `HTTPS_PROXY` / `HTTP_PROXY`；
4. 点击面板左上角“实时”徽标强制刷新。

### Codex 打开后面板没有出现

- 左键单击 Windows 系统托盘或 macOS 菜单栏里的 Codex Quota Weather 图标；
- 右键确认“跟随 Codex”已勾选；
- 检查配置中的 `watchProcesses` 是否包含本机进程名。

### 端口 8787 被占用

把个人配置中的 `port` 改为其他未占用端口，然后重启应用。

### 安装时 Electron 下载失败

在同一个终端窗口设置代理后，重试对应平台的一行安装命令。Windows CMD：

```cmd
set HTTPS_PROXY=http://127.0.0.1:10808
set HTTP_PROXY=http://127.0.0.1:10808
curl -Ls https://github.com/fantarunning/codex-quota-weather/raw/main/install.cmd|cmd
```

Windows PowerShell：

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:10808"
$env:HTTP_PROXY = "http://127.0.0.1:10808"
```

### CMD 提示找不到 `curl`

确认系统为 Windows 10/11，并在 CMD 中执行 `where curl`。如果仍找不到，直接使用上面的
PowerShell 安装命令，不需要另外安装 curl。

macOS：

```bash
export HTTPS_PROXY=http://127.0.0.1:10808
export HTTP_PROXY=http://127.0.0.1:10808
```

## 卸载

Windows CMD：

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\CodexQuotaWeather\uninstall.ps1"
```

保留个人设置：

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\CodexQuotaWeather\uninstall.ps1" -KeepSettings
```

macOS：

```bash
bash "$HOME/Library/Application Support/CodexQuotaWeather/uninstall-macos.sh"
```

macOS 保留个人设置：

```bash
bash "$HOME/Library/Application Support/CodexQuotaWeather/uninstall-macos.sh" --keep-settings
```

## 开发与验证

```powershell
npm ci
npm test
npm run test:electron
npm run test:app
npm run test:live
npm run capture:docs
python scripts/build-doc-gifs.py
```

`npm test` 会校验 JavaScript 语法、Electron 运行时、15 张背景、五套主题、
本地 HTTP API 和演示渲染入口。`npm run test:electron` 会验证天气画布，
`npm run test:app` 会启动完整托盘主进程和透明窗口。GitHub Actions 会在 Windows x64、Apple Silicon macOS 和
Intel macOS 上重复执行测试、平台安装器和 `npm audit`。

发布新版本时，先同步 `package.json` 与 `package-lock.json` 的版本号，再推送同名 Tag：

```powershell
git tag -a v2.4.0 -m "Release v2.4.0"
git push origin v2.4.0
```

`.github/workflows/release.yml` 会完成跨平台打包、校验清单生成和 GitHub Release 发布。

## 许可证

代码使用 [MIT License](LICENSE)。背景照片不包含在 MIT 许可证内，来源与许可说明见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目不是 OpenAI 官方产品。
