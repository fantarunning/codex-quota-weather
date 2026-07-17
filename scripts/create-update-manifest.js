"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const releaseDir = path.resolve(process.argv[2] || path.join(ROOT, "release"));
const packageInfo = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = packageInfo.version;
const prefix = `codex-quota-weather-v${version}-`;
const files = fs.readdirSync(releaseDir)
  .filter((name) => name.startsWith(prefix) && name.endsWith(".zip"))
  .sort();
if (!files.length) throw new Error(`No v${version} release archives found in ${releaseDir}`);

const assets = {};
const sums = [];
for (const name of files) {
  const filePath = path.join(releaseDir, name);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  const key = name.slice(prefix.length, -4);
  assets[key] = { name, sha256: digest, size: fs.statSync(filePath).size };
  sums.push(`${digest}  ${name}`);
}

const manifest = {
  schemaVersion: 1,
  version,
  publishedAt: new Date().toISOString(),
  assets,
};
fs.writeFileSync(path.join(releaseDir, "update-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(releaseDir, "SHA256SUMS.txt"), sums.join("\n") + "\n", "utf8");
console.log(`Created update manifest for v${version} with ${files.length} assets.`);

