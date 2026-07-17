const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { electronExecutable } = require("../platform.js");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-quota-weather-app-smoke-"));
const port = 22000 + Math.floor(Math.random() * 1000);
fs.writeFileSync(
  path.join(temp, "config.json"),
  JSON.stringify({ port, followCodex: false, weatherSwitchIntervalMs: 0 }, null, 2),
  "utf8"
);

const result = spawnSync(
  electronExecutable(root),
  [`--user-data-dir=${path.join(temp, "electron")}`, root],
  {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      QUOTA_WEATHER_DATA_DIR: temp,
      QUOTA_WEATHER_SMOKE: "1",
    },
  }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
fs.rmSync(temp, { recursive: true, force: true });

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status || 1);
console.log("Full Electron application smoke test passed.");
