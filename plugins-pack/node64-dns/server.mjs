// plugins-pack/_shared/insecure-fetch.ts
import https from "node:https";
import nodeFetch from "node-fetch";

// plugins-pack/_shared/ssrf.ts
import net2 from "node:net";
import { lookup } from "node:dns/promises";

// plugins-pack/_shared/upstream-health.ts
import net from "node:net";
var DOWN_CODES = /* @__PURE__ */ new Set(["EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);
var PROBE_MS = 15e3;
var PROBE_TIMEOUT_MS = 4e3;
var STORE_KEY = "__sdUpstreamHealth";
function store() {
  const g = globalThis;
  let s = g[STORE_KEY];
  if (!s) {
    s = /* @__PURE__ */ new Map();
    g[STORE_KEY] = s;
  }
  return s;
}
function enabled() {
  return process.env.SELFDASHBOARD_HOST_DOWN_MS !== "0";
}
function target(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    if (!host) return null;
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { host, port };
  } catch {
    return null;
  }
}
function errorCode(e) {
  let cur = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = cur.code;
    if (typeof code === "string" && code) return code;
    cur = cur.cause;
  }
  return null;
}
function markUp(host) {
  if (store().delete(host)) {
    console.info(`[SelfDashboard][upstream] ${host} wieder erreichbar`);
  }
}
function startProbe(host, port, state) {
  state.probing = true;
  state.lastProbe = Date.now();
  let settled = false;
  const finish = (up) => {
    if (settled) return;
    settled = true;
    state.probing = false;
    socket.destroy();
    if (up) markUp(host);
  };
  const socket = net.connect({ host, port });
  socket.setTimeout(PROBE_TIMEOUT_MS);
  socket.once("connect", () => finish(true));
  socket.once("timeout", () => finish(false));
  socket.once("error", (err) => {
    const code = errorCode(err);
    finish(!code || !DOWN_CODES.has(code));
  });
}
var UpstreamHostDownError = class extends Error {
  constructor(host, code) {
    super(`host_down:${host} (${code}, cached)`);
    this.name = "UpstreamHostDownError";
    this.code = code;
  }
};
function assertUpstreamHostUp(url) {
  const t = target(url);
  if (!t) return;
  const state = store().get(t.host);
  if (!state) return;
  if (!state.probing && Date.now() - state.lastProbe >= PROBE_MS) {
    startProbe(t.host, t.port, state);
  }
  throw new UpstreamHostDownError(t.host, state.code);
}
function noteUpstreamError(url, err) {
  if (!enabled()) return;
  const code = errorCode(err);
  if (!code || !DOWN_CODES.has(code)) return;
  const t = target(url);
  if (!t) return;
  const hosts = store();
  const existing = hosts.get(t.host);
  if (existing) {
    existing.code = code;
    return;
  }
  console.warn(
    `[SelfDashboard][upstream] ${t.host} nicht erreichbar (${code}) \u2014 Anfragen werden sofort abgelehnt, Hintergrund-Probe alle ${PROBE_MS / 1e3}s`
  );
  hosts.set(t.host, { code, lastProbe: Date.now(), probing: false });
}
function noteUpstreamOk(url) {
  const t = target(url);
  if (t) markUp(t.host);
}

