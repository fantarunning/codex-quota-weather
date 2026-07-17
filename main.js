// Quota-Weather — standalone tray app (direction A).
//
// One resident Electron process that combines four jobs, so nothing extra runs:
//   1. DATA SERVER   — startDataServer() from server.js, in-process (port 8787),
//      serving /quota and the panel HTML.
//   2. WATCHDOG      — polls for codex.exe every few seconds (Get-Process, no
//      admin, ~0.02% CPU). Codex appears → show panel. Codex gone → hide panel.
//   3. TRAY ICON     — a system-tray icon (NOT a taskbar button). Left-click
//      toggles the panel; right-click menu: show/hide, follow-Codex on/off, quit.
//   4. PANEL WINDOW  — the frameless/transparent/on-top card (index.html).
//
// The panel window itself uses skipTaskbar so it never shows a taskbar button;
// the tray icon is the only persistent UI affordance.

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { loadConfig, updateConfig } = require('./settings.js');

const APP_DIR = __dirname;
const SMOKE_MODE = process.env.QUOTA_WEATHER_SMOKE === '1';

// ---- config ---------------------------------------------------------------

const CARD_W = 680;
const CARD_H = 380;
// Keep the BrowserWindow flush with the card. The page clips its rounded
// corners, while the transparent BrowserWindow lets those corner pixels show
// the desktop instead of leaving a dark-looking outer gutter.
const PAD = 0;
const OUTER_W = CARD_W + PAD * 2;
const OUTER_H = CARD_H + PAD * 2;

let cfg = loadConfig();

let scale = clampScale(cfg.scale || 0.8);
let win = null;
let tray = null;
let trayMenu = null;
let dataServer = null;
let watchTimer = null;
let weatherSwitchTimer = null;
let smokeTimer = null;
let followCodex = cfg.followCodex !== false;
let userHidden = false; // set true when the user manually hides while Codex runs
let minimized = false;  // true when the card is collapsed to the floating orb
let cardBounds = null;  // remembered card window bounds, to restore after un-minimizing

const ORB = 76; // floating-orb window size in px (square)

function clampScale(s) {
  const min = cfg.minScale || 0.5;
  const max = cfg.maxScale || 1.4;
  return Math.min(max, Math.max(min, Number(s) || 0.8));
}
function outerSizeFor(s) {
  return { w: Math.round(OUTER_W * s), h: Math.round(OUTER_H * s) };
}
function initialPosition(w, h) {
  const primaryArea = screen.getPrimaryDisplay().workArea;
  const savedX = Number(cfg.windowX);
  const savedY = Number(cfg.windowY);
  if (cfg.windowX == null || cfg.windowY == null || !Number.isFinite(savedX) || !Number.isFinite(savedY)) {
    return {
      x: Math.max(primaryArea.x, primaryArea.x + primaryArea.width - w - 20),
      y: Math.max(primaryArea.y, primaryArea.y + primaryArea.height - h - 20),
    };
  }
  const display = screen.getDisplayNearestPoint({ x: Math.round(savedX), y: Math.round(savedY) });
  const area = display.workArea;
  return {
    x: Math.min(area.x + area.width - w, Math.max(area.x, Math.round(savedX))),
    y: Math.min(area.y + area.height - h, Math.max(area.y, Math.round(savedY))),
  };
}

// ---- panel window ---------------------------------------------------------

