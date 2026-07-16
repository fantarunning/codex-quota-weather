const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_DIR = __dirname;
const DEFAULT_CONFIG_PATH = path.join(APP_DIR, "config.example.json");
const LEGACY_CONFIG_PATH = path.join(APP_DIR, "config.json");
const DATA_DIR =
  process.env.QUOTA_WEATHER_DATA_DIR ||
  path.join(process.env.APPDATA || os.homedir(), "CodexQuotaWeather");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

const BUILTIN_DEFAULTS = {
  port: 8787,
  refreshMs: 4000,
  liveUsageMs: 60000,
  dailyBudgetTokens: 20000000,
  alwaysOnTop: true,
  lang: "zh",
  scale: 0.8,
  windowX: null,
  windowY: null,
  defaultTheme: "rain",
  defaultBackgroundIndex: 1,
  minScale: 0.5,
  maxScale: 1.4,
  followCodex: true,
  watchProcesses: ["Codex", "ChatGPT"],
  watchIntervalMs: 5000,
  weatherSwitchIntervalMs: 600000,
};

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function defaultConfig() {
  return { ...BUILTIN_DEFAULTS, ...(readJson(DEFAULT_CONFIG_PATH) || {}) };
}

function ensureUserConfig() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(CONFIG_PATH)) return;

  // Preserve settings from releases that stored mutable config beside the app.
  const legacy = readJson(LEGACY_CONFIG_PATH);
  const initial = legacy ? { ...defaultConfig(), ...legacy } : defaultConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(initial, null, 2) + "\n", "utf8");
}

function loadConfig() {
  try {
    ensureUserConfig();
  } catch {
    return defaultConfig();
  }
  return { ...defaultConfig(), ...(readJson(CONFIG_PATH) || {}) };
}

function updateConfig(patch) {
  const next = { ...loadConfig(), ...(patch || {}) };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

module.exports = {
  APP_DIR,
  CONFIG_PATH,
  DATA_DIR,
  defaultConfig,
  loadConfig,
  updateConfig,
};
