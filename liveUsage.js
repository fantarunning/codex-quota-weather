// Live usage fetcher — queries ChatGPT's real quota endpoint directly, so the
// weekly plan quota updates WITHOUT needing a Codex conversation turn.
//
// Endpoint (discovered from Codex logs):
//   GET https://chatgpt.com/backend-api/wham/usage
//   Authorization: Bearer <access_token from ~/.codex/auth.json>
//   returns { plan_type, rate_limit:{ primary_window:{used_percent,
//             limit_window_seconds, reset_after_seconds, reset_at }, ... },
//             credits:{...} }
//
// chatgpt.com requires the local proxy (v2rayN/xray) on this machine, and
// Node's built-in https does NOT honor HTTP(S)_PROXY. So we implement a manual
// CONNECT tunnel with pure built-ins (no dependencies): open an HTTP CONNECT to
// the proxy, then run TLS + the GET over the returned socket.

const http = require("http");
const https = require("https");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function readAuth() {
  try {
    const auth = JSON.parse(
      fs.readFileSync(path.join(CODEX_HOME, "auth.json"), "utf8")
    );
    const t = auth.tokens || {};
    return { token: t.access_token || null, accountId: t.account_id || null };
  } catch {
    return { token: null, accountId: null };
  }
}

// Decode a JWT payload without verifying the signature. We only read a
// self-reported claim for display, never for an authz decision, so an unsigned
// base64url decode is sufficient and dependency-free.
function decodeJwtPayload(jwt) {
  if (typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// The signed-in ChatGPT plan (plus/pro/team/free) is carried inside the
// id_token JWT that Codex stores in auth.json, so it is available offline the
// instant a user logs in — BEFORE any /wham/usage call or Codex session with
// rate_limits exists. server.js uses this as the last-resort plan source so a
// brand-new install shows the correct 套餐 instead of "未知套餐".
function readAccountPlanType(codexHome = CODEX_HOME) {
  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"));
  } catch {
    return null;
  }
  const tokens = auth.tokens || {};
  const claims = decodeJwtPayload(tokens.id_token) || {};
  const authClaims = claims["https://api.openai.com/auth"] || {};
  const raw =
    authClaims.chatgpt_plan_type ||
    claims.chatgpt_plan_type ||
    authClaims.plan_type ||
    null;
  if (!raw || typeof raw !== "string") return null;
  return raw.trim().toLowerCase() || null;
}

function readProxy() {
  // prefer explicit env, then .codex/.env
  const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (envProxy) {
    try {
      return new URL(envProxy);
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = fs.readFileSync(path.join(CODEX_HOME, ".env"), "utf8");
    const m =
      raw.match(/^\s*HTTPS_PROXY\s*=\s*(\S+)/im) ||
      raw.match(/^\s*HTTP_PROXY\s*=\s*(\S+)/im);
    if (m) return new URL(m[1].trim());
  } catch {
    /* none */
  }
  return null;
}

// decode a possibly chunked HTTP/1.1 body
function dechunk(body) {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const nl = body.indexOf("\r\n", i);
    if (nl === -1) break;
    const size = parseInt(body.slice(i, nl).trim(), 16);
    if (isNaN(size) || size === 0) break;
    out += body.slice(nl + 2, nl + 2 + size);
    i = nl + 2 + size + 2; // skip chunk + trailing CRLF
  }
  return out;
}

function fetchViaProxy(targetUrl, headers, proxy, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);

    // direct HTTPS (no proxy)
    if (!proxy) {
      const req = https.request(
        {
          hostname: u.hostname,
          port: 443,
          path: u.pathname + u.search,
          method: "GET",
          headers,
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode, body: b }));
        }
      );
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
      req.end();
      return;
    }

    // proxied: HTTP CONNECT tunnel, then TLS + manual GET
    const connectReq = http.request({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: "CONNECT",
      path: `${u.hostname}:443`,
      headers: { Host: `${u.hostname}:443` },
    });

    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };

    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        done(reject, new Error("proxy CONNECT status " + res.statusCode));
        socket.destroy();
        return;
      }
      const tlsSock = tls.connect(
        { socket, servername: u.hostname },
        () => {
          const lines = [
            `GET ${u.pathname + u.search} HTTP/1.1`,
            `Host: ${u.hostname}`,
            ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
            "Connection: close",
            "",
            "",
          ].join("\r\n");
          tlsSock.write(lines);
        }
      );
      let raw = "";
      tlsSock.setTimeout(timeoutMs, () => tlsSock.destroy(new Error("tls timeout")));
      tlsSock.on("data", (d) => (raw += d.toString("utf8")));
      tlsSock.on("end", () => {
        const idx = raw.indexOf("\r\n\r\n");
        if (idx === -1) return done(resolve, { status: 0, body: "" });
        const head = raw.slice(0, idx);
        let body = raw.slice(idx + 4);
        const sm = head.match(/HTTP\/1\.\d\s+(\d+)/);
        const status = sm ? parseInt(sm[1], 10) : 0;
        if (/transfer-encoding:\s*chunked/i.test(head)) body = dechunk(body);
        done(resolve, { status, body });
      });
      tlsSock.on("error", (e) => done(reject, e));
    });
    connectReq.on("error", (e) => done(reject, e));
    connectReq.setTimeout(timeoutMs, () =>
      connectReq.destroy(new Error("proxy timeout"))
    );
    connectReq.end();
  });
}