function createWindow() {
  if (win) return win;
  const { w, h } = outerSizeFor(scale);
  const { x, y } = initialPosition(w, h);

  win = new BrowserWindow({
    width: w, height: h, x, y,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    alwaysOnTop: !!cfg.alwaysOnTop,
    skipTaskbar: true,        // no taskbar button — tray is the only persistent UI
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'Codex Quota',
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: scale,
    },
  });

  win.setMenu(null);
  win.setSkipTaskbar(true);
  if (cfg.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
  win.setAspectRatio(OUTER_W / OUTER_H);
  const mn = outerSizeFor(cfg.minScale || 0.5);
  const mx = outerSizeFor(cfg.maxScale || 1.4);
  win.setMinimumSize(mn.w, mn.h);
  win.setMaximumSize(mx.w, mx.h);

  const base = 'http://127.0.0.1:' + cfg.port;
  const url = base + '/?server=' + encodeURIComponent(base) +
    '&lang=' + encodeURIComponent(cfg.lang || 'zh') +
    '&scale=' + scale +
    '&theme=' + encodeURIComponent(cfg.defaultTheme || 'rain') +
    '&bg=' + encodeURIComponent(Math.max(0, Number(cfg.defaultBackgroundIndex) || 0));
  win.loadURL(url);

  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(scale);
    resetWeatherSwitchTimer();
    if (SMOKE_MODE) {
      win.webContents.executeJavaScript(`({
        theme: document.getElementById('quota-app-container').dataset.theme,
        title: document.querySelector('.header-title').textContent
      })`).then(async (state) => {
        if (!state || state.theme !== (cfg.defaultTheme || 'rain') || !state.title) {
          throw new Error('renderer state is incomplete');
        }
        const expectedScale = scale;
        minimizeToOrb();
        await new Promise((resolve) => setTimeout(resolve, 900));
        if (Math.abs(Number(loadConfig().scale) - expectedScale) > 0.001) {
          throw new Error('minimizing to the orb overwrote the saved card scale');
        }
        restoreFromOrb();
        console.log(`[quota-weather] full app smoke passed on ${process.platform}/${process.arch}`);
        setTimeout(quitAll, 100);
      }).catch((error) => {
        console.error('[quota-weather] full app smoke failed:', error);
        app.exit(1);
      });
    }
  });

  // native edge-drag resize → recompute zoom so the card scales proportionally
  win.on('resize', () => {
    // The compact orb is a temporary window shape, not a card resize. Persisting
    // its 76 px width would clamp and overwrite the user's card scale with 0.5.
    if (!win || minimized) return;
    const [cw] = win.getContentSize();
    scale = clampScale(cw / OUTER_W);
    win.webContents.setZoomFactor(scale);
    if (win.webContents) win.webContents.send('quota:scale-state', scale);
    persistScale(scale);
  });
  win.on('move', () => persistWindowPosition());

  win.on('closed', () => { win = null; });
  return win;
}

function showPanel() {
  createWindow();
  if (!win.isVisible()) win.show();
  win.setAlwaysOnTop(!!cfg.alwaysOnTop, 'screen-saver');
  userHidden = false;
  updateTrayMenu();
}
function hidePanel() {
  if (win && win.isVisible()) win.hide();
  updateTrayMenu();
}
function togglePanel() {
  if (win && win.isVisible()) { userHidden = true; hidePanel(); }
  else { showPanel(); }
}

// ---- minimize to floating orb / restore to card --------------------------
// Minimizing shrinks the window to a small square orb docked near where the
// card was; the renderer switches to its mini view (shows the % in a ball).
// Clicking the orb (renderer sends quota:restore) expands back to the card.

function minimizeToOrb() {
  if (!win || minimized) return;
  cardBounds = win.getBounds(); // remember where/how big the card was
  minimized = true;
  // dock the orb at the card's top-right corner area
  const area = screen.getPrimaryDisplay().workAreaSize;
  const ox = Math.min(area.width - ORB - 12, cardBounds.x + cardBounds.width - ORB - 12);
  const oy = Math.max(12, cardBounds.y + 12);
  win.setResizable(false);
  win.setMinimumSize(ORB, ORB);
  win.setMaximumSize(ORB, ORB);
  win.setBounds({ x: Math.round(ox), y: Math.round(oy), width: ORB, height: ORB });
  win.webContents.setZoomFactor(1);
  if (win.webContents) win.webContents.send('quota:view', 'orb');
  updateTrayMenu();
}

function restoreFromOrb() {
  if (!win || !minimized) return;
  minimized = false;
  const mn = outerSizeFor(cfg.minScale || 0.5);
  const mx = outerSizeFor(cfg.maxScale || 1.4);
  win.setMinimumSize(mn.w, mn.h);
  win.setMaximumSize(mx.w, mx.h);
  win.setResizable(true);
  const b = cardBounds || (() => { const s = outerSizeFor(scale); const a = screen.getPrimaryDisplay().workAreaSize; return { x: a.width - s.w - 20, y: a.height - s.h - 20, width: s.w, height: s.h }; })();
  win.setBounds(b);
  win.webContents.setZoomFactor(scale);
  if (win.webContents) win.webContents.send('quota:view', 'card');
  updateTrayMenu();
}

