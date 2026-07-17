"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  UpdateManager,
  artifactName,
  compareVersions,
  markBootSuccessful,
  platformKey,
} = require("../update-manager.js");

assert(compareVersions("2.3.0", "2.2.5") > 0);
assert(compareVersions("2.3.0", "2.3.0") === 0);
assert(compareVersions("2.2.5", "2.3.0") < 0);
assert.strictEqual(platformKey("win32", "x64"), "win32-x64");
assert.strictEqual(platformKey("darwin", "arm64"), "darwin-arm64");
assert.strictEqual(artifactName("2.3.0", "win32", "x64"), "codex-quota-weather-v2.3.0-win32-x64.zip");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "quota-weather-update-test-"));
const token = "0123456789abcdef0123456789abcdef";
assert.strictEqual(markBootSuccessful(root, token), true);
assert(fs.existsSync(path.join(root, "state", `boot-${token}.ok`)));
const appDir = path.join(root, "versions", "2.3.0");
fs.mkdirSync(path.join(root, "state"), { recursive: true });
fs.mkdirSync(appDir, { recursive: true });
fs.writeFileSync(path.join(appDir, "package.json"), '{"version":"2.3.0"}\n', "utf8");
fs.writeFileSync(path.join(appDir, "update-manager.js"), "// managed version\n", "utf8");
fs.writeFileSync(
  path.join(root, "state", "update-state.json"),
  JSON.stringify({ currentVersion: "2.3.0", pendingVersion: null, installedVersions: [{ version: "2.3.0" }] }),
  "utf8"
);
const manager = new UpdateManager({ appDir, currentVersion: "2.3.0" });
assert.strictEqual(manager.getStatus().managed, true);
assert.strictEqual(manager.prepareSwitch("2.3.0").phase, "up-to-date");
fs.rmSync(root, { recursive: true, force: true });
console.log("Update manager tests passed.");
