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
const { UpdateManager, markBootSuccessful } = require('./update-manager.js');

const APP_DIR = __dirname;
const SMOKE_MODE = process.env.QUOTA_WEATHER_SMOKE === '1';
if (process.env.QUOTA_WEATHER_DATA_DIR) {
  const isolatedUserData = path.join(path.resolve(process.env.QUOTA_WEATHER_DATA_DIR), '.electron');
  fs.mkdirSync(isolatedUserData, { recursive: true });
  app.setPath('userData', isolatedUserData);
}

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
if (/^\d+$/.test(process.env.QUOTA_WEATHER_PORT || '')) {
  cfg.port = Math.min(65535, Math.max(1024, Number(process.env.QUOTA_WEATHER_PORT)));
}

let scale = clampScale(cfg.scale || 0.8);
let portraitScale = clampPortraitScale(cfg.portraitScale == null ? 0.5 : cfg.portraitScale);
let win = null;
let tray = null;
let trayMenu = null;
let dataServer = null;
let watchTimer = null;
let weatherSwitchTimer = null;
let smokeTimer = null;
let updateCheckTimer = null;
let updateManager = null;
let followCodex = cfg.followCodex !== false;
let userHidden = false; // set true when the user manually hides while Codex runs
// The title cycles landscape -> portrait -> dock -> landscape. The dock can
// also be entered by dragging either card to the left or right display edge.
let viewMode = 'card';   // 'card' | 'mini' | 'dock'
let cardBounds = null;   // remembered landscape bounds
let undockedViewMode = 'card';
let undockedBounds = null;
let dockSide = 'right';
let suppressResizeSyncUntil = 0;
let suppressEdgeDockUntil = 0;
let edgeDockTimer = null;

const MINI_BASE_W = 240; // portrait layout stays sharp at every window scale
const MINI_BASE_H = 520;
// Pixel comparison against the supplied reference (about 192x78 physical px)
// maps to 128x52 DIPs on the user's 150% Windows display.
const DOCK_W = 128;
const DOCK_H = 52;
const DOCK_UNDOCK_THRESHOLD = 18;
const EDGE_DOCK_THRESHOLD = 14;
const VIEW_MORPH_MS = 300;
let viewMorphTimer = null;
let viewMorphStartTimer = null;
let viewMorphGeneration = 0;

function cancelViewMorph() {
  if (viewMorphStartTimer) {
    clearTimeout(viewMorphStartTimer);
    viewMorphStartTimer = null;
  }
  if (viewMorphTimer) {
    clearInterval(viewMorphTimer);
    viewMorphTimer = null;
  }
  viewMorphGeneration += 1;
}

