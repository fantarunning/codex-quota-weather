#!/usr/bin/env node
// Quota-Weather local data service.
//
// Scans Codex session rollout JSONL files and serves aggregated, REAL usage
// over HTTP for the floating panel to poll. Also serves the panel HTML itself
// (same origin as /quota, so the renderer's fetch() has no CORS/file:// issues).
//
// Data source (verified on this machine):
//   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//   each line: { timestamp, type, payload }
//   token_count event payload:
//     { type:"token_count",
//       info:{ total_token_usage:{total_tokens,...},   // cumulative per session
//              last_token_usage:{total_tokens,...},     // per-turn delta
//              model_context_window:N },
//       rate_limits:{ primary:{used_percent,window_minutes,resets_at}, ... } }
//
// rate_limits.primary is the REAL plan quota (e.g. weekly window). It is only
// populated on recent sessions; older/proxy-only sessions have it null, so we
// keep the newest non-empty snapshot.
//
// Can run standalone (`node server.js`) or be started in-process by the Electron
// shell via require('./server.js').startDataServer({ port }).

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { fetchLiveUsage, readAccountPlanType, readAccountId } = require("./liveUsage.js");
const { loadConfig } = require("./settings.js");

const APP_DIR = __dirname;
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const SESSIONS_DIR = path.join(CODEX_HOME, "sessions");

// ---- live plan quota cache ------------------------------------------------
// A background poller hits ChatGPT's /wham/usage endpoint directly, so the plan
// quota refreshes even when you're not actively chatting in Codex. aggregateToday
// prefers this live snapshot; the session-file rate_limits are the fallback.
// accountId tags the cache with the auth.json account it was fetched for, so a
// Codex account switch drops the previous account's plan instead of showing it.
let liveCache = { plan: null, at: 0, ok: false, accountId: null };
let liveInFlight = null; // dedupe concurrent fetches (poller + manual refresh)

// Drop any cached live plan when the signed-in Codex account no longer matches
// the account the cache was built for. Called on every /quota so a mid-session
// account switch can't keep serving the old account's quota.
function invalidateCacheOnAccountSwitch(codexHome = CODEX_HOME) {
  const current = readAccountId(codexHome);
  if (current === liveCache.accountId) return false;
  liveCache = { plan: null, at: 0, ok: false, accountId: current };
  return true;
}

// Fetch the live quota once and update liveCache. Returns the fetch result.
// Concurrent callers share one in-flight request.
async function refreshLiveNow() {
  if (liveInFlight) return liveInFlight;
  liveInFlight = (async () => {
    const accountId = readAccountId();
    try {
      const r = await fetchLiveUsage();
      if (r && r.ok && r.plan) {
        liveCache = { plan: r.plan, at: Date.now(), ok: true, accountId };
      } else if (accountId !== liveCache.accountId) {
        // The account changed under us; never keep the previous plan as "last
        // good" data for a different account.
        liveCache = { plan: null, at: 0, ok: false, accountId };
      } else {
        liveCache.ok = false; // same account, transient failure: keep last good
      }
      return r;
    } catch (e) {
      if (accountId !== liveCache.accountId) {
        liveCache = { plan: null, at: 0, ok: false, accountId };
      } else {
        liveCache.ok = false;
      }
      return { ok: false, error: String(e) };
    } finally {
      liveInFlight = null;
    }
  })();
  return liveInFlight;
}

function startLivePoller(intervalMs) {
  refreshLiveNow(); // immediate first fetch
  return setInterval(refreshLiveNow, intervalMs || 60000);
}

// ---- session file discovery ----------------------------------------------

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dayDir(date, sessionsDir = SESSIONS_DIR) {
  return path.join(
    sessionsDir,
    String(date.getFullYear()),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  );
}

function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function listJsonl(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function listAllJsonl(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(target);
    }
  }
  return files;
}

