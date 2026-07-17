const assert = require("assert");
const { app, BrowserWindow } = require("electron");
const { startDataServer } = require("../server.js");

const port = 21000 + Math.floor(Math.random() * 1000);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        historyRows: document.querySelectorAll('.update-version').length
      };
    })()`);
    assert(updateUi.message.includes('2.3.1'), "update popover did not render the target version");
    assert(updateUi.action.includes('2.3.1'), "update action did not render the target version");
    assert(updateUi.historyRows >= 2, "update history did not render local and remote versions");
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
    console.log(
      `Electron smoke test passed on ${process.platform}/${process.arch}: renderer and canvas are active.`
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
