#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(ROOT, "state");
const STATE_FILE = path.join(STATE_DIR, "update-state.json");
const VERSIONS_DIR = path.join(ROOT, "versions");
const LOG_DIR = path.join(ROOT, "logs");
const KEEP_VERSIONS = 5;
const BOOT_TIMEOUT_MS = 30_000;

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(temp, filePath);
}

function versionParts(version) {
  return String(version || "0")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const av = left[i] == null ? 0 : left[i];
    const bv = right[i] == null ? 0 : right[i];
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "number") return av > bv ? 1 : -1;
    return String(av).localeCompare(String(bv), undefined, { numeric: true });
  }
  return 0;
}

function installedVersions() {
  try {
    return fs.readdirSync(VERSIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .filter((version) => fs.existsSync(path.join(VERSIONS_DIR, version, "package.json")))
      .sort((a, b) => compareVersions(b, a));
  } catch {
    return [];
  }
}

function electronExecutable(appDir) {
  const dist = path.join(appDir, "node_modules", "electron", "dist");
  if (process.platform === "win32") return path.join(dist, "electron.exe");
  if (process.platform === "darwin") {
    return path.join(dist, "Electron.app", "Contents", "MacOS", "Electron");
  }
  return path.join(dist, "electron");
}

function mergeInstalledState(state, versions) {
  const known = new Map(
    (Array.isArray(state.installedVersions) ? state.installedVersions : [])
      .map((entry) => [typeof entry === "string" ? entry : entry.version, entry])
  );
  state.installedVersions = versions.map((version) => {
    const previous = known.get(version);
    return typeof previous === "object" && previous
      ? { ...previous, version }
      : { version, installedAt: new Date().toISOString() };
  });
}

function loadState() {
  const state = readJson(STATE_FILE, {}) || {};
  const versions = installedVersions();
  if (!state.currentVersion || !versions.includes(state.currentVersion)) {
    state.currentVersion = versions[0] || null;
  }
  mergeInstalledState(state, versions);
  state.schemaVersion = 1;
  return state;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function configPath() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || ROOT, "CodexQuotaWeather", "config.json");
  }
  if (process.platform === "darwin") return path.join(ROOT, "config.json");
  return null;
}

function backupConfig(version) {
  const source = configPath();
  if (!source || !fs.existsSync(source)) return null;
  const backupDir = path.join(STATE_DIR, "config-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const safeVersion = String(version || "unknown").replace(/[^a-z0-9._-]/gi, "_");
  const target = path.join(backupDir, `${safeVersion}-${Date.now()}.json`);
  fs.copyFileSync(source, target);
  return target;
}

function restoreConfig(backupPath) {
  const target = configPath();
  if (!backupPath || !target || !fs.existsSync(backupPath)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(backupPath, target);
}

function appendLog(message) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(LOG_DIR, "launcher.log"),
      `${new Date().toISOString()} ${message}\n`,
      "utf8"
    );
  } catch {
    // Logging must never prevent the panel from starting.
  }
}

function copyFileAtomic(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${process.pid}.tmp`;
  fs.copyFileSync(source, temp);
  fs.renameSync(temp, destination);
}

function updateStableFiles(version) {
  const versionDir = path.join(VERSIONS_DIR, version);
  const pairs = [
    [path.join(versionDir, "launcher", "launcher.js"), path.join(ROOT, "launcher", "launcher.js")],
    [path.join(versionDir, "launcher", "start-hidden.vbs"), path.join(ROOT, "launcher", "start-hidden.vbs")],
    [path.join(versionDir, "launcher", "start-macos.sh"), path.join(ROOT, "launcher", "start-macos.sh")],
    [path.join(versionDir, "scripts", "manage-codex-plugin.js"), path.join(ROOT, "manage-codex-plugin.js")],
    [path.join(versionDir, "uninstall.ps1"), path.join(ROOT, "uninstall.ps1")],
    [path.join(versionDir, "uninstall-macos.sh"), path.join(ROOT, "uninstall-macos.sh")],
    [path.join(versionDir, "scripts", "remove-install.ps1"), path.join(ROOT, "scripts", "remove-install.ps1")],
  ];
  for (const [source, destination] of pairs) copyFileAtomic(source, destination);
  if (process.platform !== "win32") {
    for (const filePath of [path.join(ROOT, "launcher", "start-macos.sh"), path.join(ROOT, "uninstall-macos.sh")]) {
      try { if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o755); } catch { /* best effort */ }
    }
  }

  const pluginManager = path.join(ROOT, "manage-codex-plugin.js");
  const pluginSource = path.join(versionDir, "codex-plugin", "quota-weather");
  if (fs.existsSync(pluginManager) && fs.existsSync(pluginSource)) {
    const result = spawnSync(process.execPath, [pluginManager, "install", pluginSource], {
      cwd: ROOT,
      windowsHide: true,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`Codex /quota plugin update failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
    }
  }
}