function clampScale(s) {
  const min = cfg.minScale || 0.5;
  const max = cfg.maxScale || 1.4;
  return Math.min(max, Math.max(min, Number(s) || 0.8));
}
function outerSizeFor(s) {
  return { w: Math.round(OUTER_W * s), h: Math.round(OUTER_H * s) };
}
function clampPortraitScale(s) {
  const min = cfg.minPortraitScale == null ? 0.35 : Number(cfg.minPortraitScale);
  const max = cfg.maxPortraitScale == null ? 1.25 : Number(cfg.maxPortraitScale);
  return Math.min(max, Math.max(min, Number(s) || 0.5));
}
function portraitSizeFor(s) {
  return { w: Math.round(MINI_BASE_W * s), h: Math.round(MINI_BASE_H * s) };
}
function suppressResizeSync(ms = 250) {
  suppressResizeSyncUntil = Math.max(suppressResizeSyncUntil, Date.now() + ms);
}
function suppressEdgeDock(ms = 650) {
  suppressEdgeDockUntil = Math.max(suppressEdgeDockUntil, Date.now() + ms);
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
  // Saved coordinates can be clamped flush to a smaller or reconfigured
  // display during startup. Ignore those programmatic move events so they are
  // not mistaken for a deliberate user drag to the screen edge.
  suppressEdgeDock(1000);
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
  const mn = outerSizeFor(cfg.minScale || 0.5);
  const mx = outerSizeFor(cfg.maxScale || 1.4);
  applyViewConstraints(OUTER_W / OUTER_H, mn, mx, true);

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
    markBootSuccessful();
    if (updateManager) win.webContents.send('quota:update-status', updateManager.getStatus());
    if (SMOKE_MODE) {
      win.webContents.executeJavaScript(`({
        theme: document.getElementById('quota-app-container').dataset.theme,
        title: document.querySelector('.header-title').textContent
      })`).then(async (state) => {
        if (!state || state.theme !== (cfg.defaultTheme || 'rain') || !state.title) {
          throw new Error('renderer state is incomplete');
        }
        const expectedScale = scale;
        const expectedPortraitScale = portraitScale;
        const enlargedCardScale = clampScale(expectedScale + 0.1);
        applyScale(enlargedCardScale);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const enlargedCardSize = outerSizeFor(enlargedCardScale);
        const [enlargedCardWidth, enlargedCardHeight] = win.getContentSize();
        if (Math.abs(enlargedCardWidth - enlargedCardSize.w) > 2 || Math.abs(enlargedCardHeight - enlargedCardSize.h) > 2) {
          throw new Error(`card scaling produced ${enlargedCardWidth}x${enlargedCardHeight}, expected ${enlargedCardSize.w}x${enlargedCardSize.h}`);
        }
        const expectedPortraitSize = portraitSizeFor(expectedPortraitScale);
        const observedMorphSizes = [];
        const observeMorph = () => observedMorphSizes.push(win.getContentSize());
        const morphSampler = setInterval(observeMorph, 20);
        win.on('resize', observeMorph);
        await win.webContents.executeJavaScript("document.querySelector('.layout-switch').click()");
        await waitForViewMorph('mini');
        clearInterval(morphSampler);
        win.removeListener('resize', observeMorph);
        // macOS can coalesce width and height updates from one setBounds call.
        // Seeing either dimension between the endpoints still proves that the
        // native window morph ran instead of jumping directly to the target.
        const sawIntermediateSize = observedMorphSizes.some(([morphWidth, morphHeight]) => (
          (morphWidth < enlargedCardSize.w && morphWidth > expectedPortraitSize.w) ||
          (morphHeight < enlargedCardSize.h && morphHeight > expectedPortraitSize.h)
        ));
        if (!sawIntermediateSize) {
          throw new Error(`card-to-portrait bounds did not animate through an intermediate size: ${JSON.stringify(observedMorphSizes)}`);
        }
        if (viewMode !== 'mini') throw new Error('clicking the card Codex title did not open portrait view');
        const [miniWidth, miniHeight] = win.getContentSize();
        if (Math.abs(miniWidth - expectedPortraitSize.w) > 2 || Math.abs(miniHeight - expectedPortraitSize.h) > 2) {
          throw new Error(`portrait view size is ${miniWidth}x${miniHeight}, expected ${expectedPortraitSize.w}x${expectedPortraitSize.h}`);
        }
        const portraitRenderer = await win.webContents.executeJavaScript(`({
          view: document.body.className,
          miniDisplay: getComputedStyle(document.getElementById('mini')).display,
          canvasWidth: document.getElementById('weather-canvas').width,
          canvasHeight: document.getElementById('weather-canvas').height
        })`);
        if (!portraitRenderer.view.includes('view-mini') || portraitRenderer.miniDisplay !== 'flex' ||
            portraitRenderer.canvasWidth !== MINI_BASE_W || portraitRenderer.canvasHeight !== MINI_BASE_H) {
          throw new Error(`portrait renderer layout is inconsistent after card scaling: ${JSON.stringify(portraitRenderer)}`);
        }
        if (!win.isResizable()) throw new Error('portrait view is not resizable');
        const enlargedPortraitScale = clampPortraitScale(expectedPortraitScale + 0.1);
        applyScale(enlargedPortraitScale);
        // Scale persistence is intentionally debounced by 700ms.
        await new Promise((resolve) => setTimeout(resolve, 800));
        const enlargedPortraitSize = portraitSizeFor(enlargedPortraitScale);
        const [enlargedWidth, enlargedHeight] = win.getContentSize();
        if (Math.abs(enlargedWidth - enlargedPortraitSize.w) > 2 || Math.abs(enlargedHeight - enlargedPortraitSize.h) > 2) {
          throw new Error(`portrait scaling produced ${enlargedWidth}x${enlargedHeight}, expected ${enlargedPortraitSize.w}x${enlargedPortraitSize.h}`);
        }
        const portraitBeforeTitleClick = win.getContentBounds();
        const portraitArea = screen.getDisplayMatching(portraitBeforeTitleClick).workArea;
        const expectedTitleDockSide = portraitBeforeTitleClick.x + portraitBeforeTitleClick.width / 2 <
          portraitArea.x + portraitArea.width / 2 ? 'left' : 'right';
        const portraitTitlePoint = await win.webContents.executeJavaScript(`(() => {
          const rect = document.querySelector('#mini .mini-top').getBoundingClientRect();
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        })()`);
        // sendInputEvent uses unzoomed content coordinates on macOS. Convert
        // the renderer's CSS coordinates so the physical click lands on the
        // title at every portrait zoom and display scale factor.
        const portraitInputScale = win.webContents.getZoomFactor();
        const portraitTitleInputPoint = {
          x: Math.round(portraitTitlePoint.x * portraitInputScale),
          y: Math.round(portraitTitlePoint.y * portraitInputScale),
        };
        win.webContents.sendInputEvent({ type: 'mouseMove', x: portraitTitleInputPoint.x, y: portraitTitleInputPoint.y });
        win.webContents.sendInputEvent({ type: 'mouseDown', x: portraitTitleInputPoint.x, y: portraitTitleInputPoint.y, button: 'left', clickCount: 1 });
        await new Promise((resolve) => setTimeout(resolve, 45));
        win.webContents.sendInputEvent({ type: 'mouseUp', x: portraitTitleInputPoint.x, y: portraitTitleInputPoint.y, button: 'left', clickCount: 1 });
        await waitForViewMorph('dock');
        const [titleDockWidth, titleDockHeight] = win.getContentSize();
        if (viewMode !== 'dock' || dockSide !== expectedTitleDockSide ||
            Math.abs(titleDockWidth - DOCK_W) > 1 || Math.abs(titleDockHeight - DOCK_H) > 1) {
          throw new Error(`clicking portrait Codex did not open a compact dock on the nearest edge: ${JSON.stringify({ viewMode, dockSide, expectedTitleDockSide, titleDockWidth, titleDockHeight })}`);
        }
        await win.webContents.executeJavaScript("document.querySelector('#edge-dock .dock-brand').click()");
        await waitForViewMorph('card');
        if (viewMode !== 'card') throw new Error('the Codex title cycle did not return from dock to landscape');
        if (Math.abs(Number(loadConfig().scale) - enlargedCardScale) > 0.001) {
          throw new Error('switching layouts overwrote the saved card scale');
        }
        if (Math.abs(Number(loadConfig().portraitScale) - enlargedPortraitScale) > 0.001) {
          throw new Error('the portrait scale was not preserved');
        }
        const beforeDock = win.getBounds();
        const workArea = screen.getDisplayMatching(beforeDock).workArea;
        const rightEdgeProbe = { ...beforeDock, x: workArea.x + workArea.width - beforeDock.width };
        const leftEdgeProbe = { ...beforeDock, x: workArea.x };
        if (detectEdgeDockSide(rightEdgeProbe) !== 'right' || detectEdgeDockSide(leftEdgeProbe) !== 'left') {
          throw new Error('left/right edge detection is incomplete');
        }
        const edgeDockReadyIn = Math.max(0, suppressEdgeDockUntil - Date.now() + 30);
        if (edgeDockReadyIn) await new Promise((resolve) => setTimeout(resolve, edgeDockReadyIn));
        win.setPosition(rightEdgeProbe.x, rightEdgeProbe.y);
        await waitForViewMorph('dock');
        if (viewMode !== 'dock') throw new Error('dragging to the edge did not open the dock view');
        const dockBounds = win.getBounds();
        const [dockContentWidth, dockContentHeight] = win.getContentSize();
        if (Math.abs(dockContentWidth - DOCK_W) > 1 || Math.abs(dockContentHeight - DOCK_H) > 1 ||
            Math.abs(dockBounds.x + dockBounds.width - workArea.x - workArea.width) > 1) {
          throw new Error(`dock bounds are not flush with the right edge: ${JSON.stringify(dockBounds)}`);
        }
        const dockRenderer = await win.webContents.executeJavaScript(`({
          view: document.body.className,
          side: document.body.dataset.dockSide,
          dockDisplay: getComputedStyle(document.getElementById('edge-dock')).display,
          cardDisplay: getComputedStyle(document.getElementById('quota-app-container')).display,
          contentDisplay: getComputedStyle(document.querySelector('#quota-app-container .content')).display,
          canvasWidth: document.getElementById('weather-canvas').width,
          canvasHeight: document.getElementById('weather-canvas').height,
          particleCount: particles.length,
          background: document.getElementById('bg-active').style.backgroundImage
        })`);
        if (!dockRenderer.view.includes('view-dock') || dockRenderer.side !== 'right' ||
            dockRenderer.dockDisplay !== 'flex' || dockRenderer.cardDisplay !== 'block' ||
            dockRenderer.contentDisplay !== 'none' || dockRenderer.canvasWidth !== DOCK_W ||
            dockRenderer.canvasHeight !== DOCK_H || dockRenderer.particleCount < 1 || !dockRenderer.background) {
          throw new Error(`edge dock renderer is incomplete: ${JSON.stringify(dockRenderer)}`);
        }
        // Holding an empty part of the dock must never resume a stale bounds
        // morph. Sample the native content size throughout the press so the
        // Windows-only continuously-growing-strip regression is covered.
        const holdPoint = { x: DOCK_W - 5, y: Math.round(DOCK_H / 2) };
        const heldDockSizes = [];
        const sampleHeldDockSize = setInterval(() => {
          if (win && viewMode === 'dock') heldDockSizes.push(win.getContentSize());
        }, 25);
        win.webContents.sendInputEvent({ type: 'mouseMove', x: holdPoint.x, y: holdPoint.y });
        win.webContents.sendInputEvent({ type: 'mouseDown', x: holdPoint.x, y: holdPoint.y, button: 'left', clickCount: 1 });
        await new Promise((resolve) => setTimeout(resolve, 650));
        win.webContents.sendInputEvent({ type: 'mouseUp', x: holdPoint.x, y: holdPoint.y, button: 'left', clickCount: 1 });
        clearInterval(sampleHeldDockSize);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const invalidHeldDockSize = heldDockSizes.find(([heldWidth, heldHeight]) => (
          Math.abs(heldWidth - DOCK_W) > 1 || Math.abs(heldHeight - DOCK_H) > 1
        ));
        if (viewMode !== 'dock' || heldDockSizes.length < 10 || invalidHeldDockSize) {
          throw new Error(`long-press changed the dock layout or size: ${JSON.stringify({ viewMode, heldDockSizes })}`);
        }
        // Send a real drag sequence. The dock may follow the pointer while held,
        // but it must not become a card until the pointer is released.
        const pullStart = { x: workArea.x + workArea.width - 14, y: dockBounds.y + Math.round(DOCK_H / 2) };
        const pullMove = { x: pullStart.x - 72, y: pullStart.y + 2 };
        const heldDockMoveXs = [];
        const observeHeldDockMove = () => {
          if (viewMode === 'dock') heldDockMoveXs.push(win.getBounds().x);
        };
        win.on('move', observeHeldDockMove);
        await win.webContents.executeJavaScript(`(() => {
          const dock = document.getElementById('edge-dock');
          dock.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, button: 0, pointerId: 73,
            screenX: ${pullStart.x}, screenY: ${pullStart.y}
          }));
          dock.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, button: 0, buttons: 1, pointerId: 73,
            screenX: ${pullMove.x}, screenY: ${pullMove.y}
          }));
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 180));
        win.removeListener('move', observeHeldDockMove);
        if (viewMode !== 'dock') throw new Error('edge dock restored before the mouse was released');
        const heldDockBounds = win.getBounds();
        const heldDockContentSize = win.getContentSize();
        const attachedDockX = workArea.x + workArea.width - heldDockBounds.width;
        const heldDockRenderer = await win.webContents.executeJavaScript(`({
          view: document.body.className,
          detached: document.body.classList.contains('dock-detached')
        })`);
        const distinctHeldDockXs = [...new Set(heldDockMoveXs)];
        if (Math.abs(heldDockContentSize[0] - DOCK_W) > 1 || Math.abs(heldDockContentSize[1] - DOCK_H) > 1 ||
            heldDockBounds.x >= attachedDockX - 20 || distinctHeldDockXs.length < 3 ||
            !heldDockRenderer.view.includes('view-dock') || !heldDockRenderer.detached) {
          throw new Error(`edge dock did not stay compact and smoothly follow the held drag: ${JSON.stringify({ heldDockBounds, heldDockContentSize, heldDockRenderer, heldDockMoveXs })}`);
        }
        await win.webContents.executeJavaScript(`document.getElementById('edge-dock').dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, button: 0, pointerId: 73,
          screenX: ${pullMove.x}, screenY: ${pullMove.y}
        }))`);
        await waitForViewMorph('card');
        if (viewMode !== 'card') throw new Error('edge dock did not restore after the mouse was released');
        const draggedOutBounds = win.getBounds();
        if (draggedOutBounds.x + draggedOutBounds.width >= workArea.x + workArea.width - 1) {
          throw new Error(`dragged-out card stayed attached to the display edge: ${JSON.stringify(draggedOutBounds)}`);
        }

        setView('dock', { side: 'right' });
        await waitForViewMorph('dock');
        const dockBrandPoint = await win.webContents.executeJavaScript(`(() => {
          const rect = document.querySelector('#edge-dock .dock-brand').getBoundingClientRect();
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        })()`);
        win.webContents.sendInputEvent({ type: 'mouseMove', x: dockBrandPoint.x, y: dockBrandPoint.y });
        win.webContents.sendInputEvent({ type: 'mouseDown', x: dockBrandPoint.x, y: dockBrandPoint.y, button: 'left', clickCount: 1 });
        await new Promise((resolve) => setTimeout(resolve, 45));
        win.webContents.sendInputEvent({ type: 'mouseUp', x: dockBrandPoint.x, y: dockBrandPoint.y, button: 'left', clickCount: 1 });
        await waitForViewMorph('card');
        if (viewMode !== 'card') throw new Error('clicking the edge dock did not restore the card');
        if (!win.isResizable()) throw new Error('card is not resizable after returning from the edge dock');
        const [cardMinWidth, cardMinHeight] = win.getMinimumSize();
        const expectedCardMin = outerSizeFor(cfg.minScale || 0.5);
        const currentOuter = win.getBounds();
        const currentContent = win.getContentBounds();
        const expectedMinWidth = expectedCardMin.w + currentOuter.width - currentContent.width;
        const expectedMinHeight = expectedCardMin.h + currentOuter.height - currentContent.height;
        if (Math.abs(cardMinWidth - expectedMinWidth) > 1 || Math.abs(cardMinHeight - expectedMinHeight) > 1) {
          throw new Error(`card minimum size stayed ${cardMinWidth}x${cardMinHeight} after edge docking; expected ${expectedMinWidth}x${expectedMinHeight}`);
        }
        const [restoredWidth, restoredHeight] = win.getContentSize();
        if (Math.abs(restoredWidth - enlargedCardSize.w) > 2 || Math.abs(restoredHeight - enlargedCardSize.h) > 2) {
          throw new Error(`restored card is ${restoredWidth}x${restoredHeight}, expected ${enlargedCardSize.w}x${enlargedCardSize.h}`);
        }
        const restoredRenderer = await win.webContents.executeJavaScript(`({
          view: document.body.className,
          miniDisplay: getComputedStyle(document.getElementById('mini')).display,
          gripDisplay: getComputedStyle(document.querySelector('.rz-se')).display,
          cardRadii: [
            getComputedStyle(document.getElementById('quota-app-container')).borderTopLeftRadius,
            getComputedStyle(document.getElementById('quota-app-container')).borderTopRightRadius,
            getComputedStyle(document.getElementById('quota-app-container')).borderBottomRightRadius,
            getComputedStyle(document.getElementById('quota-app-container')).borderBottomLeftRadius
          ]
        })`);
        if (!restoredRenderer.view.includes('view-card') || restoredRenderer.miniDisplay !== 'none' || restoredRenderer.gripDisplay === 'none' ||
            restoredRenderer.cardRadii.some((radius) => radius !== '24px')) {
          throw new Error(`renderer layout did not fully restore after edge docking: ${JSON.stringify(restoredRenderer)}`);
        }
        await win.webContents.executeJavaScript("window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true }))");
        await new Promise((resolve) => setTimeout(resolve, 200));
        const [shrunkWidth] = win.getContentSize();
        if (shrunkWidth >= restoredWidth) throw new Error('card could not be resized after returning from the edge dock');
        await win.webContents.executeJavaScript("document.getElementById('btn-min').click()");
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (win.isVisible()) throw new Error('the minus button did not hide the panel to the tray');
        showPanel();
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (!win.isVisible() || viewMode !== 'card') throw new Error('the tray-restored panel did not preserve its layout');
        applyScale(expectedScale);
        portraitScale = expectedPortraitScale;
        persistPortraitScale(portraitScale);
        await new Promise((resolve) => setTimeout(resolve, 900));
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
    if (!win || viewMode === 'dock' || Date.now() < suppressResizeSyncUntil) return;
    const [cw] = win.getContentSize();
    if (viewMode === 'mini') {
      portraitScale = clampPortraitScale(cw / MINI_BASE_W);
      win.webContents.setZoomFactor(portraitScale);
      if (win.webContents) win.webContents.send('quota:scale-state', portraitScale);
      persistPortraitScale(portraitScale);
    } else {
      scale = clampScale(cw / OUTER_W);
      win.webContents.setZoomFactor(scale);
      if (win.webContents) win.webContents.send('quota:scale-state', scale);
      persistScale(scale);
    }
  });
  win.on('move', () => {
    persistWindowPosition();
    scheduleEdgeDock();
  });

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

function controlPanel(action) {
  if (action === 'show') showPanel();
  else if (action === 'hide') { userHidden = true; hidePanel(); }
  else if (action === 'toggle') togglePanel();
  else throw new Error(`Unsupported panel action: ${action}`);
  return { action, visible: !!(win && win.isVisible()) };
}

// ---- view modes: landscape / portrait / edge-docked weekly quota ----------
// The title switches landscape ↔ portrait. Dragging either card to the left or
// right display edge enters the dock view; clicking the dock restores the exact
// view, size, and nearby position from before it was docked.

function windowSizeForView(mode) {
  if (mode === 'dock') return { w: DOCK_W, h: DOCK_H };
  if (mode === 'mini') return portraitSizeFor(portraitScale);
  return outerSizeFor(scale); // card
}

function resetViewConstraints() {
  // Electron/Windows can reject a new minimum while the previous view still has
  // a smaller fixed maximum. Reset both limits in a safe
  // order before applying the next view's constraints.
  suppressResizeSync(400);
  win.setResizable(true);
  win.setAspectRatio(0);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(10000, 10000);
}

function finalizeViewConstraints(aspectRatio, minimum, maximum, resizable) {
  const outer = win.getBounds();
  const content = win.getContentBounds();
  const frame = {
    width: Math.max(0, outer.width - content.width),
    height: Math.max(0, outer.height - content.height),
  };
  // Electron applies aspect ratio and min/max constraints to outer bounds.
  // Supplying the invisible-frame delta keeps the requested content size exact.
  win.setAspectRatio(aspectRatio, frame);
  win.setMaximumSize(maximum.w + frame.width, maximum.h + frame.height);
  win.setMinimumSize(minimum.w + frame.width, minimum.h + frame.height);
  win.setResizable(resizable);
}

function applyViewConstraints(aspectRatio, minimum, maximum, resizable) {
  resetViewConstraints();
  finalizeViewConstraints(aspectRatio, minimum, maximum, resizable);
}

function clampWindowBounds(bounds, workArea, margin = 0) {
  const maxX = workArea.x + workArea.width - bounds.width - margin;
  const maxY = workArea.y + workArea.height - bounds.height - margin;
  return {
    x: Math.round(Math.min(maxX, Math.max(workArea.x + margin, bounds.x))),
    y: Math.round(Math.min(maxY, Math.max(workArea.y + margin, bounds.y))),
    width: bounds.width,
    height: bounds.height,
  };
}

function dockBoundsFor(side, base) {
  const display = screen.getDisplayMatching(base);
  const area = display.workArea;
  const x = side === 'left' ? area.x : area.x + area.width - DOCK_W;
  const y = Math.min(
    area.y + area.height - DOCK_H - 8,
    Math.max(area.y + 8, Math.round(base.y + (base.height - DOCK_H) / 2)),
  );
  return { x, y, width: DOCK_W, height: DOCK_H };
}

function restoreBoundsFromDock(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const inset = 18;
  const restored = { ...bounds };
  if (dockSide === 'left') restored.x = area.x + inset;
  else restored.x = area.x + area.width - restored.width - inset;
  return clampWindowBounds(restored, area, 8);
}

function animateWindowBounds(bounds, options = {}) {
  if (!win) return;
  const duration = Math.max(0, Number(options.duration == null ? VIEW_MORPH_MS : options.duration));
  const edgeDelay = Math.max(duration + 450, Number(options.edgeDelay || 0));
  cancelViewMorph();
  const generation = viewMorphGeneration;

  const start = win.getContentBounds();
  const target = {
    x: Math.round(bounds.x), y: Math.round(bounds.y),
    width: Math.round(bounds.width), height: Math.round(bounds.height),
  };
  suppressResizeSync(duration + 300);
  suppressEdgeDock(edgeDelay);

  const finish = () => {
    if (!win || generation !== viewMorphGeneration) return;
    if (viewMorphTimer) {
      clearInterval(viewMorphTimer);
      viewMorphTimer = null;
    }
    win.setContentBounds(target);
    if (typeof options.onComplete === 'function') options.onComplete();
  };
  if (!duration || (start.x === target.x && start.y === target.y &&
      start.width === target.width && start.height === target.height)) {
    finish();
    return;
  }

  const startedAt = Date.now();
  const tick = () => {
    if (!win || generation !== viewMorphGeneration) return;
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    // Quintic smoothstep starts and lands softly without feeling sluggish.
    const eased = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
    const mix = (from, to) => Math.round(from + (to - from) * eased);
    win.setContentBounds({
      x: mix(start.x, target.x),
      y: mix(start.y, target.y),
      width: Math.max(1, mix(start.width, target.width)),
      height: Math.max(1, mix(start.height, target.height)),
    });
    if (progress >= 1) finish();
  };
  tick();
  viewMorphTimer = setInterval(tick, 16);
}

function scheduleWindowMorph(bounds, options = {}) {
  cancelViewMorph();
  const requestGeneration = viewMorphGeneration;
  suppressResizeSync(VIEW_MORPH_MS + 500);
  suppressEdgeDock(Number(options.edgeDelay || 0) + VIEW_MORPH_MS + 500);
  viewMorphStartTimer = setTimeout(() => {
    if (!win || requestGeneration !== viewMorphGeneration) return;
    viewMorphStartTimer = null;
    animateWindowBounds(bounds, options);
  }, 60);
}

async function waitForViewMorph(expectedMode, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let enteredExpectedMode = false;
  while (Date.now() < deadline) {
    if (viewMode === expectedMode) enteredExpectedMode = true;
    if (enteredExpectedMode && !viewMorphStartTimer && !viewMorphTimer) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for the ${expectedMode} view morph`);
}

