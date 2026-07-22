<div align="center">

# Codex Quota Weather

把 Codex 周额度和今日用量放在桌面上。会下雨、下雪、落花，也会自动跟随 Codex 显示或隐藏。

[English](README.en.md) · [立即安装](#安装) · [使用](#怎么用) · [卸载](#卸载)

![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-2563EB?logo=windows)
![macOS](https://img.shields.io/badge/macOS-13.5%2B-111827?logo=apple)
![Version](https://img.shields.io/badge/version-3.0.0-22C55E)
![License](https://img.shields.io/badge/license-MIT-64748B)

</div>

<img src="docs/images/usage-demo.gif" width="900" alt="Codex Quota Weather 动态使用演示">

## v3.0.0

- 横版、竖版以及四边悬浮条共用同一套天气背景和动态特效。
- 卡片拖到左右边缘变成横向悬浮条，拖到上下边缘自动改成竖向悬浮条；向屏幕内拖动并松开即可还原。
- 完善 Windows CMD 与 macOS 一键安装、`/quota` 启动、自动更新、历史回退和完整卸载。
- 修复切换版式后的缩放、贴边判定、长按变宽、拖出还原与背景切换问题。

## 它能做什么

- 实时显示周额度、本日已用、今日调用和今日会话。
- 横版、竖版、左右悬浮条、上下竖向悬浮条自由切换。
- 内置雨景、流星、花瓣、雪景和海浪，每种天气都有多张背景。
- 跟随 Codex 自动开关，也可以在 Codex 中输入 `/quota` 随时启动或隐藏。
- 在面板内更新、跳过某次更新，或回退到已经安装的历史版本。

所有数据只在本机处理，本地服务仅监听 `127.0.0.1`。

## 安装

安装不需要管理员权限，也不需要提前安装 Node.js。第一次通常需要 1–3 分钟。

### Windows 10 / 11

打开 **CMD**，复制整行运行：

```cmd
curl -fL https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install.cmd -o "%TEMP%\quota-install.cmd" && call "%TEMP%\quota-install.cmd"
```

### macOS 13.5+（Apple Silicon / Intel）

打开“终端”，复制整行运行：

```bash
curl -fsSL https://raw.githubusercontent.com/fantarunning/codex-quota-weather/main/install-macos.sh | bash
```

安装完成后：

1. 重启一次 Codex；
2. 新建任务并输入 `/quota`；
3. 以后即使从托盘退出，也能用 `/quota` 再次启动。

## 怎么用

| 操作 | 结果 |
| --- | --- |
| 点击标题 `Codex` | 横版 → 竖版 → 悬浮条 → 横版 |
| 点击额度圆环 | 切换天气 |
| 滚动鼠标滚轮或点击圆点 | 切换当前天气的背景 |
| 把横版或竖版拖到屏幕边缘 | 左右变成横向悬浮条，上下变成竖向悬浮条 |
| 把悬浮条向屏幕内拖，松开鼠标 | 恢复为卡片 |
| 点击 `+` / `−` 或拖动卡片边缘 | 放大或缩小 |
| 点击铃铛 | 固定在最前面 |
| 托盘图标右键 | 显示、隐藏、重启、自动天气或退出 |

### 五种天气

![五种天气和背景](docs/images/themes-grid.png)

天气默认每 10 分钟自动切换。可在托盘菜单中改成关闭、1、5、10 或 30 分钟。

## 更新与回退

- 只有发现新版本时，面板顶部才会出现下载按钮。
- 点击下载按钮即可更新；也可以选择“跳过此次更新”，该版本将不再提醒。
- 历史版本入口只显示已安装或可下载的正式版本。
- 新版启动失败时，固定启动器会自动恢复上一版。

正式版本来自 GitHub Tag 和 Release。项目仍保留技术仓库名 `codex-quota-weather`，以兼容旧安装、自动更新和 `/quota` 插件。

## 卸载

卸载会关闭进程，并清理应用目录、开机启动项和 `/quota` 插件。

### Windows CMD

```cmd
"%LOCALAPPDATA%\Programs\CodexQuotaWeather\uninstall.cmd"
```

保留窗口位置和个人设置：

```cmd
"%LOCALAPPDATA%\Programs\CodexQuotaWeather\uninstall.cmd" -KeepSettings
```

### macOS 终端

```bash
bash "$HOME/Library/Application Support/CodexQuotaWeather/uninstall-macos.sh"
```

保留个人设置：

```bash
bash "$HOME/Library/Application Support/CodexQuotaWeather/uninstall-macos.sh" --keep-settings
```

## 常见问题

### 安装后没有出现窗口

先重启一次 Codex，再输入 `/quota`。也可以点击 Windows 托盘或 macOS 菜单栏里的 Codex Quota Weather 图标。

### Windows 安装命令看起来没有反应

请复制上面的完整命令，不要删掉 `-fL`、`-o` 或 `call`。首次安装会下载独立的 Node.js 和 Electron，请保持 CMD 窗口打开。

### 日志在哪里

- Windows：`%LOCALAPPDATA%\Programs\CodexQuotaWeather\logs\launcher.log`
- macOS：`~/Library/Application Support/CodexQuotaWeather/logs/launcher.log`

### 安装在哪里

| 平台 | 应用目录 | 个人设置 |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\Programs\CodexQuotaWeather` | `%APPDATA%\CodexQuotaWeather\config.json` |
| macOS | `~/Library/Application Support/CodexQuotaWeather` | 应用目录中的 `config.json` |

## 本地开发

需要 Node.js `>= 22.12.0`：

```bash
git clone https://github.com/fantarunning/codex-quota-weather.git
cd codex-quota-weather
npm ci
npm test
npm start
```

截图与动态演示由当前 Electron 页面生成：

```bash
npm run capture:docs
python scripts/build-doc-gifs.py
```

安全说明见 [SECURITY.md](SECURITY.md)，许可证见 [LICENSE](LICENSE)。
