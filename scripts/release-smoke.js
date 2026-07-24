"use strict";

// Release-archive smoke gate.
//
// package-release.js strips developer-only trees (.github, docs, tests
// fixtures, etc.) from the shipped ZIP. update-manager.verifyAndStage() then
// runs scripts/smoke-test.js AGAINST THAT EXTRACTED ZIP to verify an in-app
// update. If the smoke test reads any file that the release omits, every update
// fails at the "installing" phase with ENOENT (the exact failure users hit).
//
// This gate reproduces that path in CI: build the real release ZIP, extract it
// to a scratch dir that has NO .git/.github/docs, and run the packaged smoke
// test with the private-runtime env the updater uses. It must exit 0.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const packageInfo = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = packageInfo.version;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const key = `${process.platform}-${arch}`;
const zipPath = path.join(ROOT, "release", `codex-quota-weather-v${version}-${key}.zip`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function extract(zip, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === "win32") {
    const command = `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`;
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
  } else if (process.platform === "darwin") {
    run("/usr/bin/ditto", ["-x", "-k", zip, destination]);
  } else {
    run("unzip", ["-q", zip, "-d", destination]);
  }
}

function locateAppRoot(dir) {
  if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  throw new Error("extracted release archive has no package.json");
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "codex-quota-weather-release-smoke-"));
try {
  run(process.execPath, [path.join(ROOT, "scripts", "package-release.js")]);
  if (!fs.existsSync(zipPath)) throw new Error(`release archive was not created: ${zipPath}`);

  const extractDir = path.join(scratch, "extract");
  extract(zipPath, extractDir);
  const appRoot = locateAppRoot(extractDir);

  // The shipped ZIP must NOT carry the developer-only trees; if it does, the
  // guard in smoke-test.js is untested and Bug 1 could silently return.
  for (const forbidden of [".git", ".github", "docs", "release"]) {
    if (fs.existsSync(path.join(appRoot, forbidden))) {
      throw new Error(`release archive unexpectedly contains developer tree: ${forbidden}`);
    }
  }

  const dataDir = path.join(scratch, "settings");
  run(process.execPath, [path.join(appRoot, "scripts", "smoke-test.js")], {
    cwd: appRoot,
    env: { ...process.env, QUOTA_WEATHER_DATA_DIR: dataDir },
  });
  console.log("Release-archive smoke test passed: packaged ZIP updates cleanly.");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