function setView(mode, options = {}) {
  if (!win || mode === viewMode) return;
  if (!['card', 'mini', 'dock'].includes(mode)) return;

  const previousMode = viewMode;
  // BrowserWindow was created with useContentSize. Persist and restore content
  // bounds consistently; feeding outer bounds back into setBounds grows a
  // frameless window by its invisible border on every layout switch.
  const previousBounds = win.getContentBounds();
  const previousSize = previousMode === 'dock' ? null : windowSizeForView(previousMode);
  const stablePreviousBounds = previousSize
    ? { ...previousBounds, width: previousSize.w, height: previousSize.h }
    : previousBounds;
  if (mode === 'dock') {
    undockedViewMode = previousMode === 'mini' ? 'mini' : 'card';
    undockedBounds = stablePreviousBounds;
    if (previousMode === 'card') cardBounds = stablePreviousBounds;
    dockSide = options.side === 'left' ? 'left' : 'right';
    viewMode = 'dock';
    const size = windowSizeForView('dock');
    resetViewConstraints();
    const dockTarget = dockBoundsFor(dockSide, stablePreviousBounds);
    const dockArea = screen.getDisplayMatching(stablePreviousBounds).workArea;
    const alignDock = () => {
      if (!win || viewMode !== 'dock') return;
      const actualDockBounds = win.getBounds();
      const dockX = dockSide === 'left'
        ? dockArea.x
        : dockArea.x + dockArea.width - actualDockBounds.width;
      win.setContentBounds({ x: dockX, y: dockTarget.y, width: DOCK_W, height: DOCK_H });
    };
    // Updating Chromium zoom can synchronously rebuild the renderer for a few
    // frames. Do it before starting the bounds clock so the 300ms morph cannot
    // be starved and collapse into a final-size jump.
    win.webContents.setZoomFactor(1);
    scheduleWindowMorph(dockTarget, {
      edgeDelay: 1100,
      onComplete: () => {
        if (!win || viewMode !== 'dock') return;
        finalizeViewConstraints(DOCK_W / DOCK_H, size, size, false);
        // Windows can add a one-pixel invisible outer border even on a
        // frameless transparent window. Re-align once constraints settle.
        alignDock();
        setTimeout(alignDock, 80);
      },
    });
  } else if (mode === 'card') {
    if (previousMode === 'card') cardBounds = stablePreviousBounds;
    viewMode = 'card';
    const mn = outerSizeFor(cfg.minScale || 0.5);
    const mx = outerSizeFor(cfg.maxScale || 1.4);
    resetViewConstraints();
    let bounds = options.bounds || (previousMode === 'dock' && undockedViewMode === 'card' && undockedBounds
      ? restoreBoundsFromDock(undockedBounds)
      : cardBounds);
    if (!bounds) {
      const size = outerSizeFor(scale);
      const area = screen.getPrimaryDisplay().workArea;
      bounds = { x: area.x + area.width - size.w - 20, y: area.y + area.height - size.h - 20, width: size.w, height: size.h };
    }
    win.webContents.setZoomFactor(scale);
    scheduleWindowMorph(bounds, {
      onComplete: () => {
        if (win && viewMode === 'card') finalizeViewConstraints(OUTER_W / OUTER_H, mn, mx, true);
      },
    });
    cardBounds = bounds;
  } else {
    if (previousMode === 'card') cardBounds = stablePreviousBounds;
    viewMode = 'mini';
    const mn = portraitSizeFor(cfg.minPortraitScale == null ? 0.35 : cfg.minPortraitScale);
    const mx = portraitSizeFor(cfg.maxPortraitScale == null ? 1.25 : cfg.maxPortraitScale);
    resetViewConstraints();
    let bounds;
    if (options.bounds) {
      bounds = options.bounds;
    } else if (previousMode === 'dock' && undockedViewMode === 'mini' && undockedBounds) {
      bounds = restoreBoundsFromDock(undockedBounds);
    } else {
      const { w, h } = portraitSizeFor(portraitScale);
      const base = cardBounds || previousBounds;
      const workArea = screen.getDisplayMatching(base).workArea;
      bounds = clampWindowBounds({
        x: base.x + base.width - w - 12,
        y: base.y + 12,
        width: w,
        height: h,
      }, workArea, 12);
    }
    win.webContents.setZoomFactor(portraitScale);
    scheduleWindowMorph(bounds, {
      onComplete: () => {
        if (win && viewMode === 'mini') finalizeViewConstraints(MINI_BASE_W / MINI_BASE_H, mn, mx, true);
      },
    });
  }

  if (win.webContents) win.webContents.send('quota:view', mode, { side: dockSide });
  updateTrayMenu();
}

