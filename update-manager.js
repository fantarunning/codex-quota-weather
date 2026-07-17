"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter, once } = require("events");
const { spawn } = require("child_process");

const REPO_OWNER = "fantarunning";
const REPO_NAME = "codex-quota-weather";
const API_ROOT = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

function cleanVersion(version) {
  return String(version || "").trim().replace(/^v/i, "");
}

function validVersion(version) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(cleanVersion(version));
}

function versionParts(version) {
  return cleanVersion(version)
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

function platformKey(platform = process.platform, arch = process.arch) {
  const normalizedArch = arch === "arm64" ? "arm64" : "x64";
  return `${platform}-${normalizedArch}`;
}

function artifactName(version, platform = process.platform, arch = process.arch) {
  return `codex-quota-weather-v${cleanVersion(version)}-${platformKey(platform, arch)}.zip`;
}

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

function installedRoot(appDir, env = process.env) {
  if (env.QUOTA_WEATHER_INSTALL_ROOT) return path.resolve(env.QUOTA_WEATHER_INSTALL_ROOT);
  const parent = path.dirname(path.resolve(appDir));
  if (path.basename(parent).toLowerCase() === "versions") return path.dirname(parent);
  return null;
}

function electronExecutable(appDir, platform = process.platform) {
  const dist = path.join(appDir, "node_modules", "electron", "dist");
  if (platform === "win32") return path.join(dist, "electron.exe");
  if (platform === "darwin") {
    return path.join(dist, "Electron.app", "Contents", "MacOS", "Electron");
  }
  return path.join(dist, "electron");
}

function nodeExecutable(root, platform = process.platform) {
  return platform === "win32"
    ? path.join(root, "runtime", "node", "node.exe")
    : path.join(root, "runtime", "node", "bin", "node");
}

function safePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk; });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(executable)} exited with ${code}`));
    });
  });
}

async function networkFetch(url, options = {}) {
  try {
    const electron = require("electron");
    if (electron.net && typeof electron.net.fetch === "function") {
      return electron.net.fetch(url, options);
    }
  } catch {
    // Unit tests run in Node, where global fetch is the fallback.
  }
  if (typeof fetch !== "function") throw new Error("No network fetch implementation is available");
  return fetch(url, options);
}

async function fetchJson(url) {
  const response = await networkFetch(url, {
    redirect: "follow",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "codex-quota-weather-updater",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  return response.json();
}

async function downloadFile(url, target, onProgress) {
  const response = await networkFetch(url, {
    redirect: "follow",
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "codex-quota-weather-updater",
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download returned HTTP ${response.status}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const output = fs.createWriteStream(target, { flags: "w" });
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  let lastPercent = -1;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      received += bytes.length;
      if (!output.write(bytes)) await once(output, "drain");
      const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : 0;
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent, received, total);
      }
    }
    output.end();
    await once(output, "finish");
  } catch (error) {
    output.destroy();
    throw error;
  }
  onProgress(100, received, total);
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function extractZip(zipPath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === "win32") {
    const command = `Expand-Archive -LiteralPath ${safePowerShellLiteral(zipPath)} -DestinationPath ${safePowerShellLiteral(destination)} -Force`;
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { stdio: ["ignore", "pipe", "pipe"] });
    return;
  }
  if (process.platform === "darwin") {
    await run("/usr/bin/ditto", ["-x", "-k", zipPath, destination], { stdio: ["ignore", "pipe", "pipe"] });
    return;
  }
  await run("unzip", ["-q", zipPath, "-d", destination], { stdio: ["ignore", "pipe", "pipe"] });
}

function locateAppRoot(extractDir) {
  if (fs.existsSync(path.join(extractDir, "package.json"))) return extractDir;
  const directories = fs.readdirSync(extractDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of directories) {
    const candidate = path.join(extractDir, entry.name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return null;
}

class UpdateManager extends EventEmitter {
  constructor({ appDir, currentVersion, onRestart } = {}) {
    super();
    this.appDir = path.resolve(appDir || __dirname);
    this.currentVersion = cleanVersion(currentVersion || readJson(path.join(this.appDir, "package.json"), {}).version);
    this.root = installedRoot(this.appDir);
    this.onRestart = typeof onRestart === "function" ? onRestart : () => {};
    this.releases = [];
    this.busy = false;
    this.status = {
      managed: Boolean(this.root),
      phase: this.root ? "idle" : "unmanaged",
      currentVersion: this.currentVersion,
      latestVersion: null,
      targetVersion: null,
      progress: 0,
      message: this.root ? null : "Run the installer once to enable in-panel updates",
      lastCheckedAt: null,
    };
    if (this.root) this.refreshLocalStatus();
  }

  stateFile() { return path.join(this.root, "state", "update-state.json"); }
  versionsDir() { return path.join(this.root, "versions"); }
  downloadsDir() { return path.join(this.root, "downloads"); }

  readState() {
    if (!this.root) return {};
    return readJson(this.stateFile(), {}) || {};
  }

  writeState(state) {
    state.schemaVersion = 1;
    state.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.stateFile(), state);
  }

  localVersions() {
    if (!this.root) return [];
    const state = this.readState();
    const known = new Map(
      (Array.isArray(state.installedVersions) ? state.installedVersions : [])
        .map((entry) => [typeof entry === "string" ? entry : entry.version, entry])
    );
    let directories = [];
    try {
      directories = fs.readdirSync(this.versionsDir(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && validVersion(entry.name))
        .map((entry) => entry.name)
        .filter((version) => fs.existsSync(path.join(this.versionsDir(), version, "package.json")));
    } catch {
      // The managed installer creates this directory before first launch.
    }
    return directories.sort((a, b) => compareVersions(b, a)).map((version) => ({
      version,
      installedAt: known.get(version)?.installedAt || null,
      current: version === state.currentVersion || version === this.currentVersion,
      previous: version === state.previousVersion,
      switchable: fs.existsSync(path.join(this.versionsDir(), version, "update-manager.js")),
    }));
  }

  publicStatus() {
    const installed = this.localVersions();
    const installedSet = new Set(installed.map((entry) => entry.version));
    const releases = this.releases.slice(0, 12).map((release) => ({
      version: release.version,
      name: release.name,
      publishedAt: release.publishedAt,
      notesUrl: release.notesUrl,
      installed: installedSet.has(release.version),
      downloadable: Boolean(release.asset),
    }));
    return JSON.parse(JSON.stringify({ ...this.status, installed, releases }));
  }

  emitStatus(patch = {}) {
    this.status = { ...this.status, ...patch };
    const snapshot = this.publicStatus();
    this.emit("status", snapshot);
    return snapshot;
  }

  getStatus() {
    this.refreshLocalStatus(false);
    return this.publicStatus();
  }

  refreshLocalStatus(emit = true) {
    if (!this.root) return this.publicStatus();
    const state = this.readState();
    const patch = {
      currentVersion: state.currentVersion || this.currentVersion,
      targetVersion: state.pendingVersion || this.status.targetVersion,
      rollbackError: state.lastError || null,
    };
    if (state.pendingVersion) {
      patch.phase = "ready";
      patch.message = `v${state.pendingVersion} is ready to install`;
    }
    if (emit) return this.emitStatus(patch);
    this.status = { ...this.status, ...patch };
    return this.publicStatus();
  }

  async fetchReleases() {
    const payload = await fetchJson(`${API_ROOT}/releases?per_page=30`);
    const list = Array.isArray(payload) ? payload : [];
    this.releases = list
      .filter((release) => !release.draft && !release.prerelease && validVersion(release.tag_name))
      .map((release) => {
        const version = cleanVersion(release.tag_name);
        const wanted = artifactName(version);
        const assets = Array.isArray(release.assets) ? release.assets : [];
        return {
          version,
          name: release.name || release.tag_name,
          publishedAt: release.published_at,
          notesUrl: release.html_url,
          asset: assets.find((asset) => asset.name === wanted) || null,
          checksumAsset: assets.find((asset) => asset.name === "SHA256SUMS.txt") || null,
        };
      })
      .sort((a, b) => compareVersions(b.version, a.version));
    return this.releases;
  }

  async checkForUpdates() {
    if (!this.root) return this.emitStatus({ phase: "unmanaged" });
    if (this.busy) return this.publicStatus();
    this.emitStatus({ phase: "checking", message: null, progress: 0 });
    try {
      await this.fetchReleases();
      const latest = this.releases.find((release) => release.asset) || this.releases[0] || null;
      const state = this.readState();
      if (state.pendingVersion) {
        return this.emitStatus({
          phase: "ready",
          latestVersion: latest?.version || null,
          targetVersion: state.pendingVersion,
          lastCheckedAt: new Date().toISOString(),
          message: `v${state.pendingVersion} is ready to install`,
        });
      }
      const hasUpdate = latest && latest.asset && compareVersions(latest.version, this.currentVersion) > 0;
      return this.emitStatus({
        phase: hasUpdate ? "available" : "up-to-date",
        latestVersion: latest?.version || null,
        targetVersion: hasUpdate ? latest.version : null,
        lastCheckedAt: new Date().toISOString(),
        message: hasUpdate ? `v${latest.version} is available` : "You are up to date",
      });
    } catch (error) {
      return this.emitStatus({ phase: "error", message: error.message });
    }
  }

  async expectedDigest(release) {
    const digest = release.asset && release.asset.digest;
    if (typeof digest === "string" && digest.toLowerCase().startsWith("sha256:")) {
      return digest.slice(7).toLowerCase();
    }
    if (!release.checksumAsset) throw new Error("The release does not provide a SHA-256 checksum");
    const response = await networkFetch(release.checksumAsset.browser_download_url, {
      redirect: "follow",
      headers: { "User-Agent": "codex-quota-weather-updater" },
    });
    if (!response.ok) throw new Error(`Checksum download returned HTTP ${response.status}`);
    const checksums = await response.text();
    const line = checksums.split(/\r?\n/).find((entry) => entry.trim().endsWith(`  ${release.asset.name}`));
    if (!line || !/^[a-f0-9]{64}\s/i.test(line)) throw new Error("The release checksum file is incomplete");
    return line.trim().split(/\s+/)[0].toLowerCase();
  }

  async verifyAndStage(release, zipPath) {
    const version = release.version;
    const expected = await this.expectedDigest(release);
    this.emitStatus({ phase: "verifying", progress: 100, message: "Verifying SHA-256" });
    const actual = await sha256(zipPath);
    if (actual !== expected) throw new Error(`SHA-256 mismatch for ${release.asset.name}`);

    const tempDir = path.join(this.versionsDir(), `.${version}-${Date.now()}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
    this.emitStatus({ phase: "installing", message: "Extracting and testing the update" });
    try {
      await extractZip(zipPath, tempDir);
      const extractedRoot = locateAppRoot(tempDir);
      if (!extractedRoot) throw new Error("The update archive does not contain package.json");
      const packageInfo = readJson(path.join(extractedRoot, "package.json"), {});
      if (cleanVersion(packageInfo.version) !== version) {
        throw new Error(`Archive version ${packageInfo.version || "unknown"} does not match v${version}`);
      }
      if (!fs.existsSync(electronExecutable(extractedRoot))) {
        throw new Error("The update archive does not contain the Electron runtime");
      }
      const node = nodeExecutable(this.root);
      if (!fs.existsSync(node)) throw new Error("The private Node.js runtime is missing; rerun the installer");
      const smokeDataDir = path.join(this.downloadsDir(), `.smoke-settings-${version}-${process.pid}`);
      try {
        await run(node, [path.join(extractedRoot, "scripts", "smoke-test.js")], {
          cwd: extractedRoot,
          env: { ...process.env, QUOTA_WEATHER_DATA_DIR: smokeDataDir },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } finally {
        fs.rmSync(smokeDataDir, { recursive: true, force: true });
      }

      const finalDir = path.join(this.versionsDir(), version);
      if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
      if (extractedRoot === tempDir) {
        fs.renameSync(tempDir, finalDir);
      } else {
        fs.renameSync(extractedRoot, finalDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      return finalDir;
    } catch (error) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  prepareSwitch(version) {
    version = cleanVersion(version);
    if (!validVersion(version)) throw new Error("Invalid version");
    if (!fs.existsSync(path.join(this.versionsDir(), version, "package.json"))) {
      throw new Error(`v${version} is not installed`);
    }
    if (!fs.existsSync(path.join(this.versionsDir(), version, "update-manager.js"))) {
      throw new Error(`v${version} is a legacy emergency backup and cannot manage a later switch`);
    }
    const state = this.readState();
    if (version === state.currentVersion || version === this.currentVersion) {
      state.pendingVersion = null;
      this.writeState(state);
      return this.emitStatus({
        phase: "up-to-date",
        targetVersion: null,
        progress: 0,
        message: `v${version} is already active`,
      });
    }
    const existing = new Map(
      (Array.isArray(state.installedVersions) ? state.installedVersions : [])
        .map((entry) => [typeof entry === "string" ? entry : entry.version, entry])
    );
    if (!existing.has(version)) existing.set(version, { version, installedAt: new Date().toISOString() });
    state.installedVersions = [...existing.values()];
    state.pendingVersion = version;
    this.writeState(state);
    return this.emitStatus({
      phase: "ready",
      targetVersion: version,
      progress: 100,
      message: `v${version} is ready; restart to switch`,
    });
  }

  async downloadVersion(version) {
    if (!this.root) throw new Error("Run the installer once to enable updates");
    version = cleanVersion(version || this.status.targetVersion || this.status.latestVersion);
    if (!validVersion(version)) throw new Error("No downloadable version was selected");
    if (fs.existsSync(path.join(this.versionsDir(), version, "package.json"))) {
      return this.prepareSwitch(version);
    }
    if (this.busy) return this.publicStatus();
    this.busy = true;
    let partial = null;
    try {
      if (!this.releases.length) await this.fetchReleases();
      const release = this.releases.find((entry) => entry.version === version);
      if (!release || !release.asset) throw new Error(`No ${platformKey()} package is attached to v${version}`);
      fs.mkdirSync(this.downloadsDir(), { recursive: true });
      partial = path.join(this.downloadsDir(), `${release.asset.name}.partial`);
      this.emitStatus({ phase: "downloading", targetVersion: version, progress: 0, message: `Downloading v${version}` });
      await downloadFile(release.asset.browser_download_url, partial, (progress, received, total) => {
        this.emitStatus({ phase: "downloading", progress, bytesReceived: received, bytesTotal: total });
      });
      await this.verifyAndStage(release, partial);
      fs.rmSync(partial, { force: true });
      partial = null;
      return this.prepareSwitch(version);
    } catch (error) {
      if (partial) fs.rmSync(partial, { force: true });
      return this.emitStatus({ phase: "error", message: error.message });
    } finally {
      this.busy = false;
    }
  }

  async downloadLatest() {
    let version = this.status.targetVersion || this.status.latestVersion;
    if (!version) {
      await this.checkForUpdates();
      version = this.status.targetVersion || this.status.latestVersion;
    }
    return this.downloadVersion(version);
  }

  async restartToApply() {
    if (!this.root) throw new Error("This is not a managed installation");
    const state = this.readState();
    if (!state.pendingVersion) throw new Error("No version is ready to install");
    const node = nodeExecutable(this.root);
    const launcher = path.join(this.root, "launcher", "launcher.js");
    if (!fs.existsSync(node) || !fs.existsSync(launcher)) {
      throw new Error("The stable launcher is incomplete; rerun the installer");
    }
    const child = spawn(node, [launcher, "--wait-pid", String(process.pid)], {
      cwd: this.root,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
    this.emitStatus({ phase: "restarting", message: `Restarting into v${state.pendingVersion}` });
    setTimeout(() => this.onRestart(), 120);
    return this.publicStatus();
  }
}

function markBootSuccessful(installRoot = process.env.QUOTA_WEATHER_INSTALL_ROOT, token = process.env.QUOTA_WEATHER_BOOT_TOKEN) {
  if (!installRoot || !token || !/^[a-f0-9]{32}$/i.test(token)) return false;
  const stateDir = path.join(path.resolve(installRoot), "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, `boot-${token}.ok`), `${new Date().toISOString()}\n`, "utf8");
  return true;
}

module.exports = {
  UpdateManager,
  artifactName,
  cleanVersion,
  compareVersions,
  markBootSuccessful,
  platformKey,
};