// ---- scale persistence ----------------------------------------------------

let persistTimer = null;
let persistWindowTimer = null;
function persistScale(s) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      cfg = updateConfig({ scale: Number(s.toFixed(3)) });
    } catch (_) { /* best effort */ }
  }, 700);
}
function persistWindowPosition() {
  clearTimeout(persistWindowTimer);
  persistWindowTimer = setTimeout(() => {
    if (!win || minimized) return;
    try {
      const b = win.getBounds();
      cfg = updateConfig({ windowX: b.x, windowY: b.y });
    } catch (_) { /* best effort */ }
  }, 700);
}
function persistFollow(v) {
  try {
    cfg = updateConfig({ followCodex: v });
  } catch (_) { /* best effort */ }
}
function persistWeatherSwitchInterval(ms) {
  try {
    cfg = updateConfig({ weatherSwitchIntervalMs: ms });
  } catch (_) { /* best effort */ }
}

function applyScale(next) {
  if (!win) return;
  const s = clampScale(next);
  const b = win.getContentBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const { w, h } = outerSizeFor(s);
  win.setContentBounds({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h });
}

// ---- watchdog: follow Codex Desktop / CLI (no admin, cheap polling) --------

function watchedProcessNames() {
  const configured = Array.isArray(cfg.watchProcesses) ? [...cfg.watchProcesses] : [];
  if (cfg.watchProcess) configured.push(cfg.watchProcess);
  const processNames = [...new Set(configured)]
    .map((name) => String(name).replace(/\.exe$/i, ''))
    .filter((name) => /^[a-z0-9._-]+$/i.test(name));
  if (!processNames.length) processNames.push('Codex', 'ChatGPT');
  return processNames;
}

function codexRunningWindows(processNames) {
  return new Promise((resolve) => {
    const quotedNames = processNames.map((name) => `'${name}'`).join(',');
    const command =
      `$found = Get-Process -Name @(${quotedNames}) -ErrorAction SilentlyContinue; ` +
      `if ($found) { 'yes' } else { 'no' }`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err) return resolve(null); // unknown (don't flap on a transient error)
        resolve(/yes/i.test(stdout || ''));
      }
    );
  });
}

function codexRunningPosix(processNames) {
  return new Promise((resolve) => {
    const pattern = processNames
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    execFile(
      '/usr/bin/pgrep',
      ['-x', pattern],
      { timeout: 4000 },
      (err, stdout) => {
        if (!err) return resolve(Boolean(String(stdout || '').trim()));
        if (Number(err.code) === 1) return resolve(false);
        resolve(null);
      }
    );
  });
}

function codexRunning() {
  const processNames = watchedProcessNames();
  if (process.platform === 'win32') return codexRunningWindows(processNames);
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return codexRunningPosix(processNames);
  }
  return Promise.resolve(null);
}

let lastCodexState = null;
async function watchTick() {
  if (!followCodex) return;
  const running = await codexRunning();
  if (running === null) return; // transient; keep current state
  if (running && lastCodexState !== true) {
    // Codex just appeared (or first tick with it running)
    if (!userHidden) showPanel();
  } else if (!running && lastCodexState !== false) {
    // Codex just went away → hide the panel (keep tray + server alive)
    hidePanel();
    userHidden = false;
  }
  lastCodexState = running;
}

function startWatchdog() {
  if (watchTimer) clearInterval(watchTimer);
  watchTick();
  watchTimer = setInterval(watchTick, cfg.watchIntervalMs || 4000);
}

// ---- automatic weather rotation -----------------------------------------

function resetWeatherSwitchTimer() {
  if (weatherSwitchTimer) {
    clearInterval(weatherSwitchTimer);
    weatherSwitchTimer = null;
  }
  const ms = Number(cfg.weatherSwitchIntervalMs) || 0;
  if (ms <= 0) return;
  weatherSwitchTimer = setInterval(() => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('quota:next-weather');
  }, ms);
}