function cycleView() {
  if (viewMode === 'dock') {
    setView('card');
    return;
  }
  if (viewMode === 'mini') {
    const bounds = win.getContentBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const centerX = bounds.x + bounds.width / 2;
    const side = centerX < area.x + area.width / 2 ? 'left' : 'right';
    setView('dock', { side });
    return;
  }
  setView('mini');
}

function dockAtEdge(side) {
  if (viewMode === 'dock') return;
  setView('dock', { side });
}

function detectEdgeDockSide(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  const left = bounds.x <= area.x + EDGE_DOCK_THRESHOLD;
  const right = bounds.x + bounds.width >= area.x + area.width - EDGE_DOCK_THRESHOLD;
  if (!left && !right) return null;
  if (left && right) {
    const leftGap = Math.abs(bounds.x - area.x);
    const rightGap = Math.abs(area.x + area.width - bounds.x - bounds.width);
    return leftGap <= rightGap ? 'left' : 'right';
  }
  return left ? 'left' : 'right';
}

function scheduleEdgeDock() {
  clearTimeout(edgeDockTimer);
  if (!win || viewMode === 'dock' || Date.now() < suppressEdgeDockUntil) return;
  edgeDockTimer = setTimeout(() => {
    if (!win || viewMode === 'dock' || resizeState || Date.now() < suppressEdgeDockUntil) return;
    const side = detectEdgeDockSide(win.getBounds());
    if (side) dockAtEdge(side);
  }, 180);
}

