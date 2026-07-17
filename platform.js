const os = require("os");
const path = require("path");

function electronExecutable(rootDir, platform = process.platform) {
  const dist = path.join(rootDir, "node_modules", "electron", "dist");
  if (platform === "win32") return path.join(dist, "electron.exe");
  if (platform === "darwin") {
    return path.join(dist, "Electron.app", "Contents", "MacOS", "Electron");
  }
  return path.join(dist, "electron");
}

function settingsDataDir({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (env.QUOTA_WEATHER_DATA_DIR) return env.QUOTA_WEATHER_DATA_DIR;
  if (platform === "win32") {
    return path.join(env.APPDATA || home, "CodexQuotaWeather");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "CodexQuotaWeather");
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "CodexQuotaWeather");
}

module.exports = { electronExecutable, settingsDataDir };