function setWeatherSwitchInterval(ms) {
  cfg.weatherSwitchIntervalMs = Math.max(0, Number(ms) || 0);
  persistWeatherSwitchInterval(cfg.weatherSwitchIntervalMs);
  resetWeatherSwitchTimer();
  updateTrayMenu();
}

// ---- tray -----------------------------------------------------------------

function buildTray() {
  const iconPath = path.join(APP_DIR, 'tray-icon.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) {
    // fallback: a tiny 1x1 so Tray still constructs
    img = nativeImage.createEmpty();
  }
  if (process.platform === 'darwin' && !img.isEmpty()) {
    img = img.resize({ width: 18, height: 18 });
    img.setTemplateImage(true);
  }
  tray = new Tray(img);
  tray.setToolTip('Codex Quota');
  tray.on('click', () => togglePanel());
  tray.on('right-click', () => {
    if (trayMenu) tray.popUpContextMenu(trayMenu);
  });
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = !!(win && win.isVisible());
  const weatherInterval = Number(cfg.weatherSwitchIntervalMs) || 0;
  const menu = Menu.buildFromTemplate([
    { label: visible ? '隐藏浮窗 / Hide' : '显示浮窗 / Show', click: () => togglePanel() },
    { type: 'separator' },
    {
      label: '跟随 Codex 自动开关 / Follow Codex',
      type: 'checkbox',
      checked: followCodex,
      click: (item) => {
        followCodex = item.checked;
        persistFollow(followCodex);
        lastCodexState = null; // re-evaluate on next tick
        if (followCodex) watchTick();
      },
    },
    {
      label: '自动切换天气 / Auto weather',
      submenu: [
        { label: '关闭 / Off', type: 'radio', checked: weatherInterval === 0, click: () => setWeatherSwitchInterval(0) },
        { label: '每 1 分钟 / 1 minute', type: 'radio', checked: weatherInterval === 60 * 1000, click: () => setWeatherSwitchInterval(60 * 1000) },
        { label: '每 5 分钟 / 5 minutes', type: 'radio', checked: weatherInterval === 5 * 60 * 1000, click: () => setWeatherSwitchInterval(5 * 60 * 1000) },
        { label: '每 10 分钟 / 10 minutes', type: 'radio', checked: weatherInterval === 10 * 60 * 1000, click: () => setWeatherSwitchInterval(10 * 60 * 1000) },
        { label: '每 30 分钟 / 30 minutes', type: 'radio', checked: weatherInterval === 30 * 60 * 1000, click: () => setWeatherSwitchInterval(30 * 60 * 1000) },
      ],
    },
    { type: 'separator' },
    { label: '退出 / Quit', click: () => quitAll() },
  ]);
  trayMenu = menu;
  if (process.platform !== 'darwin') tray.setContextMenu(menu);
}

// ---- IPC from renderer ----------------------------------------------------

ipcMain.on('quota:close', () => { userHidden = true; hidePanel(); });
ipcMain.on('quota:toggle-pin', () => {
  if (!win) return;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, 'screen-saver');
  if (win.webContents) win.webContents.send('quota:pin-state', next);
});
ipcMain.handle('quota:get-pin', () => (win ? win.isAlwaysOnTop() : false));
ipcMain.on('quota:scale', (_e, delta) => applyScale(scale + delta));
ipcMain.handle('quota:get-scale', () => scale);
ipcMain.on('quota:minimize', () => minimizeToOrb());
ipcMain.on('quota:restore', () => restoreFromOrb());
ipcMain.on('quota:weather-interaction', () => resetWeatherSwitchTimer());

