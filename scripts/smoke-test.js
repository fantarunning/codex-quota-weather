const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { electronExecutable, settingsDataDir } = require("../platform.js");

const ROOT = path.resolve(__dirname, "..");
process.env.QUOTA_WEATHER_DATA_DIR = path.join(ROOT, ".tmp", "test-settings");

const { fetchLiveUsage, normalizeLive } = require("../liveUsage.js");
const { aggregateToday, startDataServer } = require("../server.js");
const { defaultConfig } = require("../settings.js");

function request(port, pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: pathname, method, timeout: 10000 },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.end();
  });
}

function get(port, pathname) {
  return request(port, pathname);
}

async function main() {
  assert.strictEqual(typeof fetchLiveUsage, "function");
  assert.strictEqual(typeof normalizeLive, "function");
  assert(
    fs.existsSync(electronExecutable(ROOT)),
    "Electron runtime is missing; run npm run setup:electron"
  );
  assert(electronExecutable(ROOT, "win32").endsWith(path.join("dist", "electron.exe")));
  assert(
    electronExecutable(ROOT, "darwin").endsWith(
      path.join("Electron.app", "Contents", "MacOS", "Electron")
    )
  );
  assert.strictEqual(
    settingsDataDir({ platform: "darwin", env: {}, home: "/Users/test" }),
    path.join("/Users/test", "Library", "Application Support", "CodexQuotaWeather")
  );
  const defaults = defaultConfig();
  assert.strictEqual(defaults.scale, 0.696);
  assert.strictEqual(defaults.portraitScale, 0.5);
  assert.strictEqual(defaults.minPortraitScale, 0.35);
  assert.strictEqual(defaults.maxPortraitScale, 1.25);
  assert.strictEqual(defaults.windowX, 1213);
  assert.strictEqual(defaults.windowY, 647);
  assert.strictEqual(defaults.skippedUpdateVersion, null);

  for (const file of [
    "main.js",
    "server.js",
    "liveUsage.js",
    "platform.js",
    "preload.js",
    "settings.js",
    "update-manager.js",
    "launcher/launcher.js",
  ]) {
    const source = fs
      .readFileSync(path.join(ROOT, file), "utf8")
      .replace(/^#![^\r\n]*(?:\r?\n|$)/, "");
    new Function("require", "module", "exports", source);
  }

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, "index.html must contain an inline renderer script");
  new Function(scriptMatch[1]);
  for (const theme of ["rain", "meteor", "blossom", "snow", "beach"]) {
    assert(html.includes(`id: '${theme}'`), `renderer is missing theme ${theme}`);
  }
  assert(html.includes("DEMO_MODE"), "renderer demo mode is missing");
  assert(html.includes('id="btn-update"'), "renderer update button is missing");
  assert(html.includes('id="update-popover"'), "renderer update popover is missing");
  assert(html.includes('id="update-skip"'), "renderer skip-update action is missing");
  assert(html.includes('id="mini-calls"'), "portrait mini metrics are incomplete");
  assert(html.includes("mode === 'mini' ? { width: 240, height: 520 }"), "portrait weather viewport is missing");
  assert(html.includes('onclick="miniToggleWeather(event)"'), "portrait weather switch is missing");
  assert(html.includes('onclick="cycleLayout(event)"'), "Codex layout switch is missing");
  assert(html.includes('id="mini-bg-switcher"'), "portrait background switcher is missing");
  assert(html.includes('onclick="changeBgInTheme(event)"'), "portrait background click action is missing");
  assert(html.includes('id="edge-dock"'), "edge-docked weekly quota view is missing");
  assert(html.includes('id="dock-ring-fg"'), "edge dock progress ring is missing");
  assert(html.includes('id="dock-live-dot"'), "edge dock live status is missing");
  assert(html.includes('id="dock-bg-switcher"'), "edge dock background switcher is missing");
  assert(html.includes('#dock-bg-switcher span.active'), "edge dock active-background indicator style is missing");
  assert(html.includes('flex-direction: column'), "edge dock background switcher is not vertical");
  assert(html.includes('onclick="changeBgInTheme(event)" onpointerdown="event.stopPropagation()"'), "edge dock background switcher is not independently clickable");
  assert(!html.includes('id="dock-effect-canvas"'), "edge dock still has a separate weather layer");
  assert(html.includes('id="dock-pct"'), "edge dock does not expose the weekly percentage");
  assert(!html.includes('id="dock-pct-unit"'), "reference HUD should not show a percent sign inside the ring");
  assert(!html.includes('id="dock-label"'), "edge dock still shows the weekly quota label");
  assert(html.includes('#edge-dock:hover::after'), "edge dock accent bar has no hover expansion");
  assert(html.includes('onpointerdown="dockDown(event)"'), "edge dock pointer drag is missing");
  assert(html.includes('onclick="dockToggleWeather(event)"'), "edge dock ring does not switch weather like the card ring");
  assert(html.includes('onclick="dockToggleLayout(event)"'), "edge dock Codex title does not switch layout like the card title");
  assert(html.includes('onkeydown="dockLayoutKey(event)">Codex <i id="dock-live-dot"></i>'), "edge dock title casing does not match the card");
  assert(html.includes("verticalDock ? { width: 52, height: 128 } : { width: 128, height: 52 }"), "oriented edge dock weather viewport is missing");
  assert(html.includes("const docked = document.body.classList.contains('view-dock')"), "edge dock weather density is not optimized");
  assert(html.includes("const count = docked ? 8 : 75"), "edge dock rain density does not scale down from the card");
  assert(html.includes("const rainScale = docked ? 0.62 : 1"), "edge dock rain size does not use the calibrated compact scale");
  assert(!html.includes("dockRain"), "edge dock still uses a weather effect that differs from the card");
  assert(html.includes("body.view-dock #quota-app-container .overlay { opacity: 0.18; }"), "edge dock overlay still hides the weather background");
  assert(html.includes('body.view-dock[data-dock-side="right"] #quota-app-container'), "edge-only corner styling is not scoped to the dock view");
  assert(html.includes('border-radius: 10px 0 0 10px; border-right: 0;'), "right-attached dock lost its exposed rounded corners");
  assert(html.includes('border-radius: 0 10px 10px 0; border-left: 0;'), "left-attached dock lost its exposed rounded corners");
  assert(html.includes('border-radius: 0 0 10px 10px; border-top: 0;'), "top-attached dock styling is missing");
  assert(html.includes('border-radius: 10px 10px 0 0; border-bottom: 0;'), "bottom-attached dock styling is missing");
  assert(html.includes('body.view-dock[data-dock-side="top"] #edge-dock::after'), "top-attached dock accent does not follow the edge");
  assert(html.includes('body.view-dock[data-dock-side="bottom"] #edge-dock::after'), "bottom-attached dock accent does not follow the edge");
  assert(html.includes('flex-direction: column; justify-content: center; gap: 8px;'), "top/bottom dock content is not vertical");
  assert(html.includes('flex-direction: row; transform: translateX(-50%);'), "top/bottom background switcher is not horizontal");
  assert(!html.includes('-15px 0 40px rgba(0,0,0,0.60)'), "right-attached dock still has a clipped outer shadow");
  assert(!html.includes('15px 0 40px rgba(0,0,0,0.60)'), "left-attached dock still has a clipped outer shadow");
  assert(!html.includes('-20px 0 50px rgba(0,0,0,0.80)'), "hovered edge dock still has a clipped outer shadow");
  assert(html.includes("document.body.classList.contains('view-dock')"), "edge dock wheel background switching is missing");
  assert(html.includes("animateDockPercentage"), "edge dock number does not animate with its progress ring");
  assert(html.includes("'.mini-mode-dots, #dock-bg-switcher'"), "compact background indicators are not synchronized");
  assert(!html.includes('id="orb"'), "legacy floating orb is still present");
  assert(html.includes("SHELL && SHELL.minimize"), "minus button does not minimize to the tray");
  const mainSource = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(ROOT, "preload.js"), "utf8");
  assert(mainSource.includes("quota:skip-update"), "skip-update IPC handler is missing");
  assert(mainSource.includes("panelControl: controlPanel"), "main process does not expose local panel controls");
  assert(mainSource.includes("detectEdgeDockSide"), "automatic edge docking is missing");
  assert(mainSource.includes("const signedGaps ="), "edge docking does not tolerate a native drag past the display boundary");
  const edgeDetectionSource = mainSource.slice(
    mainSource.indexOf("function detectEdgeDockSide"),
    mainSource.indexOf("function nearestDockSide")
  );
  assert(!edgeDetectionSource.includes("Math.abs(bounds.x - area.x)"), "edge docking still rejects cards that overshoot the display boundary");
  assert(mainSource.includes("const DOCK_SIDES = ['left', 'right', 'top', 'bottom'];"), "four-edge docking is incomplete");
  assert(mainSource.includes("nearestDockSide"), "layout cycling does not select the nearest of four edges");
  assert(mainSource.includes("animateWindowBounds"), "layout switching does not animate real window bounds");
  assert(mainSource.includes("if (viewMode === 'mini')"), "portrait title does not participate in the three-layout cycle");
  assert(mainSource.includes("setView('dock', { side });"), "portrait Codex title does not switch to the nearest edge dock");
  assert(mainSource.includes("quota:dock-drag-start"), "edge dock drag IPC is missing");
  assert(mainSource.includes("quota:dock-drag-move"), "edge dock does not follow the cursor while held");
  assert(mainSource.includes("positionDockDuringDrag"), "edge dock held-drag smoothing is missing");
  assert(mainSource.includes("|| !resizeState"), "programmatic layout resizing can still overwrite the saved user scale");
  assert(mainSource.includes("cancelViewMorph();"), "edge dock drag does not cancel stale layout animation");
  assert(mainSource.includes("width: size.w, height: size.h"), "edge dock drag does not lock its oriented compact size");
  assert(mainSource.includes("dockSizeFor(dockSide)"), "edge dock window size does not follow its side");
  assert(!mainSource.includes("quota:dock-pull-out"), "edge dock still restores before mouse release");
  assert(preloadSource.includes("dockDragMove"), "renderer does not stream dock drag positions");
  assert(preloadSource.includes("dockDragEnd: (result)"), "renderer does not report the release-time dock result");
  assert(mainSource.includes("DOCK_UNDOCK_THRESHOLD"), "edge dock cannot be dragged back into a card");
  assert(mainSource.includes("restoreDockFromDrag"), "edge dock restore-drag behavior is missing");
  assert(mainSource.includes("releasedSide"), "a held dock cannot be moved directly to another display edge");
  assert(mainSource.includes("重启 / Restart"), "tray restart action is missing");
  assert(mainSource.includes("app.relaunch"), "tray restart does not relaunch the application");
  assert(mainSource.includes("userHidden = true; hidePanel()"), "tray-only minimize handler is missing");
  assert(!mainSource.includes("'orb'"), "legacy orb view mode is still present");
  assert(!mainSource.includes("版本与更新 / Version & updates"), "tray still contains the version/update menu");
  const macInstaller = fs.readFileSync(path.join(ROOT, "install-macos.sh"), "utf8");
  assert(!macInstaller.includes("$($NODE "), "macOS installer invokes the private Node path without quotes");
  assert(macInstaller.includes("wait_for_local_panel"), "macOS installer does not verify panel startup");
  assert(macInstaller.includes("the panel has been opened"), "macOS installer does not confirm that the panel opened");
  const windowsEntry = fs.readFileSync(path.join(ROOT, "install.cmd"), "utf8");
  assert(windowsEntry.includes("Starting installer"), "Windows CMD installer has no immediate progress message");
  const windowsInstaller = fs.readFileSync(path.join(ROOT, "install.ps1"), "utf8");
  assert(windowsInstaller.includes("Wait-ForLocalPanel"), "Windows installer does not verify panel startup");
  assert(windowsInstaller.includes("manage-codex-plugin.js"), "Windows installer does not deploy the /quota plugin");
  assert(macInstaller.includes("manage-codex-plugin.js"), "macOS installer does not deploy the /quota plugin");
  const pluginRoot = path.join(ROOT, "codex-plugin", "quota-weather");
  const pluginManifest = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8")
  );
  assert.strictEqual(pluginManifest.name, "quota-weather");
  assert.deepStrictEqual(pluginManifest.interface.defaultPrompt, ["/quota"]);
  assert(fs.existsSync(path.join(pluginRoot, "scripts", "show-quota.sh")));
  assert(fs.existsSync(path.join(pluginRoot, "scripts", "show-quota.ps1")));

  const pluginTestHome = path.join(ROOT, ".tmp", "codex-plugin-management");
  const pluginTestConfig = path.join(pluginTestHome, ".codex", "config.toml");
  const pluginTestMarketplace = path.join(pluginTestHome, ".agents", "plugins", "marketplace.json");
  fs.rmSync(pluginTestHome, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(pluginTestConfig), { recursive: true });
  fs.mkdirSync(path.dirname(pluginTestMarketplace), { recursive: true });
  fs.writeFileSync(pluginTestConfig, '[plugins."other@personal"]\nenabled = true\n', "utf8");
  fs.writeFileSync(
    pluginTestMarketplace,
    JSON.stringify({
      name: "personal",
      interface: { displayName: "My Personal Plugins" },
      plugins: [{
        name: "other",
        source: { source: "local", path: "./plugins/other" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      }],
    }, null, 2) + "\n",
    "utf8"
  );
  const pluginManager = path.join(ROOT, "scripts", "manage-codex-plugin.js");
  const pluginEnv = {
    ...process.env,
    CODEX_QUOTA_WEATHER_PLUGIN_HOME: pluginTestHome,
    CODEX_HOME: path.join(pluginTestHome, ".codex"),
  };
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const installPlugin = spawnSync(process.execPath, [pluginManager, "install", pluginRoot], {
      cwd: ROOT,
      env: pluginEnv,
      encoding: "utf8",
    });
    assert.strictEqual(installPlugin.status, 0, installPlugin.stderr || installPlugin.stdout);
  }
  assert(fs.existsSync(path.join(pluginTestHome, "plugins", "quota-weather", "skills", "quota", "SKILL.md")));
  const installedMarketplace = JSON.parse(fs.readFileSync(pluginTestMarketplace, "utf8"));
  assert.strictEqual(installedMarketplace.interface.displayName, "My Personal Plugins");
  assert.deepStrictEqual(installedMarketplace.plugins.map((entry) => entry.name), ["other", "quota-weather"]);
  const installedPluginConfig = fs.readFileSync(pluginTestConfig, "utf8");
  assert(installedPluginConfig.includes('[plugins."other@personal"]'));
  assert(installedPluginConfig.includes('[plugins."quota-weather@personal"]'));

  const removePlugin = spawnSync(process.execPath, [pluginManager, "remove"], {
    cwd: ROOT,
    env: pluginEnv,
    encoding: "utf8",
  });
  assert.strictEqual(removePlugin.status, 0, removePlugin.stderr || removePlugin.stdout);
  assert(!fs.existsSync(path.join(pluginTestHome, "plugins", "quota-weather")));
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(pluginTestMarketplace, "utf8")).plugins.map((entry) => entry.name),
    ["other"]
  );
  assert(!fs.readFileSync(pluginTestConfig, "utf8").includes('[plugins."quota-weather@personal"]'));
  fs.rmSync(pluginTestHome, { recursive: true, force: true });
  const ciWorkflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert(ciWorkflow.includes("Directory With Spaces/CodexQuotaWeather-CI"), "macOS CI install path must exercise spaces");
  assert(ciWorkflow.includes('uninstall.cmd'), "Windows CI does not exercise the installed CMD uninstaller");
  assert(ciWorkflow.includes('$CODEX_QUOTA_WEATHER_INSTALL_DIR/uninstall-macos.sh'), "macOS CI does not exercise the installed uninstaller");
  const installPowerShell = fs.readFileSync(path.join(ROOT, "install.ps1"), "utf8");
  const uninstallPowerShell = fs.readFileSync(path.join(ROOT, "uninstall.ps1"), "utf8");
  const uninstallMac = fs.readFileSync(path.join(ROOT, "uninstall-macos.sh"), "utf8");
  assert(fs.existsSync(path.join(ROOT, "uninstall.cmd")), "short Windows CMD uninstaller is missing");
  assert(installPowerShell.includes('"uninstall.cmd"'), "Windows installer does not deploy uninstall.cmd");
  assert(installPowerShell.includes('-Raw -Encoding UTF8 | ConvertFrom-Json'), "Windows installer cannot parse the Chinese product name under PowerShell 5");
  assert(uninstallPowerShell.includes('"Quota Window.lnk"'), "Windows uninstaller does not remove the temporary preview startup entry");
  assert(uninstallMac.includes('[ "$PID" != "$$" ]'), "macOS installed uninstaller can terminate its own shell");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert(readme.includes("# Codex Quota Weather"), "README does not use the current project name");
  assert(readme.includes("docs/images/usage-demo.gif"), "README does not show the current usage demo");
  assert(readme.includes('"%LOCALAPPDATA%\\Programs\\CodexQuotaWeather\\uninstall.cmd"'), "README is missing the short Windows uninstall command");
  assert(fs.existsSync(path.join(ROOT, "docs", "images", "usage-demo.gif")), "usage demo has not been generated");

  const fixtureRoot = path.join(ROOT, ".tmp", "cross-midnight-sessions");
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const previousDir = path.join(fixtureRoot, "2026", "01", "01");
  const todayDir = path.join(fixtureRoot, "2026", "01", "02");
  fs.mkdirSync(previousDir, { recursive: true });
  fs.mkdirSync(todayDir, { recursive: true });
  const at = (day, hour, minute) => new Date(2026, 0, day, hour, minute, 0).toISOString();
  const meta = (timestamp, id) =>
    JSON.stringify({ timestamp, type: "session_meta", payload: { id, cwd: ROOT } });
  const tokens = (timestamp, total, last) =>
    JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: total },
          last_token_usage: { total_tokens: last },
          model_context_window: 1000,
        },
      },
    });
  const overnightFile = path.join(previousDir, "rollout-overnight.jsonl");
  fs.writeFileSync(
    overnightFile,
    [
      meta(at(1, 20, 0), "overnight"),
      tokens(at(1, 23, 50), 100, 100),
      tokens(at(2, 0, 30), 160, 60),
      tokens(at(2, 1, 0), 230, 70),
      "",
    ].join("\n"),
    "utf8"
  );
  const fixtureNow = new Date(2026, 0, 2, 12, 0, 0);
  let fixtureStats = aggregateToday(
    { dailyBudgetTokens: 1000 },
    { now: fixtureNow, sessionsDir: fixtureRoot, files: [overnightFile] }
  );
  assert.strictEqual(fixtureStats.daily.used, 130, "overnight usage must use today's delta");
  assert.strictEqual(fixtureStats.callsToday, 2, "overnight calls must be split at midnight");
  assert.strictEqual(fixtureStats.sessionsToday, 1, "active overnight session must count today");

  fs.appendFileSync(overnightFile, tokens(at(2, 3, 0), 260, 30) + "\n", "utf8");
  fixtureStats = aggregateToday(
    { dailyBudgetTokens: 1000 },
    { now: fixtureNow, sessionsDir: fixtureRoot, files: [overnightFile] }
  );
  assert.strictEqual(fixtureStats.daily.used, 160, "appended usage must be parsed incrementally");
  assert.strictEqual(fixtureStats.callsToday, 3, "appended call must update immediately");

  const newSessionFile = path.join(todayDir, "rollout-today.jsonl");
  fs.writeFileSync(
    newSessionFile,
    [meta(at(2, 4, 0), "today"), tokens(at(2, 4, 5), 40, 40), ""].join("\n"),
    "utf8"
  );
  fixtureStats = aggregateToday(
    { dailyBudgetTokens: 1000 },
    { now: fixtureNow, sessionsDir: fixtureRoot }
  );
  assert.strictEqual(fixtureStats.daily.used, 200);
  assert.strictEqual(fixtureStats.callsToday, 4);
  assert.strictEqual(fixtureStats.sessionsToday, 2);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });

  const backgrounds = fs
    .readdirSync(path.join(ROOT, "assets", "backgrounds"))
    .filter((name) => name.endsWith(".jpg"));
  assert.strictEqual(backgrounds.length, 15, "expected 15 bundled backgrounds");
  for (const name of backgrounds) {
    const bytes = fs.readFileSync(path.join(ROOT, "assets", "backgrounds", name));
    assert(bytes.length > 10000, `${name} is unexpectedly small`);
    assert.strictEqual(bytes[0], 0xff, `${name} is not a JPEG`);
    assert.strictEqual(bytes[1], 0xd8, `${name} is not a JPEG`);
  }

  const port = 19000 + Math.floor(Math.random() * 1000);
  const panelActions = [];
  const server = startDataServer({
    port,
    disableLiveUsage: true,
    panelControl(action) {
      panelActions.push(action);
      return { action, visible: action !== "hide" };
    },
  });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const health = await get(port, "/health");
    assert.strictEqual(health.status, 200);
    assert.strictEqual(JSON.parse(health.body.toString("utf8")).ok, true);

    const panel = await request(port, "/panel/toggle", "POST");
    assert.strictEqual(panel.status, 200);
    assert.deepStrictEqual(panelActions, ["toggle"]);
    assert.deepStrictEqual(JSON.parse(panel.body.toString("utf8")), {
      ok: true,
      action: "toggle",
      visible: true,
    });

    const quota = await get(port, "/quota");
    assert.strictEqual(quota.status, 200);
    const payload = JSON.parse(quota.body.toString("utf8"));
    assert.strictEqual(payload.ok, true);
    assert(payload.daily && payload.context, "quota payload is incomplete");

    const page = await get(port, "/?demo=1&theme=rain");
    assert.strictEqual(page.status, 200);
    assert(page.body.toString("utf8").includes("Codex 额度"));

    const image = await get(port, "/assets/backgrounds/rain-1.jpg");
    assert.strictEqual(image.status, 200);
    assert.strictEqual(image.headers["content-type"], "image/jpeg");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  fs.rmSync(path.join(ROOT, ".tmp", "test-settings"), { recursive: true, force: true });
  console.log("Smoke test passed: syntax, assets, local API, and demo renderer.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
