const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { electronExecutable, settingsDataDir } = require("../platform.js");

const ROOT = path.resolve(__dirname, "..");
process.env.QUOTA_WEATHER_DATA_DIR = path.join(ROOT, ".tmp", "test-settings");

const { fetchLiveUsage, normalizeLive } = require("../liveUsage.js");
const { startDataServer } = require("../server.js");
const { defaultConfig } = require("../settings.js");

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: "127.0.0.1", port, path: pathname, timeout: 10000 },
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
  });
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
  assert.strictEqual(defaults.windowX, 1213);
  assert.strictEqual(defaults.windowY, 647);

  for (const file of [
    "main.js",
    "server.js",
    "liveUsage.js",
    "platform.js",
    "preload.js",
    "settings.js",
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
  const server = startDataServer({ port, disableLiveUsage: true });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const health = await get(port, "/health");
    assert.strictEqual(health.status, 200);
    assert.strictEqual(JSON.parse(health.body.toString("utf8")).ok, true);

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

  fs.rmSync(path.join(ROOT, ".tmp"), { recursive: true, force: true });
  console.log("Smoke test passed: syntax, assets, local API, and demo renderer.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