function launchVersion(version, bootToken = "") {
  const appDir = path.join(VERSIONS_DIR, version);
  const executable = electronExecutable(appDir);
  if (!fs.existsSync(executable)) {
    throw new Error(`Electron runtime is missing for version ${version}: ${executable}`);
  }
  const env = {
    ...process.env,
    QUOTA_WEATHER_INSTALL_ROOT: ROOT,
    QUOTA_WEATHER_VERSION: version,
  };
  if (bootToken) env.QUOTA_WEATHER_BOOT_TOKEN = bootToken;
  const child = spawn(executable, [appDir], {
    cwd: appDir,
    env,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
  appendLog(`launched v${version} pid=${child.pid}${bootToken ? " pending-health-check" : ""}`);
  return child;
}

async function waitForHealthyBoot(child, token) {
  const marker = path.join(STATE_DIR, `boot-${token}.ok`);
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(marker)) return { ok: true, marker };
    if (!isProcessAlive(child.pid)) return { ok: false, marker, reason: "process exited before ready" };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { ok: false, marker, reason: "startup health check timed out" };
}

function cleanupVersions(state) {
  const versions = installedVersions();
  const protectedVersions = new Set([state.currentVersion, state.previousVersion].filter(Boolean));
  const keep = new Set([...protectedVersions]);
  for (const version of versions) {
    if (keep.size >= KEEP_VERSIONS && !protectedVersions.has(version)) continue;
    keep.add(version);
  }
  for (const version of versions) {
    if (keep.has(version)) continue;
    try {
      fs.rmSync(path.join(VERSIONS_DIR, version), { recursive: true, force: true });
      appendLog(`removed old version v${version}`);
    } catch (error) {
      appendLog(`could not remove v${version}: ${error.message}`);
    }
  }
  mergeInstalledState(state, installedVersions());
}

async function main() {
  const waitIndex = process.argv.indexOf("--wait-pid");
  if (waitIndex >= 0) {
    await waitForProcessExit(Number(process.argv[waitIndex + 1]));
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(VERSIONS_DIR, { recursive: true });
  let state = loadState();

  // Finish a health check whose launcher was interrupted after the app became ready.
  if (state.awaitingToken) {
    const oldMarker = path.join(STATE_DIR, `boot-${state.awaitingToken}.ok`);
    if (fs.existsSync(oldMarker)) {
      fs.rmSync(oldMarker, { force: true });
      state.healthyVersion = state.currentVersion;
      state.awaitingVersion = null;
      state.awaitingToken = null;
      state.lastError = null;
      state.updatedAt = new Date().toISOString();
      try { updateStableFiles(state.currentVersion); } catch (error) { appendLog(`stable launcher update failed: ${error.message}`); }
      cleanupVersions(state);
      writeJsonAtomic(STATE_FILE, state);
    }
  }

  let switched = false;
  let configBackup = null;
  if (state.pendingVersion && state.pendingVersion !== state.currentVersion) {
    const pendingDir = path.join(VERSIONS_DIR, state.pendingVersion);
    if (!fs.existsSync(path.join(pendingDir, "package.json"))) {
      state.lastError = `Pending version ${state.pendingVersion} is not installed`;
      state.pendingVersion = null;
      writeJsonAtomic(STATE_FILE, state);
    } else {
      configBackup = backupConfig(state.currentVersion);
      state.previousVersion = state.currentVersion;
      state.currentVersion = state.pendingVersion;
      state.pendingVersion = null;
      state.awaitingVersion = state.currentVersion;
      state.awaitingToken = crypto.randomBytes(16).toString("hex");
      state.updatedAt = new Date().toISOString();
      switched = true;
      writeJsonAtomic(STATE_FILE, state);
      appendLog(`switching v${state.previousVersion || "none"} -> v${state.currentVersion}`);
    }
  } else if (state.pendingVersion === state.currentVersion) {
    state.pendingVersion = null;
    state.updatedAt = new Date().toISOString();
    writeJsonAtomic(STATE_FILE, state);
  }

  if (!state.currentVersion) throw new Error("No installed version is available");
  let child;
  try {
    child = launchVersion(state.currentVersion, switched ? state.awaitingToken : "");
  } catch (error) {
    if (!switched || !state.previousVersion) throw error;
    const failedVersion = state.currentVersion;
    state.currentVersion = state.previousVersion;
    state.previousVersion = failedVersion;
    state.awaitingVersion = null;
    state.awaitingToken = null;
    state.pendingVersion = null;
    state.lastError = `v${failedVersion} could not launch: ${error.message}`;
    state.updatedAt = new Date().toISOString();
    writeJsonAtomic(STATE_FILE, state);
    restoreConfig(configBackup);
    appendLog(`${state.lastError}; rolled back to v${state.currentVersion}`);
    launchVersion(state.currentVersion);
    return;
  }
  if (!switched) return;

  const result = await waitForHealthyBoot(child, state.awaitingToken);
  if (result.ok) {
    fs.rmSync(result.marker, { force: true });
    state = loadState();
    state.healthyVersion = state.currentVersion;
    state.awaitingVersion = null;
    state.awaitingToken = null;
    state.lastError = null;
    state.updatedAt = new Date().toISOString();
    try { updateStableFiles(state.currentVersion); } catch (error) { appendLog(`stable launcher update failed: ${error.message}`); }
    cleanupVersions(state);
    writeJsonAtomic(STATE_FILE, state);
    appendLog(`v${state.currentVersion} passed startup health check`);
    return;
  }

  try { process.kill(child.pid); } catch { /* already exited */ }
  state = loadState();
  const failedVersion = state.currentVersion;
  const fallback = state.previousVersion;
  state.currentVersion = fallback;
  state.previousVersion = failedVersion;
  state.awaitingVersion = null;
  state.awaitingToken = null;
  state.pendingVersion = null;
  state.lastError = `v${failedVersion} failed to start: ${result.reason}`;
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(STATE_FILE, state);
  restoreConfig(configBackup);
  appendLog(`${state.lastError}; rolled back to v${fallback || "none"}`);
  if (fallback) launchVersion(fallback);
}

main().catch((error) => {
  appendLog(`launcher failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