// plugins-pack/_shared/ssrf.ts
var BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
  "instance-data"
]);
function isAlwaysBlockedIp(ip) {
  if (net2.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (net2.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true;
    if (normalized.startsWith("fe80:")) return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    const embedded = embeddedIpv4(normalized);
    if (embedded) return isAlwaysBlockedIp(embedded);
  }
  return false;
}
function embeddedIpv4(normalizedV6) {
  if (!normalizedV6.startsWith("::ffff:")) return null;
  const rest = normalizedV6.slice("::ffff:".length);
  if (net2.isIPv4(rest)) return rest;
  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8 & 255}.${hi & 255}.${lo >> 8 & 255}.${lo & 255}`;
}
function isPrivateLanIp(ip) {
  if (!net2.isIPv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
function isTruthyEnv(v) {
  const s = v?.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
function blockPrivateLanUrls() {
  if (isTruthyEnv(process.env.SELFDASHBOARD_ALLOW_PRIVATE_URLS)) return false;
  return true;
}
var UnsafeOutboundUrlError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeOutboundUrlError";
  }
};
function assertSafeOutboundUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new UnsafeOutboundUrlError("invalid_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeOutboundUrlError("unsupported_protocol");
  }
  const host = u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!host) throw new UnsafeOutboundUrlError("missing_host");
  if (BLOCKED_HOSTNAMES.has(host)) throw new UnsafeOutboundUrlError("blocked_host");
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeOutboundUrlError("blocked_host");
  }
  const ipVersion = net2.isIP(host);
  if (ipVersion) {
    if (isAlwaysBlockedIp(host)) throw new UnsafeOutboundUrlError("blocked_ip");
    if (blockPrivateLanUrls() && isPrivateLanIp(host)) {
      throw new UnsafeOutboundUrlError("private_ip_blocked");
    }
    return;
  }
  if (host.endsWith(".localhost")) throw new UnsafeOutboundUrlError("blocked_host");
}
async function assertSafeOutboundUrlResolved(urlStr) {
  assertSafeOutboundUrl(urlStr);
  const u = new URL(urlStr);
  const host = u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (net2.isIP(host)) return;
  let addrs;
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeOutboundUrlError("dns_lookup_failed");
  }
  if (addrs.length === 0) throw new UnsafeOutboundUrlError("dns_lookup_failed");
  for (const { address } of addrs) {
    if (isAlwaysBlockedIp(address)) throw new UnsafeOutboundUrlError("blocked_ip_resolved");
    if (blockPrivateLanUrls() && isPrivateLanIp(address)) {
      throw new UnsafeOutboundUrlError("private_ip_blocked");
    }
  }
}

// plugins-pack/_shared/insecure-fetch.ts
async function fetchChecked(url, init = {}, opts = {}) {
  assertUpstreamHostUp(url);
  await assertSafeOutboundUrlResolved(url);
  const isHttps = url.toLowerCase().startsWith("https:");
  const agent = isHttps && opts.insecureTls === true ? new https.Agent({ rejectUnauthorized: false }) : void 0;
  let res;
  try {
    res = await nodeFetch(url, {
      redirect: "manual",
      ...init,
      ...agent ? { agent } : {}
    });
  } catch (e) {
    noteUpstreamError(url, e);
    throw e;
  }
  noteUpstreamOk(url);
  return res;
}

// plugins-pack/_shared/log.ts
async function logPluginApiFailure(pluginId, operation, message, detail) {
  const extra = detail ? ` ${JSON.stringify(detail).slice(0, 500)}` : "";
  console.error(`[SelfDashboard][${pluginId}] ${operation}: ${message}${extra}`);
}

// plugins-pack/_shared/secret-crypto.ts
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join as join2 } from "node:path";

// plugins-pack/_shared/data-dir.ts
import { join } from "path";
function dataDir() {
  const raw = process.env.SELFDASHBOARD_DATA_DIR?.trim();
  if (raw) return raw;
  return join(process.cwd(), "data");
}

// plugins-pack/_shared/secret-crypto.ts
var ALGO = "aes-256-gcm";
var IV_LEN = 12;
var KEY_LEN = 32;
var LEGACY_SALT = "selfdashboard.calendar.v1";
var cachedPrimaryKey = null;
var cachedLegacyKey = null;
function keyMaterial() {
  const envKey = (process.env.SELFDASHBOARD_SECRET_KEY ?? process.env.SELFDASHBOARD_CALENDAR_KEY)?.trim();
  if (envKey) return envKey;
  const keyFile = join2(dataDir(), ".calendar-key");
  if (existsSync(keyFile)) return readFileSync(keyFile, "utf8").trim();
  const fresh = randomBytes(32).toString("base64");
  try {
    writeFileSync(keyFile, fresh, { flag: "wx" });
    try {
      chmodSync(keyFile, 384);
    } catch {
    }
    return fresh;
  } catch {
    if (existsSync(keyFile)) return readFileSync(keyFile, "utf8").trim();
    return fresh;
  }
}
function installSalt() {
  const saltFile = join2(dataDir(), ".secret-salt");
  try {
    if (existsSync(saltFile)) {
      const v = readFileSync(saltFile, "utf8").trim();
      if (v) return v;
    }
    const fresh = randomBytes(16).toString("hex");
    try {
      writeFileSync(saltFile, fresh, { flag: "wx" });
      try {
        chmodSync(saltFile, 384);
      } catch {
      }
      return fresh;
    } catch {
      const v = existsSync(saltFile) ? readFileSync(saltFile, "utf8").trim() : "";
      return v || LEGACY_SALT;
    }
  } catch {
    return LEGACY_SALT;
  }
}
function primaryKey() {
  if (!cachedPrimaryKey) cachedPrimaryKey = scryptSync(keyMaterial(), installSalt(), KEY_LEN);
  return cachedPrimaryKey;
}
function legacyKey() {
  if (!cachedLegacyKey) cachedLegacyKey = scryptSync(keyMaterial(), LEGACY_SALT, KEY_LEN);
  return cachedLegacyKey;
}
function decryptGcm(key, iv, enc, tag) {
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
var TAG_LEN = 16;
var SEALED_SECRET_PREFIX = "sdsec1:";
function isSealedSecret(value) {
  return typeof value === "string" && value.startsWith(SEALED_SECRET_PREFIX);
}
function openSealedSecret(value) {
  if (!isSealedSecret(value)) return value;
  const buf = Buffer.from(value.slice(SEALED_SECRET_PREFIX.length), "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) return "";
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  try {
    return decryptGcm(primaryKey(), iv, enc, tag);
  } catch {
    try {
      return decryptGcm(legacyKey(), iv, enc, tag);
    } catch {
      return "";
    }
  }
}

// plugins-pack/_shared/node64.ts
var NODE64_TIMEOUT_MS = 1e4;
var Node64Error = class extends Error {
  constructor(code, status, detail) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
};
function n64Num(v) {
  const x = typeof v === "number" ? v : Number(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
}
function n64Str(v, max = 200) {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.length > max ? s.slice(0, max) : s;
}
function n64Obj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}
function n64Arr(v) {
  return Array.isArray(v) ? v : [];
}
function normalizeNode64Base(raw) {
  let t = raw.trim().replace(/\/+$/, "");
  if (!t) throw new Node64Error("missing_url", 400);
  if (!/^https?:\/\//i.test(t)) t = `http://${t}`;
  let u;
  try {
    u = new URL(t);
  } catch {
    throw new Node64Error("invalid_url", 400);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Node64Error("invalid_url", 400);
  if (!u.port && !/\.[a-z]{2,}$/i.test(u.hostname)) u.port = "8080";
  return `${u.protocol}//${u.host}`;
}
async function readNode64Request(req) {
  if (req.method !== "POST") throw new Node64Error("method_not_allowed", 405);
  let body;
  try {
    body = await req.json();
  } catch {
    throw new Node64Error("invalid_json", 400);
  }
  const base = normalizeNode64Base(n64Str(body.url, 300));
  const key = openSealedSecret(n64Str(body.apiKey, 300).trim());
  if (!key) throw new Node64Error("missing_key", 400);
  if (!/^node64_[A-Za-z0-9_-]{8,}$/.test(key)) throw new Node64Error("invalid_key", 400);
  return { conn: { base, key }, body };
}
async function call(conn, method, path, signal, body) {
  const headers = {
    Authorization: `Bearer ${conn.key}`,
    Accept: "application/json",
    "X-Agent-Actor": "selfdashboard"
  };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetchChecked(
    `${conn.base}/api${path}`,
    { method, headers, signal, redirect: "error", body: body ? JSON.stringify(body) : void 0 },
    { insecureTls: conn.base.startsWith("https:") }
  );
  if (res.status === 401) throw new Node64Error("unauthorized", 401);
  if (res.status === 403) throw new Node64Error("forbidden", 403);
  if (res.status === 404) throw new Node64Error("module_off", 404, path);
  if (res.status === 429) throw new Node64Error("rate_limited", 429);
  if (!res.ok) throw new Node64Error("upstream_error", 502, `HTTP ${res.status}`);
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Node64Error("invalid_response", 502);
  }
}
function n64Get(conn, path, signal) {
  return call(conn, "GET", path, signal);
}
function n64Post(conn, path, signal, body) {
  return call(conn, "POST", path, signal, body);
}
async function n64Try(p, fallback) {
  try {
    return await p;
  } catch (e) {
    if (e instanceof Node64Error && (e.code === "unauthorized" || e.code === "forbidden")) throw e;
    return fallback;
  }
}
async function handleNode64(pluginId, req, work2) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), NODE64_TIMEOUT_MS);
  try {
    const { conn, body } = await readNode64Request(req);
    const data = await work2(conn, body, ac.signal);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof Node64Error) {
      if (e.status >= 500) void logPluginApiFailure(pluginId, "request", e.code, { detail: e.detail });
      return Response.json({ error: e.code, detail: e.detail }, { status: e.status });
    }
    if (e instanceof UnsafeOutboundUrlError) {
      return Response.json({ error: "blocked_url", detail: e.message }, { status: 400 });
    }
    if (e instanceof Error && e.name === "AbortError") {
      void logPluginApiFailure(pluginId, "request", "timeout");
      return Response.json({ error: "timeout" }, { status: 504 });
    }
    void logPluginApiFailure(pluginId, "request", "network_error", {
      message: e instanceof Error ? e.message : String(e)
    });
    return Response.json({ error: "network_error" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

// plugins-pack/node64-dns/server.ts
var dynamic = "force-dynamic";
var RANGES = ["1h", "24h", "7d"];
function sumTimeline(tl) {
  return tl.reduce((a, b) => ({ total: a.total + b.total, blocked: a.blocked + b.blocked }), { total: 0, blocked: 0 });
}
async function action(conn, body, signal) {
  const admin = openSealedSecret(n64Str(body.adminKey, 300).trim());
  if (!admin) throw new Node64Error("forbidden", 403);
  if (!/^node64_[A-Za-z0-9_-]{8,}$/.test(admin)) throw new Node64Error("invalid_key", 400);
  const adminConn = { base: conn.base, key: admin };
  if (body.action === "pause") await n64Post(adminConn, "/dns64/pause", signal, { minutes: 10 });
  else if (body.action === "resume") await n64Post(adminConn, "/dns64/resume", signal, {});
  else throw new Node64Error("invalid_action", 400);
  return { ok: true };
}
async function work(conn, body, signal) {
  if (body.action) return action(conn, body, signal);
  const range = RANGES.includes(String(body.range)) ? String(body.range) : "24h";
  const [summary, status, timeline, topB, topC] = await Promise.all([
    n64Get(conn, "/dns64/summary", signal),
    n64Try(n64Get(conn, "/dns64/status", signal), {}),
    n64Try(n64Get(conn, `/dns64/timeline?range=${range}`, signal), {}),
    n64Try(n64Get(conn, `/dns64/top/list?kind=blocked&range=${range}&limit=8`, signal), {}),
    n64Try(n64Get(conn, `/dns64/top/list?kind=clients&range=${range}&limit=6`, signal), {})
  ]);
  const sum = n64Obj(n64Obj(summary).summary);
  const block = n64Obj(n64Obj(status).blocking);
  const tl = n64Arr(n64Obj(timeline).buckets).map(n64Obj).map((b) => ({ t: n64Num(b.t), total: n64Num(b.total), blocked: n64Num(b.blocked) }));
  const totals = range === "24h" ? { total: n64Num(sum.total), blocked: n64Num(sum.blocked) } : sumTimeline(tl);
  return {
    total: totals.total,
    blocked: totals.blocked,
    clients: n64Num(sum.clients),
    avgMs: Math.round(n64Num(sum.avgUpstreamMs) * 10) / 10,
    listSize: n64Num(n64Obj(summary).blocklistSize),
    paused: block.paused === true,
    pausedUntil: block.until_resumed === true ? "" : n64Str(block.paused_until, 40),
    timeline: tl,
    topBlocked: n64Arr(n64Obj(topB).items).map(n64Obj).map((i) => ({ name: n64Str(i.name, 120), count: n64Num(i.count) })),
    topClients: n64Arr(n64Obj(topC).items).map(n64Obj).map((i) => ({
      name: n64Str(i.name, 60),
      host: n64Str(i.hostname, 80).replace(/\.fritz\.box$/i, ""),
      count: n64Num(i.count),
      blocked: n64Num(i.blocked)
    }))
  };
}
function node64DnsServer(ctx) {
  return handleNode64("node64-dns", ctx.request, work);
}
export {
  node64DnsServer as default,
  dynamic
};
