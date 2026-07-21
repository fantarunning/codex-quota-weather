const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const { startDataServer } = require("../server.js");

const port = 21000 + Math.floor(Math.random() * 1000);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function meanRgbDifference(first, second) {
  const a = first.toBitmap();
  const b = second.toBitmap();
  assert.strictEqual(a.length, b.length, "dock captures use different dimensions");
  let difference = 0;
  for (let index = 0; index + 3 < a.length; index += 4) {
    difference += Math.abs(a[index] - b[index]);
    difference += Math.abs(a[index + 1] - b[index + 1]);
    difference += Math.abs(a[index + 2] - b[index + 2]);
  }
  return difference / Math.max(1, (a.length / 4) * 3);
}

function saveCapture(image, name) {
  const output = process.env.QUOTA_WEATHER_CAPTURE_DIR;
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, name), image.toPNG());
}

async function waitForRenderer(win, expression, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await wait(100);
  }
  throw new Error(message);
}

app.on("window-all-closed", () => {});

async function main() {
  const server = startDataServer({ port, disableLiveUsage: true });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const win = new BrowserWindow({
    width: 680,
    height: 380,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  try {
    await win.loadURL(
      `http://127.0.0.1:${port}/?demo=1&lang=en&theme=snow&bg=0`
    );
    await wait(1200);
    const state = await win.webContents.executeJavaScript(`({
      theme: document.getElementById('quota-app-container').dataset.theme,
      percent: document.getElementById('percent-val').textContent,
      title: document.querySelector('.header-title').textContent
    })`);
    assert.strictEqual(state.theme, "snow");
    assert.strictEqual(state.percent.trim(), "86%");
    assert.strictEqual(state.title.trim(), "Codex Quota");
    const updateUi = await win.webContents.executeJavaScript(`(() => {
      renderUpdateState({
        managed: true,
        phase: 'available',
        currentVersion: '2.3.0',
        targetVersion: '2.3.1',
        progress: 0,
        installed: [{ version: '2.3.0', current: true }],
        releases: [{ version: '2.3.1', installed: false, downloadable: true }]
      });
      document.getElementById('update-popover').classList.add('open');
      return {
        message: document.getElementById('update-message').textContent,
        action: document.getElementById('update-primary').textContent,
        updateVisible: document.getElementById('btn-update').classList.contains('visible'),
        skipVisible: document.getElementById('update-skip').classList.contains('visible'),
        historyRows: document.querySelectorAll('.update-version').length
      };
    })()`);
    assert(updateUi.message.includes('2.3.1'), "update popover did not render the target version");
    assert(updateUi.action.includes('2.3.1'), "update action did not render the target version");
    assert.strictEqual(updateUi.updateVisible, true, "update button is hidden despite an available update");
    assert.strictEqual(updateUi.skipVisible, true, "skip action is hidden despite an available update");
    assert(updateUi.historyRows >= 2, "update history did not render local and remote versions");
    const skippedUi = await win.webContents.executeJavaScript(`(() => {
      renderUpdateState({ managed: true, phase: 'skipped', currentVersion: '2.3.0', latestVersion: '2.3.1', skippedVersion: '2.3.1' });
      return {
        updateVisible: document.getElementById('btn-update').classList.contains('visible'),
        popoverOpen: document.getElementById('update-popover').classList.contains('open')
      };
    })()`);
    assert.strictEqual(skippedUi.updateVisible, false, "skipped update button is still visible");
    assert.strictEqual(skippedUi.popoverOpen, false, "skipped update popover is still open");
    // Chromium can throttle a never-shown transparent window on some hosts.
    // Show it outside the visible desktop so a real compositor frame is produced.
    win.setPosition(-10000, -10000);
    win.showInactive();
    win.webContents.invalidate();
    await wait(500);
    let size = null;
    let colorCount = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const image = await win.webContents.capturePage();
      size = image.getSize();
      const bitmap = image.toBitmap();
      const colors = new Set();
      const stride = Math.max(4, Math.floor(bitmap.length / 5000 / 4) * 4);
      for (let index = 0; index + 3 < bitmap.length; index += stride) {
        colors.add(bitmap.readUInt32LE(index));
        if (colors.size > 32) break;
      }
      colorCount = colors.size;
      if (colorCount > 8) break;
      win.webContents.invalidate();
      await wait(250);
    }
    assert(size.width >= 680 && size.height >= 380, "captured renderer size is incomplete");
    assert(colorCount > 8, "captured renderer image is blank or uniform");

    win.setContentSize(240, 520);
    await win.webContents.executeJavaScript("setView('mini')");
    await wait(600);
    const miniState = await win.webContents.executeJavaScript(`({
      view: document.body.className,
      miniDisplay: getComputedStyle(document.getElementById('mini')).display,
      sceneDisplay: getComputedStyle(document.getElementById('quota-app-container')).display,
      canvasWidth: document.getElementById('weather-canvas').width,
      canvasHeight: document.getElementById('weather-canvas').height,
      percent: document.getElementById('mini-pct').textContent,
      used: document.getElementById('mini-used').textContent,
      calls: document.getElementById('mini-calls').textContent,
      sceneRadii: [
        getComputedStyle(document.getElementById('quota-app-container')).borderTopLeftRadius,
        getComputedStyle(document.getElementById('quota-app-container')).borderTopRightRadius,
        getComputedStyle(document.getElementById('quota-app-container')).borderBottomRightRadius,
        getComputedStyle(document.getElementById('quota-app-container')).borderBottomLeftRadius
      ]
    })`);
    assert(miniState.view.includes("view-mini"), "portrait view class was not applied");
    assert.strictEqual(miniState.miniDisplay, "flex", "portrait layout is hidden");
    assert.notStrictEqual(miniState.sceneDisplay, "none", "weather scene is hidden in portrait view");
    assert.strictEqual(miniState.canvasWidth, 240, "portrait weather canvas width is incorrect");
    assert.strictEqual(miniState.canvasHeight, 520, "portrait weather canvas height is incorrect");
    assert.strictEqual(miniState.percent.trim(), "86%");
    assert.strictEqual(miniState.used.trim(), "20.08M");
    assert.strictEqual(miniState.calls.trim(), "188");
    assert.deepStrictEqual(miniState.sceneRadii, ["30px", "30px", "30px", "30px"], "portrait card corners are not consistently rounded");

    await win.webContents.executeJavaScript("document.querySelector('#mini .mini-ring').click()");
    await waitForRenderer(
      win,
      "document.getElementById('quota-app-container').dataset.theme === 'beach'",
      "portrait ring click did not switch weather"
    );
    const clickedTheme = await win.webContents.executeJavaScript(
      "document.getElementById('quota-app-container').dataset.theme"
    );
    assert.strictEqual(clickedTheme, "beach", "portrait ring click did not switch weather");

    await win.webContents.executeJavaScript(
      "window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))"
    );
    await waitForRenderer(
      win,
      "document.getElementById('bg-active').style.backgroundImage.includes('beach-1.jpg')",
      "portrait wheel did not switch background"
    );
    const scrolledBackground = await win.webContents.executeJavaScript(`({
      background: document.getElementById('bg-active').style.backgroundImage,
      activeDot: Array.from(document.querySelectorAll('.mini-mode-dots span')).findIndex((dot) => dot.classList.contains('active'))
    })`);
    assert(scrolledBackground.background.includes("beach-1.jpg"), "portrait wheel did not switch background");
    assert.strictEqual(scrolledBackground.activeDot, 1, "portrait background indicator did not follow the wheel");

    await win.webContents.executeJavaScript("document.getElementById('mini-bg-switcher').click()");
    await waitForRenderer(
      win,
      "document.getElementById('bg-active').style.backgroundImage.includes('beach-2.jpg')",
      "portrait bottom dots did not switch background"
    );
    const clickedBackground = await win.webContents.executeJavaScript(`({
      background: document.getElementById('bg-active').style.backgroundImage,
      activeDot: Array.from(document.querySelectorAll('.mini-mode-dots span')).findIndex((dot) => dot.classList.contains('active'))
    })`);
    assert(clickedBackground.background.includes("beach-2.jpg"), "portrait bottom dots did not switch background");
    assert.strictEqual(clickedBackground.activeDot, 2, "portrait bottom dots did not update the indicator");

    const portraitThemes = ["rain", "meteor", "blossom", "snow", "beach"];
    for (let themeIndex = 0; themeIndex < portraitThemes.length; themeIndex += 1) {
      const themeState = await win.webContents.executeJavaScript(`(async () => {
        await performTransition(${themeIndex}, 0);
        return {
          theme: document.getElementById('quota-app-container').dataset.theme,
          background: document.getElementById('bg-active').style.backgroundImage,
          particleCount: particles.length,
          canvasWidth: document.getElementById('weather-canvas').width,
          canvasHeight: document.getElementById('weather-canvas').height
        };
      })()`);
      assert.strictEqual(themeState.theme, portraitThemes[themeIndex], `portrait theme ${portraitThemes[themeIndex]} did not activate`);
      assert(themeState.background.includes(`${portraitThemes[themeIndex]}-0.jpg`), `portrait background for ${portraitThemes[themeIndex]} is missing`);
      assert(themeState.particleCount > 0, `portrait effect for ${portraitThemes[themeIndex]} is empty`);
      assert.strictEqual(themeState.canvasWidth, 240);
      assert.strictEqual(themeState.canvasHeight, 520);
    }
    const miniImage = await win.webContents.capturePage();
    const miniSize = miniImage.getSize();
    assert(miniSize.width >= 240 && miniSize.height >= 520, "portrait renderer size is incomplete");

    win.webContents.setZoomFactor(1);
    win.setContentSize(128, 52);
    await win.webContents.executeJavaScript("setView('dock', { side: 'right' })");
    await wait(250);
    const dockState = await win.webContents.executeJavaScript(`({
      view: document.body.className,
      side: document.body.dataset.dockSide,
      dockDisplay: getComputedStyle(document.getElementById('edge-dock')).display,
      cardDisplay: getComputedStyle(document.getElementById('quota-app-container')).display,
      contentDisplay: getComputedStyle(document.querySelector('#quota-app-container .content')).display,
      canvasWidth: document.getElementById('weather-canvas').width,
      canvasHeight: document.getElementById('weather-canvas').height,
      particleCount: particles.length,
      background: document.getElementById('bg-active').style.backgroundImage,
      percent: document.getElementById('dock-pct').textContent,
      percentColor: getComputedStyle(document.getElementById('dock-pct')).color,
      percentWeight: Number(getComputedStyle(document.getElementById('dock-pct')).fontWeight),
      barColor: getComputedStyle(document.getElementById('edge-dock'), '::after').backgroundColor,
      barTop: parseFloat(getComputedStyle(document.getElementById('edge-dock'), '::after').top),
      barBottom: parseFloat(getComputedStyle(document.getElementById('edge-dock'), '::after').bottom),
      dockRadius: parseFloat(getComputedStyle(document.getElementById('edge-dock')).borderTopLeftRadius),
      ringOffset: parseFloat(getComputedStyle(document.getElementById('dock-ring-fg')).strokeDashoffset),
      ringColor: getComputedStyle(document.getElementById('dock-ring-fg')).stroke,
      liveDot: getComputedStyle(document.getElementById('dock-live-dot')).backgroundColor,
      brand: document.querySelector('.dock-brand').textContent.trim(),
      ringWidth: parseFloat(getComputedStyle(document.querySelector('.dock-ring-shell')).width),
      percentSize: parseFloat(getComputedStyle(document.getElementById('dock-pct')).fontSize),
      brandSize: parseFloat(getComputedStyle(document.querySelector('.dock-brand')).fontSize),
      liveDotWidth: parseFloat(getComputedStyle(document.getElementById('dock-live-dot')).width),
      contentGap: parseFloat(getComputedStyle(document.querySelector('.dock-hud-content')).gap),
      backgroundSwitcherDisplay: getComputedStyle(document.getElementById('dock-bg-switcher')).display,
      backgroundSwitcherDirection: getComputedStyle(document.getElementById('dock-bg-switcher')).flexDirection,
      backgroundDotCount: document.querySelectorAll('#dock-bg-switcher span').length,
      activeBackgroundDot: Array.from(document.querySelectorAll('#dock-bg-switcher span')).findIndex((dot) => dot.classList.contains('active'))
    })`);
    assert(dockState.view.includes("view-dock"), "edge dock view class was not applied");
    assert.strictEqual(dockState.side, "right", "edge dock side was not applied");
    assert.strictEqual(dockState.dockDisplay, "flex", "edge dock is hidden");
    assert.strictEqual(dockState.cardDisplay, "block", "edge dock weather scene is hidden");
    assert.strictEqual(dockState.contentDisplay, "none", "full card metrics remain visible in the edge dock");
    assert.strictEqual(dockState.canvasWidth, 128, "edge dock weather canvas width is incorrect");
    assert.strictEqual(dockState.canvasHeight, 52, "edge dock weather canvas height is incorrect");
    assert(dockState.particleCount > 0, "edge dock weather particles are missing");
    assert(dockState.background.includes("beach-0.jpg"), "edge dock did not preserve the active weather background");
    assert.strictEqual(dockState.percent.trim(), "86", "edge dock weekly quota is stale");
    assert(dockState.percentColor.includes("0.96"), "edge dock ring number does not match the reference tint");
    assert(dockState.percentWeight >= 700, "edge dock ring number is not bold enough");
    assert.strictEqual(dockState.barTop, 18, "edge dock accent bar has the wrong default length");
    assert.strictEqual(dockState.barBottom, 18, "edge dock accent bar is not vertically centered");
    assert.strictEqual(dockState.dockRadius, 10, "edge dock corner radius does not match the reference");
    assert(dockState.ringOffset > 0 && dockState.ringOffset < 81.68, "edge dock ring did not render the live quota");
    assert.strictEqual(dockState.ringColor, dockState.barColor, "edge dock ring does not follow the weather accent");
    assert(dockState.liveDot.includes("74, 222, 128"), "edge dock live status is missing");
    assert.strictEqual(dockState.brand, "Codex", "edge dock brand does not use the card's title casing");
    assert.strictEqual(dockState.ringWidth, 34, "edge dock ring diameter is out of proportion");
    assert.strictEqual(dockState.percentSize, 12, "edge dock number size is out of proportion");
    assert.strictEqual(dockState.brandSize, 11, "edge dock title size is out of proportion");
    assert.strictEqual(dockState.liveDotWidth, 5, "edge dock live dot is oversized");
    assert.strictEqual(dockState.contentGap, 6, "edge dock content spacing does not match the compact layout");
    assert.strictEqual(dockState.backgroundSwitcherDisplay, "flex", "edge dock background switcher is hidden");
    assert.strictEqual(dockState.backgroundSwitcherDirection, "column", "edge dock background switcher is not vertical");
    assert.strictEqual(dockState.backgroundDotCount, 3, "edge dock background switcher does not expose three backgrounds");
    assert.strictEqual(dockState.activeBackgroundDot, 0, "edge dock background indicator is not synchronized");

    const dockBeforeWeather = await win.webContents.capturePage();
    saveCapture(dockBeforeWeather, "dock-before-weather.png");

    const ringPoint = await win.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('#edge-dock .dock-ring-shell').getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: ringPoint.x, y: ringPoint.y });
    win.webContents.sendInputEvent({ type: "mouseDown", x: ringPoint.x, y: ringPoint.y, button: "left", clickCount: 1 });
    await wait(45);
    win.webContents.sendInputEvent({ type: "mouseUp", x: ringPoint.x, y: ringPoint.y, button: "left", clickCount: 1 });
    await waitForRenderer(
      win,
      "document.getElementById('quota-app-container').dataset.theme === 'rain' && document.getElementById('bg-active').style.backgroundImage.includes('rain-0.jpg')",
      "physical edge dock ring click did not switch weather"
    );
    const rainMotionStart = await win.webContents.executeJavaScript(
      "particles.slice(0, 8).map((particle) => [particle.x, particle.y])"
    );
    const changedDockWeather = await win.webContents.executeJavaScript(`({
      theme: document.getElementById('quota-app-container').dataset.theme,
      background: document.getElementById('bg-active').style.backgroundImage,
      particleCount: particles.length,
      sharedRainStyle: particles.every((particle) =>
        particle.dockRain == null && Number.isFinite(particle.r) &&
        Number.isFinite(particle.l) && Number.isFinite(particle.s)),
      maxRainRadius: Math.max(...particles.map((particle) => particle.r)),
      canvasWidth: document.getElementById('weather-canvas').width,
      canvasHeight: document.getElementById('weather-canvas').height
    })`);
    assert.strictEqual(changedDockWeather.theme, "rain", "edge dock weather did not change");
    assert(changedDockWeather.background.includes("rain-0.jpg"), "edge dock background did not change with weather");
    assert(changedDockWeather.particleCount > 0, "edge dock particles disappeared after changing weather");
    assert.strictEqual(changedDockWeather.particleCount, 8, "edge dock rain density does not match the scaled card effect");
    assert.strictEqual(changedDockWeather.sharedRainStyle, true, "edge dock rain does not use the same particle model as the card");
    assert(changedDockWeather.maxRainRadius <= 1.12, "edge dock rain particles are oversized for the slightly enlarged compact range");
    assert.strictEqual(changedDockWeather.canvasWidth, 128);
    assert.strictEqual(changedDockWeather.canvasHeight, 52);

    const serializedRainMotionStart = JSON.stringify(rainMotionStart);
    await waitForRenderer(
      win,
      `JSON.stringify(particles.slice(0, 8).map((particle) => [particle.x, particle.y])) !== ${JSON.stringify(serializedRainMotionStart)}`,
      "edge dock weather particles did not animate within the renderer deadline",
      4000
    );
    const rainMotionEnd = await win.webContents.executeJavaScript(
      "particles.slice(0, 8).map((particle) => [particle.x, particle.y])"
    );
    assert.notDeepStrictEqual(rainMotionEnd, rainMotionStart, "edge dock weather particles are not animating");

    const dockBackgroundPoint = await win.webContents.executeJavaScript(`(() => {
      const rect = document.getElementById('dock-bg-switcher').getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: dockBackgroundPoint.x, y: dockBackgroundPoint.y });
    win.webContents.sendInputEvent({ type: "mouseDown", x: dockBackgroundPoint.x, y: dockBackgroundPoint.y, button: "left", clickCount: 1 });
    await wait(45);
    win.webContents.sendInputEvent({ type: "mouseUp", x: dockBackgroundPoint.x, y: dockBackgroundPoint.y, button: "left", clickCount: 1 });
    await waitForRenderer(
      win,
      "document.getElementById('bg-active').style.backgroundImage.includes('rain-1.jpg')",
      "physical edge dock background indicator click did not switch the background"
    );
    const activeDockBackgroundDot = await win.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('#dock-bg-switcher span')).findIndex((dot) => dot.classList.contains('active'))"
    );
    assert.strictEqual(activeDockBackgroundDot, 1, "edge dock background indicator did not highlight the active image");

    win.webContents.sendInputEvent({ type: "mouseWheel", x: ringPoint.x, y: ringPoint.y, deltaX: 0, deltaY: 120 });
    await waitForRenderer(
      win,
      "!document.getElementById('bg-active').style.backgroundImage.includes('rain-1.jpg')",
      "edge dock wheel did not switch the active weather background"
    );
    const wheelState = await win.webContents.executeJavaScript(`({
      background: document.getElementById('bg-active').style.backgroundImage,
      activeDot: Array.from(document.querySelectorAll('#dock-bg-switcher span')).findIndex((dot) => dot.classList.contains('active'))
    })`);
    const wheelBackgroundIndex = wheelState.background.includes("rain-2.jpg") ? 2 : 0;
    assert(/rain-[02]\.jpg/.test(wheelState.background), "edge dock wheel did not continue from the indicator-selected background");
    assert.strictEqual(wheelState.activeDot, wheelBackgroundIndex, "edge dock indicator did not follow the wheel-selected background");
    const dockAfterWeather = await win.webContents.capturePage();
    saveCapture(dockAfterWeather, "dock-after-weather.png");
    assert(meanRgbDifference(dockBeforeWeather, dockAfterWeather) > 4, "edge dock weather/background change is not visually detectable");

    await win.webContents.executeJavaScript("setView('card')");
    const restoredCardRadii = await win.webContents.executeJavaScript(`[
      getComputedStyle(document.getElementById('quota-app-container')).borderTopLeftRadius,
      getComputedStyle(document.getElementById('quota-app-container')).borderTopRightRadius,
      getComputedStyle(document.getElementById('quota-app-container')).borderBottomRightRadius,
      getComputedStyle(document.getElementById('quota-app-container')).borderBottomLeftRadius
    ]`);
    assert.deepStrictEqual(restoredCardRadii, ["24px", "24px", "24px", "24px"], "card corners stayed square after leaving the edge dock");
    console.log(
      `Electron smoke test passed on ${process.platform}/${process.arch}: card, portrait, and edge-dock views are active.`
    );
  } finally {
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
