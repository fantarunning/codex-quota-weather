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
- 支持置顶、缩放、拖动、缩成悬浮球、中英文和减少动态效果。
- 所有数据只在本机处理，本地服务仅监听 `127.0.0.1`。

## 一行安装

### Windows 10/11

在 PowerShell 中运行：

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
2. 在应用目录安装独立的 Node.js 24 和 Electron；
3. 校验 Node.js 下载文件的 SHA-256；
4. 安装依赖并执行烟雾测试；
5. 创建 Windows Startup 或 macOS LaunchAgent 开机启动项；
6. 启动悬浮窗。

| 平台 | 应用目录 | 个人设置 |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\Programs\CodexQuotaWeather` | `%APPDATA%\CodexQuotaWeather\config.json` |
| macOS | `~/Library/Application Support/CodexQuotaWeather` | 同目录下的 `config.json` |

重复运行对应命令即可更新，窗口位置、缩放和自动天气设置会保留。执行前可先查看
[Windows 安装脚本](install.ps1)或 [macOS 安装脚本](install-macos.sh)。

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
| 点击 `−` | 缩成只显示周额度的悬浮球 |
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
| 本日已用 | 今天所有 Codex 会话累计 Token | `~/.codex/sessions` |
| 上下文小字 | 最近一次调用 Token / 模型上下文上限 | 最新 Codex 会话 |
| 今日调用 | 今天记录到的 Token 事件数 | `~/.codex/sessions` |
| 今日会话 | 今天有活动的 Codex 会话数 | `~/.codex/sessions` |

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
| `scale` | `0.8` | 面板缩放 |
| `defaultTheme` | `rain` | `rain / meteor / blossom / snow / beach` |
| `defaultBackgroundIndex` | `1` | 默认背景序号，范围 `0-2` |
| `followCodex` | `true` | 跟随 Codex 自动显示/隐藏 |
| `watchProcesses` | `Codex, ChatGPT` | 被识别为 Codex 的进程名 |
| `weatherSwitchIntervalMs` | `600000` | 自动换天气间隔，`0` 为关闭 |

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

在同一个终端窗口设置代理后，重试对应平台的一行安装命令。Windows PowerShell：

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:10808"
$env:HTTP_PROXY = "http://127.0.0.1:10808"
```

macOS：

```bash
export HTTPS_PROXY=http://127.0.0.1:10808
export HTTP_PROXY=http://127.0.0.1:10808
```

## 卸载

Windows：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\CodexQuotaWeather\app\uninstall.ps1"
```

保留个人设置：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\CodexQuotaWeather\app\uninstall.ps1" -KeepSettings
```

macOS：

```bash
bash "$HOME/Library/Application Support/CodexQuotaWeather/app/uninstall-macos.sh"
```

macOS 保留个人设置：

```bash
bash "$HOME/Library/Application Support/CodexQuotaWeather/app/uninstall-macos.sh" --keep-settings
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

## 许可证

代码使用 [MIT License](LICENSE)。背景照片不包含在 MIT 许可证内，来源与许可说明见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目不是 OpenAI 官方产品。
