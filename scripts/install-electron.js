const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { electronExecutable } = require("../platform.js");

const root = path.resolve(__dirname, "..");
const electronDir = path.join(root, "node_modules", "electron");
const executable = electronExecutable(root);

if (fs.existsSync(executable)) {
  console.log("Electron runtime is already installed.");
  process.exit(0);
}

const installer = path.join(electronDir, "install.js");
if (!fs.existsSync(installer)) {
  console.error("Electron package is missing. Run npm install first.");
  process.exit(1);
}

console.log("Downloading the Electron runtime...");
const result = spawnSync(process.execPath, [installer], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_GET_USE_PROXY: process.env.ELECTRON_GET_USE_PROXY || "1",
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.status !== 0 || !fs.existsSync(executable)) {
  console.error("Electron runtime installation failed.");
  process.exit(result.status || 1);
}
console.log("Electron runtime installed.");