// Normalize the wham/usage response into the same shape server.js emits, so the
// panel doesn't care whether the data came from the live endpoint or the logs.
function normalizeLive(json) {
  const rl = json.rate_limit || {};
  const pw = rl.primary_window || null;
  const sw = rl.secondary_window || null;

  const windowFromSecs = (w) => {
    if (!w) return null;
    const usedPercent = Math.max(0, Math.min(100, Number(w.used_percent) || 0));
    const secs = w.limit_window_seconds || 0;
    const resetAt = w.reset_at || null;
    let windowLabel = "";
    if (secs >= 604800) windowLabel = "weekly";
    else if (secs >= 86400) windowLabel = "daily";
    else if (secs >= 18000) windowLabel = "5h";
    else if (secs > 0) windowLabel = Math.round(secs / 60) + "m";
    let resetLabel = "—";
    if (resetAt) {
      const ms = resetAt * 1000 - Date.now();
      if (ms > 0) {
        const h = Math.floor(ms / 3600000);
        const d = Math.floor(h / 24);
        resetLabel = d >= 1 ? `${d}d ${h % 24}h` : h >= 1 ? `${h}h` : `${Math.ceil(ms / 60000)}m`;
      } else resetLabel = "0m";
    }
    return {
      usedPercent: Math.round(usedPercent * 10) / 10,
      remainingPct: Math.round(100 - usedPercent),
      windowMinutes: secs ? Math.round(secs / 60) : null,
      windowLabel,
      resetsAt: resetAt,
      resetLabel,
    };
  };

  return {
    planType: json.plan_type || null,
    limitId: "codex",
    primary: windowFromSecs(pw),
    secondary: windowFromSecs(sw),
    credits: json.credits || null,
    snapshotAt: new Date().toISOString(),
    stale: false,
    source: "live",
  };
}

// Fetch live usage once. Resolves { ok, plan } or { ok:false, error }.
async function fetchLiveUsage(timeoutMs = 8000) {
  const { token, accountId } = readAuth();
  if (!token) return { ok: false, error: "no access_token in auth.json" };
  const proxy = readProxy();
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/json",
    "User-Agent": "quota-weather/2.0",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;

  try {
    const { status, body } = await fetchViaProxy(USAGE_URL, headers, proxy, timeoutMs);
    if (status !== 200) return { ok: false, error: "HTTP " + status };
    const json = JSON.parse(body);
    return { ok: true, plan: normalizeLive(json), raw: json };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { fetchLiveUsage, normalizeLive, readAccountPlanType };

// standalone probe
if (require.main === module) {
  fetchLiveUsage().then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
