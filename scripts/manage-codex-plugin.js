#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const PLUGIN_NAME = "quota-weather";
const MARKETPLACE_NAME = "personal";
const CONFIG_SECTION = `[plugins."${PLUGIN_NAME}@${MARKETPLACE_NAME}"]`;

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(temporary, filePath);
}

function updateConfig(configPath, enabled) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let source = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const escaped = CONFIG_SECTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionPattern = new RegExp(`(?:^|\\n)${escaped}\\r?\\n([\\s\\S]*?)(?=\\n\\[|$)`);
  const match = sectionPattern.exec(source);

  if (enabled) {
    if (match) {
      const original = match[0];
      let replacement = original;
      if (/^enabled\s*=/m.test(replacement)) {
        replacement = replacement.replace(/^enabled\s*=.*$/m, "enabled = true");
      } else {
        replacement = `${replacement.trimEnd()}\nenabled = true\n`;
      }
      source = source.slice(0, match.index) + replacement + source.slice(match.index + original.length);
    } else {
      source = `${source.trimEnd()}${source.trim() ? "\n\n" : ""}${CONFIG_SECTION}\nenabled = true\n`;
    }
  } else if (match) {
    source = (source.slice(0, match.index) + source.slice(match.index + match[0].length))
      .replace(/^\s+/, "")
      .replace(/\n{3,}/g, "\n\n");
  }

  fs.writeFileSync(configPath, source, "utf8");
}

function loadMarketplace(filePath) {
  if (!fs.existsSync(filePath)) {
    return { name: MARKETPLACE_NAME, interface: { displayName: "Personal" }, plugins: [] };
  }
  const marketplace = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (marketplace.name !== MARKETPLACE_NAME) {
    throw new Error(`Expected marketplace name ${MARKETPLACE_NAME}, found ${marketplace.name || "missing"}`);
  }
  if (!marketplace.interface) marketplace.interface = { displayName: "Personal" };
  if (!Array.isArray(marketplace.plugins)) marketplace.plugins = [];
  return marketplace;
}

function pluginEntry() {
  return {
    name: PLUGIN_NAME,
    source: { source: "local", path: `./plugins/${PLUGIN_NAME}` },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity",
  };
}

function install(sourceDir, paths) {
  const manifest = path.join(sourceDir, ".codex-plugin", "plugin.json");
  if (!fs.existsSync(manifest)) throw new Error(`Plugin manifest is missing: ${manifest}`);
  const metadata = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (metadata.name !== PLUGIN_NAME) throw new Error(`Unexpected plugin name: ${metadata.name}`);

  const temporary = `${paths.pluginDir}.tmp-${process.pid}`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(paths.pluginDir), { recursive: true });
  fs.cpSync(sourceDir, temporary, { recursive: true });
  if (process.platform !== "win32") {
    fs.chmodSync(path.join(temporary, "scripts", "show-quota.sh"), 0o755);
  }
  fs.rmSync(paths.pluginDir, { recursive: true, force: true });
  fs.renameSync(temporary, paths.pluginDir);

  const marketplace = loadMarketplace(paths.marketplaceFile);
  const index = marketplace.plugins.findIndex((entry) => entry && entry.name === PLUGIN_NAME);
  if (index >= 0) marketplace.plugins[index] = pluginEntry();
  else marketplace.plugins.push(pluginEntry());
  writeJsonAtomic(paths.marketplaceFile, marketplace);
  updateConfig(paths.configFile, true);

  return { ok: true, action: "installed", version: metadata.version, ...paths, restartCodex: true };
}

function remove(paths) {
  fs.rmSync(paths.pluginDir, { recursive: true, force: true });
  if (fs.existsSync(paths.marketplaceFile)) {
    const marketplace = loadMarketplace(paths.marketplaceFile);
    marketplace.plugins = marketplace.plugins.filter((entry) => !entry || entry.name !== PLUGIN_NAME);
    writeJsonAtomic(paths.marketplaceFile, marketplace);
  }
  updateConfig(paths.configFile, false);
  return { ok: true, action: "removed", ...paths, restartCodex: true };
}

function main() {
  const action = process.argv[2];
  const sourceDir = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const home = path.resolve(process.env.CODEX_QUOTA_WEATHER_PLUGIN_HOME || os.homedir());
  const paths = {
    pluginDir: path.join(home, "plugins", PLUGIN_NAME),
    marketplaceFile: path.join(home, ".agents", "plugins", "marketplace.json"),
    configFile: path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "config.toml"),
  };

  let result;
  if (action === "install") {
    if (!sourceDir) throw new Error("Plugin source directory is required");
    result = install(sourceDir, paths);
  } else if (action === "remove") {
    result = remove(paths);
  } else {
    throw new Error("Usage: manage-codex-plugin.js <install source-dir|remove>");
  }
  process.stdout.write(JSON.stringify(result) + "\n");
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