function recentlyActiveSessionFiles(now, sessionsDir = SESSIONS_DIR) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const files = new Set(listJsonl(dayDir(midnight, sessionsDir)));
  for (const file of listAllJsonl(sessionsDir)) {
    try {
      if (fs.statSync(file).mtimeMs >= midnight.getTime()) files.add(file);
    } catch {
      /* file disappeared while scanning */
    }
  }
  return [...files];
}

// ---- per-file incremental parse ------------------------------------------
// A long-running Codex task keeps appending to the file for the day on which
// the task started, even after local midnight. Cache the parsed byte offset and
// consume only appended JSONL records so a 100 MB active task is not reread
// every four seconds.

const sessionParseCache = new Map();

function newSessionState(file) {
  return {
    file,
    offset: 0,
    remainder: "",
    sessionId: null,
    cwd: null,
    model: null,
    provider: null,
    startedAt: null,
    startedDayKey: null,
    lastEventAt: null,
    finalTotalTokens: 0,
    lastTurnTokens: 0,
    contextWindow: 0,
    tokenEvents: 0,
    rateLimits: null,
    rateLimitsAt: null,
    planType: null,
    planTypeAt: null,
    dailyBuckets: Object.create(null),
  };
}

function dailyBucket(state, key) {
  if (!state.dailyBuckets[key]) {
    state.dailyBuckets[key] = {
      used: 0,
      calls: 0,
      lastEventAt: null,
      lastTurnTokens: 0,
      contextWindow: 0,
    };
  }
  return state.dailyBuckets[key];
}

function parseSessionLine(out, line) {
  if (!line) return;
  const hasToken = line.indexOf("token_count") !== -1;
  const hasMeta = line.indexOf("session_meta") !== -1;
  if (!hasToken && !hasMeta) return;

  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return;
  }
  const p = rec && rec.payload;
  if (!p) return;

  if (rec.type === "session_meta") {
    out.sessionId = p.session_id || p.id || out.sessionId;
    out.cwd = p.cwd || out.cwd;
    out.provider = p.model_provider || out.provider;
    out.model = p.model || out.model;
    out.startedAt = rec.timestamp || p.timestamp || out.startedAt;
    out.startedDayKey = localDayKey(out.startedAt) || out.startedDayKey;
    return;
  }

  if (p.type !== "token_count" || !p.info) return;
  const info = p.info;
  const total = Number(info.total_token_usage?.total_tokens) || 0;
  const delta = Math.max(0, total - out.finalTotalTokens);
  if (total > out.finalTotalTokens) out.finalTotalTokens = total;
  if (info.model_context_window) out.contextWindow = info.model_context_window;
  const timestamp = rec.timestamp || p.timestamp || null;
  if (timestamp) out.lastEventAt = timestamp;
  const lastTurn = Number(info.last_token_usage?.total_tokens) || 0;
  if (lastTurn > 0) out.tokenEvents += 1;
  out.lastTurnTokens = lastTurn;

  const key = localDayKey(timestamp);
  if (key) {
    const bucket = dailyBucket(out, key);
    bucket.used += delta;
    if (lastTurn > 0) bucket.calls += 1;
    if (!bucket.lastEventAt || timestamp >= bucket.lastEventAt) {
      bucket.lastEventAt = timestamp;
      bucket.lastTurnTokens = lastTurn;
      bucket.contextWindow = out.contextWindow;
    }
  }

  const rl = p.rate_limits;
  if (rl && (rl.primary || rl.secondary || rl.credits != null)) {
    out.rateLimits = rl;
    out.rateLimitsAt = timestamp || out.lastEventAt;
  }
  if (rl && rl.plan_type) {
    out.planType = rl.plan_type;
    out.planTypeAt = timestamp || out.lastEventAt;
  }
}

