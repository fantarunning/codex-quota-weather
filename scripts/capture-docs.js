const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const { startDataServer } = require("../server.js");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "docs", "images");
const FRAMES = path.join(OUTPUT, "frames");
const PORT = 18787;
const THEMES = ["rain", "meteor", "blossom", "snow", "beach"];
const BACKGROUNDS = { rain: 1, meteor: 0, blossom: 0, snow: 0, beach: 0 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The capture job intentionally destroys one hidden BrowserWindow between
// themes. Keep Electron alive until the complete batch has finished.
app.on("window-all-closed", () => {});

async function createThemeWindow(theme) {
  const win = new BrowserWindow({
    width: 680,
    height: 380,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await win.loadURL(
    `http://127.0.0.1:${PORT}/?demo=1&lang=zh&theme=${theme}&bg=${BACKGROUNDS[theme]}`
  );
  await win.webContents.executeJavaScript(`
    document.fonts.ready.then(() => {
      const controls = document.getElementById('win-controls');
      if (controls) controls.style.display = 'flex';
    })
  `);
  await wait(1700);
  return win;
}

async function capturePng(win, target) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(target, image.toPNG());
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const server = startDataServer({ port: PORT, disableLiveUsage: true });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    for (const theme of THEMES) {
      const win = await createThemeWindow(theme);
      try {
        await capturePng(win, path.join(OUTPUT, `theme-${theme}.png`));
        const frameDir = path.join(FRAMES, theme);
        fs.mkdirSync(frameDir, { recursive: true });
        for (let index = 0; index < 24; index += 1) {
          await capturePng(
            win,
            path.join(frameDir, `${String(index).padStart(3, "0")}.png`)
          );
          await wait(90);
        }
      } finally {
        win.destroy();
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`Documentation screenshots and frames written to ${OUTPUT}`);
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
