const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const { startDataServer } = require("../server.js");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "docs", "images");
const FRAMES = path.join(OUTPUT, "frames");
const USAGE_FRAMES = path.join(OUTPUT, "usage-frames");
const PORT = 18787;
const THEMES = ["rain", "meteor", "blossom", "snow", "beach"];
const BACKGROUNDS = { rain: 0, meteor: 0, blossom: 0, snow: 0, beach: 0 };
const DOCK_CAPTURE_SIDES = {
  rain: "right",
  meteor: "top",
  blossom: "left",
  snow: "bottom",
  beach: "right",
};
const THEME_CAPTURE_ZOOM = 1.5;

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
  // Capture the card at 1.5x device resolution so README GIF text and
  // particles remain crisp when GitHub renders the image at desktop width.
  win.webContents.setZoomFactor(THEME_CAPTURE_ZOOM);
  win.setContentSize(
    Math.round(680 * THEME_CAPTURE_ZOOM),
    Math.round(380 * THEME_CAPTURE_ZOOM)
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

async function captureStablePng(win, targets) {
  // Chromium may return one stale frame immediately after a per-origin zoom
  // reset. Warm the capture path once, then reuse the same stable PNG for the
  // README frame and its standalone counterpart.
  await win.webContents.capturePage();
  await wait(140);
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  targets.forEach((target) => fs.writeFileSync(target, png));
}

async function setLayout(win, mode, width, height, options = {}, zoom = 1) {
  win.webContents.setZoomFactor(zoom);
  win.setContentSize(Math.round(width * zoom), Math.round(height * zoom));
  await win.webContents.executeJavaScript(
    `setView(${JSON.stringify(mode)}, ${JSON.stringify(options)})`
  );
  await wait(700);
}

async function setTheme(win, theme, background = 0) {
  const themeIndex = THEMES.indexOf(theme);
  if (themeIndex < 0) throw new Error(`Unknown documentation theme: ${theme}`);
  await win.webContents.executeJavaScript(
    `performTransition(${themeIndex}, ${background})`
  );
  await wait(700);
}

async function preloadThemeBackgrounds(win, themeIndex) {
  await win.webContents.executeJavaScript(`(async () => {
    await Promise.all(themes[${themeIndex}].urls.map((url) => loadBackground(url)));
    return true;
  })()`);
}

async function captureThemeSequence(win, theme, frameDir) {
  const themeIndex = THEMES.indexOf(theme);
  if (themeIndex < 0) throw new Error(`Unknown documentation theme: ${theme}`);

  // Preload every background before recording. The resulting frames show the
  // actual renderer cross-fade instead of an image-download pause.
  await preloadThemeBackgrounds(win, themeIndex);
  await setTheme(win, theme, 0);

  let frameIndex = 0;
  const record = async (background, phase, count, delay = 80) => {
    for (let index = 0; index < count; index += 1) {
      const fileName = [
        String(frameIndex).padStart(3, "0"),
        `bg${background}`,
        phase,
        `${String(index).padStart(2, "0")}.png`,
      ].join("-");
      await capturePng(win, path.join(frameDir, fileName));
      frameIndex += 1;
      await wait(delay);
    }
  };

  // Each scene records moving particles on all three backgrounds. Background
  // 1 and 2 include live frames from the renderer's 480 ms transition.
  await record(0, "hold", 6, 90);
  for (const background of [1, 2]) {
    await win.webContents.executeJavaScript(
      `void performTransition(${themeIndex}, ${background}); true`
    );
    await record(background, "transition", 8, 75);
    await wait(120);
    await record(background, "hold", 4, 90);
  }
}

async function captureCompactThemeSequence(win, theme, frameDir) {
  const themeIndex = THEMES.indexOf(theme);
  if (themeIndex < 0) throw new Error(`Unknown documentation theme: ${theme}`);
  await preloadThemeBackgrounds(win, themeIndex);
  await setTheme(win, theme, 0);

  let frameIndex = 0;
  const record = async (background, phase, count, delay = 80) => {
    for (let index = 0; index < count; index += 1) {
      const fileName = [
        String(frameIndex).padStart(3, "0"),
        `bg${background}`,
        phase,
        `${String(index).padStart(2, "0")}.png`,
      ].join("-");
      await capturePng(win, path.join(frameDir, fileName));
      frameIndex += 1;
      await wait(delay);
    }
  };

  await record(0, "hold", 3, 90);
  await win.webContents.executeJavaScript(
    `void performTransition(${themeIndex}, 1); true`
  );
  await record(1, "transition", 5, 75);
  await wait(120);
  await record(1, "hold", 2, 100);
}

async function captureCompactLayouts() {
  const portraitRoot = path.join(FRAMES, "portrait");
  const dockRoot = path.join(FRAMES, "dock");
  fs.rmSync(portraitRoot, { recursive: true, force: true });
  fs.rmSync(dockRoot, { recursive: true, force: true });

  for (const theme of THEMES) {
    const win = await createThemeWindow(theme);
    try {
      const portraitDir = path.join(portraitRoot, theme);
      fs.mkdirSync(portraitDir, { recursive: true });
      await setLayout(win, "mini", 240, 520, {}, 2);
      await captureCompactThemeSequence(win, theme, portraitDir);

      const side = DOCK_CAPTURE_SIDES[theme];
      const vertical = side === "top" || side === "bottom";
      const dockDir = path.join(dockRoot, theme);
      fs.mkdirSync(dockDir, { recursive: true });
      await setLayout(
        win,
        "dock",
        vertical ? 52 : 128,
        vertical ? 128 : 52,
        { side },
        4
      );
      await captureCompactThemeSequence(win, theme, dockDir);
    } finally {
      win.destroy();
    }
  }
}

async function captureUsageLayouts() {
  fs.rmSync(USAGE_FRAMES, { recursive: true, force: true });
  fs.mkdirSync(USAGE_FRAMES, { recursive: true });
  const win = await createThemeWindow("rain");
  const capture = async (name, mode, width, height, theme, background, options, zoom) => {
    await setLayout(win, mode, width, height, options, zoom);
    await setTheme(win, theme, background);
    await captureStablePng(win, [
      path.join(USAGE_FRAMES, `${name}.png`),
      path.join(OUTPUT, `layout-${name}.png`),
    ]);
  };
  try {
    await capture("landscape", "card", 680, 380, "rain", 0, {}, 1);
    await capture("portrait", "mini", 240, 520, "blossom", 1, {}, 2);
    await capture("side-dock", "dock", 128, 52, "meteor", 0, { side: "right" }, 3);
    await capture("top-dock", "dock", 52, 128, "snow", 0, { side: "top" }, 3);
  } finally {
    win.destroy();
  }
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const usageOnly = process.env.QUOTA_WEATHER_DOCS_USAGE_ONLY === "1";
  const compactOnly = process.env.QUOTA_WEATHER_DOCS_COMPACT_ONLY === "1";
  if (!usageOnly && !compactOnly) {
    fs.rmSync(FRAMES, { recursive: true, force: true });
    fs.mkdirSync(FRAMES, { recursive: true });
  } else {
    fs.mkdirSync(FRAMES, { recursive: true });
  }

  const server = startDataServer({ port: PORT, disableLiveUsage: true });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    if (!usageOnly && !compactOnly) {
      for (const theme of THEMES) {
        const win = await createThemeWindow(theme);
        try {
          await capturePng(win, path.join(OUTPUT, `theme-${theme}.png`));
          const frameDir = path.join(FRAMES, theme);
          fs.mkdirSync(frameDir, { recursive: true });
          await captureThemeSequence(win, theme, frameDir);
        } finally {
          win.destroy();
        }
      }
    }
    if (!usageOnly) await captureCompactLayouts();
    if (!compactOnly) await captureUsageLayouts();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`Documentation screenshots and frames written to ${OUTPUT}`);
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