// ---- scale persistence ----------------------------------------------------

let persistTimer = null;
let persistPortraitTimer = null;
let persistWindowTimer = null;
function persistScale(s) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      cfg = updateConfig({ scale: Number(s.toFixed(3)) });
    } catch (_) { /* best effort */ }
  }, 700);
}
function persistPortraitScale(s) {
  clearTimeout(persistPortraitTimer);
  persistPortraitTimer = setTimeout(() => {
    try {
      cfg = updateConfig({ portraitScale: Number(s.toFixed(3)) });
    } catch (_) { /* best effort */ }
  }, 700);
}
function persistWindowPosition() {
  clearTimeout(persistWindowTimer);
  persistWindowTimer = setTimeout(() => {
    if (!win || viewMode !== 'card') return;
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
  if (!win || viewMode === 'dock') return;
  const portrait = viewMode === 'mini';
  const s = portrait ? clampPortraitScale(next) : clampScale(next);
  // A scale gesture can arrive immediately after a layout switch. Cancel any
  // remaining bounds animation so its final frame cannot overwrite this size.
  cancelViewMorph();
  const b = win.getContentBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const { w, h } = portrait ? portraitSizeFor(s) : outerSizeFor(s);
  const minimum = portrait
    ? portraitSizeFor(cfg.minPortraitScale == null ? 0.35 : cfg.minPortraitScale)
    : outerSizeFor(cfg.minScale || 0.5);
  const maximum = portrait
    ? portraitSizeFor(cfg.maxPortraitScale == null ? 1.25 : cfg.maxPortraitScale)
    : outerSizeFor(cfg.maxScale || 1.4);
  const aspectRatio = portrait ? MINI_BASE_W / MINI_BASE_H : OUTER_W / OUTER_H;
  const target = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h };
  if (portrait) portraitScale = s;
  else scale = s;
  suppressResizeSync(600);
  suppressEdgeDock();
  // Release the previous layout's constraints before changing zoom and bounds;
  // Windows otherwise occasionally clamps a portrait resize against stale card
  // constraints and produces a near-square window.
  resetViewConstraints();
  win.webContents.setZoomFactor(s);
  win.setContentBounds(target);
  finalizeViewConstraints(aspectRatio, minimum, maximum, true);
  win.setContentBounds(target);
  if (win.webContents) win.webContents.send('quota:scale-state', s);
  if (portrait) persistPortraitScale(s);
  else persistScale(s);
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
    { label: '重启 / Restart', click: () => restartApp() },
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
ipcMain.on('quota:scale', (_e, delta) => applyScale((viewMode === 'mini' ? portraitScale : scale) + delta));
ipcMain.handle('quota:get-scale', () => (viewMode === 'mini' ? portraitScale : scale));
ipcMain.on('quota:minimize', () => { userHidden = true; hidePanel(); });
ipcMain.on('quota:restore', () => showPanel());
ipcMain.on('quota:cycle-view', () => cycleView());
ipcMain.on('quota:set-view', (_e, mode) => setView(mode));
ipcMain.on('quota:weather-interaction', () => resetWeatherSwitchTimer());
ipcMain.handle('quota:get-update-status', () => updateManager ? updateManager.getStatus() : null);
ipcMain.handle('quota:check-update', () => updateManager ? updateManager.checkForUpdates() : null);
ipcMain.handle('quota:download-update', (_event, version) => (
  updateManager ? updateManager.downloadVersion(version || undefined) : null
));
ipcMain.handle('quota:restart-update', () => updateManager ? updateManager.restartToApply() : null);
ipcMain.handle('quota:switch-version', (_event, version) => (
  updateManager ? updateManager.prepareSwitch(version) : null
));
ipcMain.handle('quota:skip-update', (_event, version) => {
  if (!updateManager) return null;
  const status = updateManager.skipVersion(version);
  cfg = updateConfig({ skippedUpdateVersion: status.skippedVersion || null });
  return status;
});

// Portrait-card drag: move the compact window following the OS cursor. The
// normal landscape card uses Electron's native draggable title region.
let compactDragTimer = null;
let compactDragOffset = null;
let compactDragMode = null;
ipcMain.on('quota:compact-drag-start', () => {
  if (!win || viewMode !== 'mini') return;
  const b = win.getContentBounds();
  const c = screen.getCursorScreenPoint();
  compactDragOffset = { dx: c.x - b.x, dy: c.y - b.y };
  compactDragMode = viewMode;
  const { w, h } = windowSizeForView(viewMode);
  if (compactDragTimer) clearInterval(compactDragTimer);
  compactDragTimer = setInterval(() => {
    if (!win || viewMode !== compactDragMode || !compactDragOffset) return;
    const p = screen.getCursorScreenPoint();
    win.setContentBounds({ x: p.x - compactDragOffset.dx, y: p.y - compactDragOffset.dy, width: w, height: h });
  }, 16);
});
ipcMain.on('quota:compact-drag-end', () => {
  if (compactDragTimer) { clearInterval(compactDragTimer); compactDragTimer = null; }
  compactDragOffset = null;
  compactDragMode = null;
  scheduleEdgeDock();
});

// The HUD stays attached to its current display edge while the user drags it
// vertically. Keeping this in the main process lets dragging continue smoothly
// even though the narrow BrowserWindow is moving under the pointer.
let dockDragTimer = null;
let dockDragState = null;

function dockInwardDistance(side, start, point) {
  return side === 'left' ? point.x - start.x : start.x - point.x;
}

function dockRestoreBounds(point, mode, state) {
  const { w, h } = windowSizeForView(mode);
  const area = screen.getDisplayNearestPoint(point).workArea;
  return clampWindowBounds({
    x: Math.round(point.x - w * state.anchorX),
    y: Math.round(point.y - h * state.anchorY),
    width: w,
    height: h,
  }, area, 8);
}

function positionRestoredDockDrag(point, state) {
  if (!win || !state || viewMode !== state.restoreMode) return null;
  const target = dockRestoreBounds(point, state.restoreMode, state);
  suppressResizeSync(500);
  suppressEdgeDock(1200);
  win.setContentBounds(target);
  if (state.restoreMode === 'card') cardBounds = target;
  return target;
}

function restoreDockFromDrag(point, state = dockDragState) {
  if (!win || !state || viewMode !== 'dock' || state.restored) return false;
  state.restored = true;
  state.restoreMode = undockedViewMode === 'mini' ? 'mini' : 'card';
  const target = dockRestoreBounds(point, state.restoreMode, state);
  suppressEdgeDock(VIEW_MORPH_MS + 1200);
  setView(state.restoreMode, { bounds: target });
  return true;
}

function validDockScreenPoint(value) {
  if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null;
  return { x: Math.round(Number(value.x)), y: Math.round(Number(value.y)) };
}

function positionDockDuringDrag(point, state, immediate = false) {
  if (!win || !state || viewMode !== 'dock') return false;
  const area = screen.getDisplayNearestPoint(point).workArea;
  const current = win.getContentBounds();
  const pulledOut = dockInwardDistance(dockSide, state.start, point) >= DOCK_UNDOCK_THRESHOLD;
  const edgeX = dockSide === 'left'
    ? area.x
    : area.x + area.width - DOCK_W;
  const freeX = Math.round(Math.min(
    area.x + area.width - DOCK_W,
    Math.max(area.x, point.x - state.offsetX),
  ));
  const targetX = pulledOut ? freeX : edgeX;
  const targetY = Math.round(Math.min(
    area.y + area.height - DOCK_H,
    Math.max(area.y, point.y - state.offsetY),
  ));
  const blend = immediate ? 1 : (pulledOut ? 0.58 : 0.72);
  const nextX = Math.abs(targetX - current.x) <= 1
    ? targetX
    : Math.round(current.x + (targetX - current.x) * blend);
  const nextY = Math.abs(targetY - current.y) <= 1
    ? targetY
    : Math.round(current.y + (targetY - current.y) * blend);
  // Keep the compact strip physically fixed while it follows the pointer.
  // setPosition alone can preserve an in-flight layout animation's expanding
  // content bounds on Windows, making a held dock grow wider every frame.
  win.setContentBounds({ x: nextX, y: nextY, width: DOCK_W, height: DOCK_H });
  state.pulledOut = pulledOut;
  return pulledOut;
}

ipcMain.on('quota:dock-drag-start', (_event, startPoint) => {
  if (!win || viewMode !== 'dock') return;
  // A press may arrive during the last few frames of the card-to-dock morph.
  // Freeze the dock before tracking the pointer so those stale frames can
  // never enlarge the strip while the button remains held.
  cancelViewMorph();
  const before = win.getContentBounds();
  const fixed = dockBoundsFor(dockSide, {
    ...before,
    width: DOCK_W,
    height: DOCK_H,
  });
  resetViewConstraints();
  win.webContents.setZoomFactor(1);
  win.setContentBounds(fixed);
  finalizeViewConstraints(DOCK_W / DOCK_H, { w: DOCK_W, h: DOCK_H }, { w: DOCK_W, h: DOCK_H }, false);
  win.setContentBounds(fixed);
  const bounds = win.getContentBounds();
  const cursor = validDockScreenPoint(startPoint) || screen.getCursorScreenPoint();
  dockDragState = {
    start: cursor,
    latestPoint: cursor,
    offsetX: cursor.x - bounds.x,
    offsetY: cursor.y - bounds.y,
    anchorX: dockSide === 'left' ? 0.12 : 0.88,
    anchorY: Math.min(0.85, Math.max(0.15, (cursor.y - bounds.y) / Math.max(1, bounds.height))),
    restored: false,
    restoreMode: null,
    pulledOut: false,
  };
  suppressEdgeDock(1500);
  if (dockDragTimer) clearInterval(dockDragTimer);
  dockDragTimer = setInterval(() => {
    if (!win || !dockDragState) return;
    const point = screen.getCursorScreenPoint();
    if (dockDragState.restored) {
      if (!viewMorphStartTimer && !viewMorphTimer) positionRestoredDockDrag(point, dockDragState);
      return;
    }
    if (viewMode !== 'dock') return;
    positionDockDuringDrag(dockDragState.latestPoint || point, dockDragState);
  }, 16);
});
ipcMain.on('quota:dock-drag-move', (_event, dragPoint) => {
  if (!dockDragState || viewMode !== 'dock') return;
  const point = validDockScreenPoint(dragPoint);
  if (point) dockDragState.latestPoint = point;
});
ipcMain.on('quota:dock-drag-end', (_event, result) => {
  if (dockDragTimer) { clearInterval(dockDragTimer); dockDragTimer = null; }
  const finishedState = dockDragState;
  const finalPoint = validDockScreenPoint(result && result.point) || screen.getCursorScreenPoint();
  const cancelled = !!(result && result.cancelled);
  const shouldRestore = !cancelled && (!!(result && result.pullOut) || !!(
    finishedState && !finishedState.restored &&
    dockInwardDistance(dockSide, finishedState.start, finalPoint) >= DOCK_UNDOCK_THRESHOLD
  ));
  if (finishedState && viewMode === 'dock') positionDockDuringDrag(finalPoint, finishedState, true);
  if (shouldRestore && finishedState && viewMode === 'dock') {
    restoreDockFromDrag(finalPoint, finishedState);
  }
  dockDragState = null;
  if (finishedState && finishedState.restored) {
    const settle = () => {
      if (!win || viewMode !== finishedState.restoreMode) return;
      if (viewMorphStartTimer || viewMorphTimer) {
        setTimeout(settle, 30);
        return;
      }
      positionRestoredDockDrag(finalPoint, finishedState);
    };
    settle();
  }
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

  // Convert to a scale; portrait mode uses its own base dimensions and range.
  const portrait = viewMode === 'mini';
  if (viewMode === 'dock') return;
  const baseW = portrait ? MINI_BASE_W : OUTER_W;
  const baseH = portrait ? MINI_BASE_H : OUTER_H;
  const candidates = [];
  if (wantW != null) candidates.push(wantW / baseW);
  if (wantH != null) candidates.push(wantH / baseH);
  if (!candidates.length) return;
  const s = portrait ? clampPortraitScale(Math.max(...candidates)) : clampScale(Math.max(...candidates));
  if (portrait) portraitScale = s;
  else scale = s;
  const { w, h } = portrait ? portraitSizeFor(s) : outerSizeFor(s);

  // keep the anchor corner/edge fixed
  const nx = /w/.test(dir) ? anchor.x - w : anchor.x;
  const ny = /n/.test(dir) ? anchor.y - h : anchor.y;
  suppressResizeSync();
  suppressEdgeDock();
  win.setContentBounds({ x: Math.round(nx), y: Math.round(ny), width: w, height: h });
  win.webContents.setZoomFactor(s);
  if (win.webContents) win.webContents.send('quota:scale-state', s);
}

ipcMain.on('quota:resize-end', () => {
  if (resizeTimer) { clearInterval(resizeTimer); resizeTimer = null; }
  resizeState = null;
  if (viewMode === 'mini') persistPortraitScale(portraitScale);
  else persistScale(scale);
});

// ---- lifecycle ------------------------------------------------------------

function quitAll() {
  if (watchTimer) clearInterval(watchTimer);
  if (weatherSwitchTimer) clearInterval(weatherSwitchTimer);
  if (smokeTimer) clearTimeout(smokeTimer);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  try { if (dataServer) dataServer.close(); } catch (_) {}
  if (tray) { tray.destroy(); tray = null; }
  app.quit();
}

let restarting = false;
function restartApp() {
  if (restarting) return;
  restarting = true;
  app.relaunch({ args: process.argv.slice(1) });
  quitAll();
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
    dataServer = startDataServer({
      port: cfg.port,
      standalone: false,
      panelControl: controlPanel,
    });

    updateManager = new UpdateManager({
      appDir: APP_DIR,
      currentVersion: app.getVersion(),
      onRestart: () => quitAll(),
      skippedVersion: cfg.skippedUpdateVersion || null,
    });
    updateManager.on('status', (status) => {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('quota:update-status', status);
      }
    });

    buildTray();
    // A managed version switch must prove that its hidden renderer can load even
    // when Codex itself is not running and the normal watchdog would keep the
    // panel closed. The launcher waits for the marker written in did-finish-load.
    if (process.env.QUOTA_WEATHER_BOOT_TOKEN && !SMOKE_MODE) createWindow();
    if (SMOKE_MODE) {
      showPanel();
      smokeTimer = setTimeout(() => {
        console.error('[quota-weather] full app smoke timed out');
        app.exit(1);
      }, 15000);
    } else {
      startWatchdog();
      setTimeout(() => updateManager.checkForUpdates(), 15000);
      updateCheckTimer = setInterval(() => updateManager.checkForUpdates(), 6 * 60 * 60 * 1000);
    }

    // If Codex is already running at launch, the first watchTick shows the panel.
    // If not, we stay quietly in the tray until Codex appears (or user clicks).
  });
}

// don't quit when the panel is hidden/closed — we live in the tray
app.on('window-all-closed', (e) => { /* keep running in tray */ });