function parseSessionFile(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  let out = sessionParseCache.get(file);
  if (!out || stat.size < out.offset) {
    out = newSessionState(file);
    sessionParseCache.set(file, out);
  }
  if (stat.size <= out.offset) return out;

  const length = stat.size - out.offset;
  const buffer = Buffer.allocUnsafe(length);
  let bytesRead = 0;
  let fd;
  try {
    fd = fs.openSync(file, "r");
    bytesRead = fs.readSync(fd, buffer, 0, length, out.offset);
  } catch {
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
  const content = out.remainder + buffer.toString("utf8", 0, bytesRead);
  const lines = content.split("\n");
  out.remainder = lines.pop() || "";
  for (const line of lines) parseSessionLine(out, line.replace(/\r$/, ""));
  out.offset += bytesRead;
  return out;
}

// ---- rate-limit snapshot across recent days -------------------------------
// The freshest real plan quota may be in a recent session that isn't today's,
// so scan the last few days and keep the newest non-empty rate_limits.

function labelWindow(minutes) {
  if (!minutes) return "";
  if (minutes >= 10080) return "weekly";
  if (minutes >= 1440) return "daily";
  if (minutes >= 300) return "5h";
  return minutes + "m";
}

function humanizeUntil(epochSecs) {
  if (!epochSecs) return "—";
  const ms = epochSecs * 1000 - Date.now();
  if (ms <= 0) return "0m";
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h`;
  return `${Math.ceil(ms / 60000)}m`;
}

function normalizeWindow(w) {
  if (!w) return null;
  const usedPercent = Math.max(0, Math.min(100, Number(w.used_percent) || 0));
  return {
    usedPercent,
    remainingPct: Math.round(100 - usedPercent),
    windowMinutes: w.window_minutes || null,
    windowLabel: labelWindow(w.window_minutes),
    resetsAt: w.resets_at || null,
    resetLabel: humanizeUntil(w.resets_at),
  };
}

function findFreshestRateLimits(sessionsDir = SESSIONS_DIR) {
  const now = new Date();
  let best = null;
  let bestAt = "";
  let planType = null;
  let planTypeAt = "";
  // Scan up to 14 days. rate_limits (the quota windows) come from the freshest
  // day that has them; plan_type is tracked independently across the whole
  // range because proxy responses frequently null it out even when the quota
  // windows are present.
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    for (const f of listJsonl(dayDir(d, sessionsDir))) {
      const s = parseSessionFile(f);
      if (!s) continue;
      if (s.rateLimits && (s.rateLimitsAt || "") > bestAt) {
        best = s.rateLimits;
        bestAt = s.rateLimitsAt || "";
      }
      if (s.planType && (s.planTypeAt || "") > planTypeAt) {
        planType = s.planType;
        planTypeAt = s.planTypeAt || "";
      }
    }
    // stop once we have BOTH the quota windows and a plan type
    if (best && planType) break;
  }
  return { rl: best, at: bestAt, planType };
}

// ---- aggregation ----------------------------------------------------------

function aggregateToday(CONFIG, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const todayKey = localDayKey(now);
  // A Codex account switch rewrites auth.json's account_id. Drop the previous
  // account's cached plan immediately (the /quota poll runs every few seconds,
  // long before the 60s live poller would notice) and kick off a fresh fetch so
  // the new account's 套餐 and weekly quota replace the stale ones right away.
  if (!opts.files && !opts.sessionsDir) {
    if (invalidateCacheOnAccountSwitch(opts.codexHome || CODEX_HOME)) {
      Promise.resolve().then(() => refreshLiveNow()).catch(() => {});
    }
  }
  const files = opts.files || recentlyActiveSessionFiles(now, opts.sessionsDir || SESSIONS_DIR);
  const sessions = files
    .map(parseSessionFile)
    .filter((s) => {
      if (!s) return false;
      const bucket = s.dailyBuckets[todayKey];
      return Boolean(bucket || s.startedDayKey === todayKey);
    });

  let usedToday = 0;
  let callsToday = 0;
  let latest = null;

  for (const s of sessions) {
    const bucket = s.dailyBuckets[todayKey];
    if (bucket) {
      usedToday += bucket.used;
      callsToday += bucket.calls;
    }
    const t = (bucket && bucket.lastEventAt) || s.startedAt || "";
    if (!latest || (t && t > latest.at)) {
      latest = { session: s, bucket, at: t };
    }
  }

  // Context fill = tokens in the LAST turn of the active session (what actually
  // sits in the model's context window right now). NOT the cumulative session
  // total (finalTotalTokens), which grows unboundedly across turns and would
  // wrongly exceed the window.
  const latestSession = latest ? latest.session : null;
  const latestBucket = latest ? latest.bucket : null;
  const contextWindow = latestBucket ? latestBucket.contextWindow : 0;
  const contextUsed = latestBucket ? latestBucket.lastTurnTokens : 0;
  const budget = CONFIG.dailyBudgetTokens || 20000000;

  // real plan quota. PREFER the live /wham/usage snapshot (refreshes without
  // chatting); fall back to the freshest rate_limits found in session files.
  let plan = null;
  if (liveCache.plan) {
    // recompute reset labels off the current clock so they stay accurate
    const p = liveCache.plan;
    const refreshWin = (w) =>
      w ? { ...w, resetLabel: humanizeUntil(w.resetsAt) } : w;
    plan = {
      ...p,
      primary: refreshWin(p.primary),
      secondary: refreshWin(p.secondary),
      snapshotAt: new Date(liveCache.at).toISOString(),
      source: "live",
      stale: !liveCache.ok, // last fetch failed → data is a bit old
    };
  } else {
    const { rl, at, planType } = findFreshestRateLimits(opts.sessionsDir || SESSIONS_DIR);
    if (rl) {
      plan = {
        planType: (rl.plan_type || planType) || null,
        limitId: rl.limit_id || null,
        primary: normalizeWindow(rl.primary),
        secondary: normalizeWindow(rl.secondary),
        credits: rl.credits != null ? rl.credits : null,
        snapshotAt: at || null,
        source: "session",
        stale: false,
      };
    }
  }

  // Last resort for a brand-new install: no live snapshot and no session yet
  // carries rate_limits, so the 套餐 card would read "未知套餐". The signed-in
  // plan is available offline in auth.json's id_token, so surface at least the
  // plan type (quota windows stay empty until the first live/ session data).
  if (!plan || !plan.planType) {
    const accountPlan = readAccountPlanType(opts.codexHome || CODEX_HOME);
    if (accountPlan) {
      plan = plan
        ? { ...plan, planType: plan.planType || accountPlan }
        : {
            planType: accountPlan,
            limitId: null,
            primary: null,
            secondary: null,
            credits: null,
            snapshotAt: null,
            source: "account",
            stale: false,
          };
    }
  }

  // daily budget reset at local midnight
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msToReset = midnight - now;
  const hoursToReset = Math.max(0, Math.floor(msToReset / 3600000));

  return {
    ok: true,
    updatedAt: now.toISOString(),
    provider: latestSession ? latestSession.provider : null,
    model: latestSession ? latestSession.model : null,
    activeCwd: latestSession ? latestSession.cwd : null,
    plan,
    daily: {
      used: usedToday,
      limit: budget,
      remainingPct: Math.max(
        0,
        Math.min(100, Math.round(((budget - usedToday) / budget) * 100))
      ),
    },
    context: {
      used: contextUsed,
      limit: contextWindow,
      remainingPct: contextWindow
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(((contextWindow - contextUsed) / contextWindow) * 100)
            )
          )
        : 100,
    },
    callsToday,
    sessionsToday: sessions.length,
    resetInHours: hoursToReset,
    resetLabel:
      hoursToReset >= 1 ? `${hoursToReset}h` : `${Math.ceil(msToReset / 60000)}m`,
  };
}

// grand-total across all days is expensive; cache lazily.
let allTimeCache = { value: 0, at: 0 };
function aggregateAllTimeCached() {
  const nowMs = Date.now();
  if (nowMs - allTimeCache.at < 60000) return allTimeCache.value;
  let total = 0;
  try {
    for (const y of fs.readdirSync(SESSIONS_DIR)) {
      const yDir = path.join(SESSIONS_DIR, y);
      if (!fs.statSync(yDir).isDirectory()) continue;
      for (const m of fs.readdirSync(yDir)) {
        const mDir = path.join(yDir, m);
        for (const dd of fs.readdirSync(mDir)) {
          for (const f of listJsonl(path.join(mDir, dd))) {
            const s = parseSessionFile(f);
            if (s) total += s.finalTotalTokens;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  allTimeCache = { value: total, at: nowMs };
  return total;
}

// ---- HTTP server ----------------------------------------------------------

function startDataServer(opts = {}) {
  const CONFIG = loadConfig();
  const PORT = opts.port || CONFIG.port || 8787;

  const server = http.createServer((req, res) => {
    const url = (req.url || "").split("?")[0];
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }

    if (url === "/shutdown") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, bye: true }));
      if (opts.standalone) setTimeout(() => process.exit(0), 50);
      else server.close();
      return;
    }

    const panelCommand = /^\/panel\/(show|hide|toggle)$/.exec(url);
    if (panelCommand) {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
        res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
        return;
      }
      if (typeof opts.panelControl !== "function") {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "panel_control_unavailable" }));
        return;
      }
      try {
        const state = opts.panelControl(panelCommand[1]) || {};
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...state }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(error) }));
      }
      return;
    }

    if (url === "/quota") {
      try {
        const data = aggregateToday(CONFIG);
        data.allTimeTokens = aggregateAllTimeCached();
        data.config = { refreshMs: CONFIG.refreshMs };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
      return;
    }

    // On-demand live refresh (clicking the "● 实时" badge). Forces an immediate
    // wham/usage fetch, then returns the fresh /quota payload.
    if (url === "/refresh") {
      (async () => {
        try {
          if (typeof refreshLiveNow === "function") await refreshLiveNow();
        } catch {
          /* keep last good cache */
        }
        try {
          const data = aggregateToday(CONFIG);
          data.allTimeTokens = aggregateAllTimeCached();
          data.config = { refreshMs: CONFIG.refreshMs };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      })();
      return;
    }

    // static: serve the panel over http (same origin as /quota)
    const STATIC = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/index.html": ["index.html", "text/html; charset=utf-8"],
    };
    const backgroundAsset = /^\/assets\/backgrounds\/([a-z0-9-]+\.jpg)$/i.exec(url);
    if (backgroundAsset) {
      fs.readFile(path.join(APP_DIR, "assets", "backgrounds", backgroundAsset[1]), (err, buf) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("not found");
        } else {
          res.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Cache-Control": "no-cache",
          });
          res.end(buf);
        }
      });
      return;
    }
    if (STATIC[url]) {
      const [name, mime] = STATIC[url];
      fs.readFile(path.join(APP_DIR, name), (err, buf) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("not found");
        } else {
          res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
          res.end(buf);
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      // another instance already serves; that's fine
      if (opts.standalone) process.exit(0);
      if (opts.onError) opts.onError(e);
      return;
    }
    console.error("[quota-weather] server error:", e);
    if (opts.standalone) process.exit(1);
    if (opts.onError) opts.onError(e);
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[quota-weather] data service on http://127.0.0.1:${PORT}`);
    if (opts.onReady) opts.onReady(PORT);
  });

  // background live-quota poller: refreshes plan quota from the backend even
  // when Codex is idle. Interval from config (liveUsageMs), default 60s.
  if (!opts.disableLiveUsage && fetchLiveUsage) {
    const iv = CONFIG.liveUsageMs || 60000;
    const livePoller = startLivePoller(iv);
    server.on("close", () => clearInterval(livePoller));
  }

  return server;
}

module.exports = { startDataServer, aggregateToday, loadConfig };

// standalone runner
if (require.main === module) {
  startDataServer({ standalone: true });
}