// orb drag: move the whole (tiny) window following the OS cursor
let orbDragTimer = null;
let orbDragOffset = null;
ipcMain.on('quota:orb-drag-start', () => {
  if (!win || !minimized) return;
  const b = win.getBounds();
  const c = screen.getCursorScreenPoint();
  orbDragOffset = { dx: c.x - b.x, dy: c.y - b.y };
  if (orbDragTimer) clearInterval(orbDragTimer);
  orbDragTimer = setInterval(() => {
    if (!win || !minimized || !orbDragOffset) return;
    const p = screen.getCursorScreenPoint();
    win.setBounds({ x: p.x - orbDragOffset.dx, y: p.y - orbDragOffset.dy, width: ORB, height: ORB });
  }, 16);
});
ipcMain.on('quota:orb-drag-end', () => {
  if (orbDragTimer) { clearInterval(orbDragTimer); orbDragTimer = null; }
  orbDragOffset = null;
});

// ---- edge/corner resize (window-like, aspect-locked) ----------------------
// A transparent frameless window has no native resize border on Windows, so we
// implement it: the renderer's invisible edge/corner grips send the grabbed
// direction; we then follow the OS cursor, keeping the OPPOSITE edge/corner
// anchored and the aspect ratio locked, deriving scale from the drag distance.
let resizeState = null;
let resizeTimer = null;

ipcMain.on('quota:resize-start', (_e, dir) => {
  if (!win) return;
  const b = win.getContentBounds();
  // anchor = the point that must stay fixed (opposite of the grabbed handle)
  const anchor = {
    x: /w/.test(dir) ? b.x + b.width : b.x, // grabbing west → right edge fixed
    y: /n/.test(dir) ? b.y + b.height : b.y, // grabbing north → bottom fixed
  };
  resizeState = { dir, anchor };
  if (resizeTimer) clearInterval(resizeTimer);
  resizeTimer = setInterval(resizeTick, 16); // ~60fps
});

function resizeTick() {
  if (!win || !resizeState) return;
  const { dir, anchor } = resizeState;
  const p = screen.getCursorScreenPoint();

  // distance from anchor to cursor along each axis (absolute)
  const dx = Math.abs(p.x - anchor.x);
  const dy = Math.abs(p.y - anchor.y);

  // desired outer size from whichever axis the handle controls
  let wantW = null;
  if (/[ew]/.test(dir)) wantW = dx;
  let wantH = null;
  if (/[ns]/.test(dir)) wantH = dy;

  // convert to a scale; for corners use the axis that yields the larger scale
  const candidates = [];
  if (wantW != null) candidates.push(wantW / OUTER_W);
  if (wantH != null) candidates.push(wantH / OUTER_H);
  if (!candidates.length) return;
  const s = clampScale(Math.max(...candidates));
  scale = s;
  const { w, h } = outerSizeFor(s);

  // keep the anchor corner/edge fixed
  const nx = /w/.test(dir) ? anchor.x - w : anchor.x;
  const ny = /n/.test(dir) ? anchor.y - h : anchor.y;
  win.setContentBounds({ x: Math.round(nx), y: Math.round(ny), width: w, height: h });
  win.webContents.setZoomFactor(s);
  if (win.webContents) win.webContents.send('quota:scale-state', s);
}

ipcMain.on('quota:resize-end', () => {
  if (resizeTimer) { clearInterval(resizeTimer); resizeTimer = null; }
  resizeState = null;
  persistScale(scale);
});

// ---- lifecycle ------------------------------------------------------------

function quitAll() {
  if (watchTimer) clearInterval(watchTimer);
  if (weatherSwitchTimer) clearInterval(weatherSwitchTimer);
  if (smokeTimer) clearTimeout(smokeTimer);
  try { if (dataServer) dataServer.close(); } catch (_) {}
  if (tray) { tray.destroy(); tray = null; }
  app.quit();
}

// single instance — a second launch just shows the panel
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel());

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    // start the in-process data server
    const { startDataServer } = require('./server.js');
    dataServer = startDataServer({ port: cfg.port, standalone: false });

    buildTray();
    if (SMOKE_MODE) {
      showPanel();
      smokeTimer = setTimeout(() => {
        console.error('[quota-weather] full app smoke timed out');
        app.exit(1);
      }, 15000);
    } else {
      startWatchdog();
    }

    // If Codex is already running at launch, the first watchTick shows the panel.
    // If not, we stay quietly in the tray until Codex appears (or user clicks).
  });
}

// don't quit when the panel is hidden/closed — we live in the tray
app.on('window-all-closed', (e) => { /* keep running in tray */ });
