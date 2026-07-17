"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const packageInfo = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = packageInfo.version;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const key = `${process.platform}-${arch}`;
const releaseDir = path.join(ROOT, "release");
const stage = path.join(releaseDir, `.stage-${key}`);
const output = path.join(releaseDir, `codex-quota-weather-v${version}-${key}.zip`);

const excludedTopLevel = new Set([
  ".git", ".github", ".tmp", "dist", "docs", "node_modules", "out", "release", "config.json",
]);

function copyProject() {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (excludedTopLevel.has(entry.name)) continue;
    fs.cpSync(path.join(ROOT, entry.name), path.join(stage, entry.name), {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
    });
  }
  const electronDist = path.join(ROOT, "node_modules", "electron", "dist");
  if (!fs.existsSync(electronDist)) throw new Error("Electron runtime is missing; run npm ci first");
  fs.cpSync(electronDist, path.join(stage, "node_modules", "electron", "dist"), {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
  });
}

function archive() {
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.rmSync(output, { force: true });
  let result;
  if (process.platform === "win32") {
    const source = path.join(stage, "*").replace(/'/g, "''");
    const target = output.replace(/'/g, "''");
    result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -Path '${source}' -DestinationPath '${target}' -CompressionLevel Optimal -Force`],
      { stdio: "inherit" }
    );
  } else {
    result = spawnSync("/usr/bin/zip", ["-qry", "-y", output, "."], { cwd: stage, stdio: "inherit" });
  }
  if (result.status !== 0 || !fs.existsSync(output)) throw new Error("Could not create the release archive");
}

copyProject();
archive();
fs.rmSync(stage, { recursive: true, force: true });
console.log(output);

