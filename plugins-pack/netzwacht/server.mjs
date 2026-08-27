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
var cachedKey = null;
function deriveKey(material) {
  return scryptSync(material, "selfdashboard.calendar.v1", KEY_LEN);
}
function loadOrCreateKey() {
  if (cachedKey) return cachedKey;
  const envKey = (process.env.SELFDASHBOARD_SECRET_KEY ?? process.env.SELFDASHBOARD_CALENDAR_KEY)?.trim();
  if (envKey) {
    cachedKey = deriveKey(envKey);
    return cachedKey;
  }
  const keyFile = join2(dataDir(), ".calendar-key");
  if (existsSync(keyFile)) {
    cachedKey = deriveKey(readFileSync(keyFile, "utf8").trim());
    return cachedKey;
  }
  const fresh = randomBytes(32).toString("base64");
  writeFileSync(keyFile, fresh, "utf8");
  try {
    chmodSync(keyFile, 384);
  } catch {
  }
  cachedKey = deriveKey(fresh);
  return cachedKey;
}
var TAG_LEN = 16;
var SEALED_SECRET_PREFIX = "sdsec1:";
function isSealedSecret(value) {
  return typeof value === "string" && value.startsWith(SEALED_SECRET_PREFIX);
}
function openSealedSecret(value) {
  if (!isSealedSecret(value)) return value;
  try {
    const buf = Buffer.from(value.slice(SEALED_SECRET_PREFIX.length), "base64");
    if (buf.length < IV_LEN + TAG_LEN + 1) return "";
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, loadOrCreateKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

// plugins-pack/_shared/insecure-fetch.ts
import https from "node:https";
import nodeFetch from "node-fetch";

// plugins-pack/_shared/ssrf.ts
import net from "node:net";
import { lookup } from "node:dns/promises";
var BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
  "instance-data"
]);
function isAlwaysBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
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
  if (net.isIPv4(rest)) return rest;
  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8 & 255}.${hi & 255}.${lo >> 8 & 255}.${lo & 255}`;
}
function isPrivateLanIp(ip) {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
function blockPrivateLanUrls() {
  const v = process.env.SELFDASHBOARD_BLOCK_PRIVATE_CALENDAR_URLS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
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
  const ipVersion = net.isIP(host);
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
  if (net.isIP(host)) return;
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
  await assertSafeOutboundUrlResolved(url);
  const isHttps = url.toLowerCase().startsWith("https:");
  const agent = isHttps && opts.insecureTls === true ? new https.Agent({ rejectUnauthorized: false }) : void 0;
  const res = await nodeFetch(url, {
    redirect: "manual",
    ...init,
    ...agent ? { agent } : {}
  });
  return res;
}
async function fetchCheckedJson(url, init = {}, opts = {}) {
  const res = await fetchChecked(url, init, opts);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text, res };
}

// plugins-pack/_shared/plugin-server-cache.ts
function createPluginServerCache(options) {
  const maxEntries = Math.max(1, options.maxEntries ?? 32);
  const ttlMs = Math.max(0, options.ttlMs);
  const cache2 = /* @__PURE__ */ new Map();
  function evictIfNeeded() {
    while (cache2.size >= maxEntries) {
      const first = cache2.keys().next().value;
      if (!first) break;
      cache2.delete(first);
    }
  }
  return {
    get(key) {
      const entry = cache2.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expires) {
        cache2.delete(key);
        return null;
      }
      return entry.data;
    },
    set(key, data) {
      if (ttlMs <= 0) return;
      evictIfNeeded();
      cache2.set(key, { expires: Date.now() + ttlMs, data });
    },
    delete(key) {
      cache2.delete(key);
    },
    clear() {
      cache2.clear();
    }
  };
}

// plugins-pack/netzwacht/server.ts
var dynamic = "force-dynamic";
var FETCH_TIMEOUT_MS = 1e4;
var cache = createPluginServerCache({ ttlMs: 5e3, maxEntries: 8 });
function num(v) {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function normalizeBase(raw) {
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) throw new Error("missing_url");
  const withProto = /^https?:\/\//i.test(t) ? t : `http://${t}`;
  const u = new URL(withProto);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("invalid_url");
  u.username = "";
  u.password = "";
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}
function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
async function fetchNtopng(base, auth, ifid, signal) {
  const init = { headers: { Accept: "application/json", Authorization: auth }, signal };
  const [ifaceRes, hostsRes] = await Promise.all([
    fetchCheckedJson(`${base}/lua/rest/v2/get/interface/data.lua?ifid=${ifid}`, init),
    fetchCheckedJson(
      `${base}/lua/rest/v2/get/host/active.lua?ifid=${ifid}&perPage=5&sortColumn=column_traffic&sortOrder=desc&mode=local`,
      init
    )
  ]);
  if (ifaceRes.status === 401 || ifaceRes.status === 403 || ifaceRes.status >= 300 && ifaceRes.status < 400) {
    void logPluginApiFailure("netzwacht", "ntopng-auth", `status_${ifaceRes.status}`);
    return { ok: false, error: "auth_failed" };
  }
  if (!ifaceRes.ok || !isObject(ifaceRes.json)) {
    void logPluginApiFailure("netzwacht", "ntopng", `http_${ifaceRes.status}`);
    return { ok: false, error: "upstream_error" };
  }
  const iface = isObject(ifaceRes.json.rsp) ? ifaceRes.json.rsp : {};
  const topHosts = [];
  if (hostsRes.ok && isObject(hostsRes.json) && isObject(hostsRes.json.rsp)) {
    const data = hostsRes.json.rsp.data;
    if (Array.isArray(data)) {
      for (const h of data) {
        if (!isObject(h)) continue;
        const thpt = isObject(h.thpt) ? h.thpt : {};
        const bytes = isObject(h.bytes) ? h.bytes : {};
        topHosts.push({
          ip: str(h.ip),
          name: str(h.name),
          mac: str(h.mac),
          bps: num(thpt.bps),
          totalBytes: num(bytes.total),
          score: num(h.score)
        });
      }
    }
  }
  return {
    ok: true,
    throughputBps: num(iface.throughput_bps),
    numLocalHosts: num(iface.num_local_hosts),
    numHosts: num(iface.num_hosts),
    alertedFlows: num(iface.alerted_flows),
    engagedAlerts: num(iface.engaged_alerts),
    topHosts
  };
}
async function fetchSuricata(alertsUrl, token, maxAlerts, signal) {
  const base = normalizeBase(alertsUrl);
  const res = await fetchCheckedJson(`${base}/alerts?limit=${Math.max(50, maxAlerts)}`, {
    headers: { Accept: "application/json", "X-Api-Token": token },
    signal
  });
  if (res.status === 401) {
    void logPluginApiFailure("netzwacht", "alert-api-auth", "token_rejected");
    return { ok: false, configured: true, error: "alerts_auth_failed" };
  }
  if (!res.ok || !isObject(res.json)) {
    void logPluginApiFailure("netzwacht", "alert-api", `http_${res.status}`);
    return { ok: false, configured: true, error: "alerts_upstream_error" };
  }
  const summary = isObject(res.json.summary) ? res.json.summary : {};
  const h24raw = isObject(summary.h24) ? summary.h24 : {};
  const alerts = [];
  if (Array.isArray(res.json.alerts)) {
    for (const a of res.json.alerts) {
      if (!isObject(a)) continue;
      alerts.push({
        ts: str(a.ts),
        sig: str(a.sig),
        cat: str(a.cat),
        sev: num(a.sev) || 3,
        src: str(a.src),
        spt: a.spt == null ? null : num(a.spt),
        dst: str(a.dst),
        dpt: a.dpt == null ? null : num(a.dpt),
        proto: str(a.proto)
      });
    }
  }
  return {
    ok: true,
    configured: true,
    h24: {
      high: num(h24raw.high),
      medium: num(h24raw.medium),
      low: num(h24raw.low),
      total: num(h24raw.total)
    },
    latest: typeof summary.latest === "string" ? summary.latest : null,
    alerts
  };
}
async function handlePost(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  let ntopngBase;
  try {
    ntopngBase = normalizeBase(String(body.ntopngUrl ?? ""));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "invalid_url" }, { status: 400 });
  }
  const username = String(body.username ?? "").trim();
  const password = openSealedSecret(String(body.password ?? "").trim());
  if (!username || !password) {
    return Response.json({ error: "missing_credentials" }, { status: 400 });
  }
  const ifid = Math.max(0, num(body.ifid));
  const alertsUrl = String(body.alertsUrl ?? "").trim();
  const alertsToken = openSealedSecret(String(body.alertsToken ?? "").trim());
  const maxAlerts = Math.min(25, Math.max(1, num(body.maxAlerts) || 6));
  const cacheKey = `${ntopngBase}|${ifid}|${alertsUrl}|${maxAlerts}|${username}`;
  const cached = cache.get(cacheKey);
  if (cached) return Response.json(cached);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const auth = basicAuth(username, password);
    const [ntopngResult, suricataResult] = await Promise.allSettled([
      fetchNtopng(ntopngBase, auth, ifid, ac.signal),
      alertsUrl && alertsToken ? fetchSuricata(alertsUrl, alertsToken, maxAlerts, ac.signal) : Promise.resolve({ ok: false, configured: false })
    ]);
    const payload = {
      ntopng: ntopngResult.status === "fulfilled" ? ntopngResult.value : { ok: false, error: settleError(ntopngResult.reason) },
      suricata: suricataResult.status === "fulfilled" ? suricataResult.value : { ok: false, configured: true, error: settleError(suricataResult.reason) }
    };
    if (payload.ntopng.ok || payload.suricata.ok) cache.set(cacheKey, payload);
    return Response.json(payload);
  } finally {
    clearTimeout(t);
  }
}
function settleError(e) {
  if (e instanceof UnsafeOutboundUrlError) return "blocked_url";
  if (e instanceof Error && e.name === "AbortError") return "timeout";
  void logPluginApiFailure("netzwacht", "request", e instanceof Error ? e.message : String(e));
  return "network_error";
}
async function handleNetzwachtPluginRequest(req, _path) {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  return handlePost(req);
}
function netzwachtServerHandler(ctx) {
  return handleNetzwachtPluginRequest(ctx.request, ctx.path);
}
export {
  netzwachtServerHandler as default,
  dynamic
};
