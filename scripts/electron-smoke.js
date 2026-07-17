const assert = require("assert");
const { app, BrowserWindow } = require("electron");
const { startDataServer } = require("../server.js");

const port = 21000 + Math.floor(Math.random() * 1000);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      calls: document.getElementById('mini-calls').textContent
    })`);
    assert(miniState.view.includes("view-mini"), "portrait view class was not applied");
    assert.strictEqual(miniState.miniDisplay, "flex", "portrait layout is hidden");
    assert.notStrictEqual(miniState.sceneDisplay, "none", "weather scene is hidden in portrait view");
    assert.strictEqual(miniState.canvasWidth, 240, "portrait weather canvas width is incorrect");
    assert.strictEqual(miniState.canvasHeight, 520, "portrait weather canvas height is incorrect");
    assert.strictEqual(miniState.percent.trim(), "86%");
    assert.strictEqual(miniState.used.trim(), "20.08M");
    assert.strictEqual(miniState.calls.trim(), "188");

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
    console.log(
      `Electron smoke test passed on ${process.platform}/${process.arch}: card and portrait weather canvases are active.`
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
