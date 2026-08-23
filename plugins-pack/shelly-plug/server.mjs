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

// plugins-pack/_shared/shelly.ts
import crypto from "node:crypto";
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, renameSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, join as join3 } from "node:path";

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
async function fetchWithSsrfGuard(urlStr, init, maxRedirects = 5) {
  await assertSafeOutboundUrlResolved(urlStr);
  let current = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const resp = await fetch(current, { ...init, redirect: "manual" });
    if (resp.status < 300 || resp.status >= 400) return resp;
    const location = resp.headers.get("location");
    if (!location) return resp;
    current = new URL(location, current).href;
    await assertSafeOutboundUrlResolved(current);
  }
  throw new UnsafeOutboundUrlError("too_many_redirects");
}

// plugins-pack/_shared/shelly.ts
var ShellyAuthError = class extends Error {
  constructor() {
    super("auth_failed");
    this.name = "ShellyAuthError";
  }
};
var SHELLY_TIMEOUT_MS = 8e3;
var MAX_PASSWORD_LEN = 2e3;
function str(v) {
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}
function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function mapShellyError(e) {
  if (e instanceof ShellyAuthError) return "auth_failed";
  if (e instanceof UnsafeOutboundUrlError) return "blocked_url";
  if (e instanceof Error && e.name === "AbortError") return "timeout";
  return "unreachable";
}
function toDevice(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw;
  const ip = str(o.ip);
  if (!ip) return null;
  const dev = { id: str(o.id) || ip, name: str(o.name), ip };
  const password = typeof o.password === "string" ? o.password.slice(0, MAX_PASSWORD_LEN) : "";
  if (password) dev.password = password;
  return dev;
}
function parseDevices(raw, maxDevices) {
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, maxDevices).map(toDevice).filter((d) => d !== null);
}
function parseOneDevice(raw) {
  return toDevice(raw);
}
function normalizeShellyBase(raw) {
  const s = (raw ?? "").trim();
  if (!s) throw new Error("missing_ip");
  const withProto = /^https?:\/\//i.test(s) ? s : `http://${s}`;
  const u = new URL(withProto);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("invalid_ip");
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}
function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}
function safeParam(v) {
  if (v == null) return null;
  return /["\r\n]/.test(v) ? null : v;
}
function parseAuthParams(header) {
  const out = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let m;
  while (m = re.exec(header)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  }
  return out;
}
function buildDigestHeader(wwwAuth, method, uri, password) {
  const p = parseAuthParams(wwwAuth);
  const realm = safeParam(p.realm);
  const nonce = safeParam(p.nonce);
  if (!realm || !nonce) return null;
  const algo = (p.algorithm ?? "").toUpperCase();
  if (algo && algo !== "SHA-256") return null;
  if (p.qop && !p.qop.split(",").map((q) => q.trim()).includes("auth")) return null;
  const username = "admin";
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const qop = "auth";
  const ha1 = sha256Hex(`${username}:${realm}:${password}`);
  const ha2 = sha256Hex(`${method}:${uri}`);
  const response = sha256Hex(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    "algorithm=SHA-256",
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`
  ];
  const opaque = safeParam(p.opaque);
  if (opaque) parts.push(`opaque="${opaque}"`);
  return `Digest ${parts.join(", ")}`;
}
async function shellyRpc(base, rpcPath, password, signal) {
  const uri = `/rpc/${rpcPath}`;
  const url = `${base}${uri}`;
  await assertSafeOutboundUrlResolved(url);
  let res = await fetchWithSsrfGuard(url, { method: "GET", cache: "no-store", signal });
  if (res.status === 401 && password) {
    const auth = buildDigestHeader(res.headers.get("www-authenticate") ?? "", "GET", uri, password);
    if (auth) {
      await assertSafeOutboundUrlResolved(url);
      res = await fetchWithSsrfGuard(url, {
        method: "GET",
        headers: { Authorization: auth },
        cache: "no-store",
        signal
      });
    }
  }
  if (res.status === 401) throw new ShellyAuthError();
  if (!res.ok) throw new Error(`http_${res.status}`);
  return await res.json();
}
var MAX_AGE_MS = 40 * 24 * 60 * 60 * 1e3;
var HISTORY_RETENTION_MS = MAX_AGE_MS;
var MIN_GAP_MS = 60 * 1e3;
var FINE_WINDOW_MS = 2 * 24 * 60 * 60 * 1e3;
var HOUR_MS = 60 * 60 * 1e3;
var DAY_MS = 24 * 60 * 60 * 1e3;
function startOfToday() {
  const d = /* @__PURE__ */ new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonth() {
  const d = /* @__PURE__ */ new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function historyPath(pluginId) {
  return join3(dataDir(), "plugins", pluginId, "energy.json");
}
function readHistory(pluginId) {
  const file = historyPath(pluginId);
  if (!existsSync2(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync2(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    void logPluginApiFailure(pluginId, "history", "corrupt_history_file");
    return {};
  }
}
function writeHistory(pluginId, data) {
  const file = historyPath(pluginId);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync2(tmp, JSON.stringify(data), "utf8");
  renameSync(tmp, file);
}
function compact(arr, now) {
  const cutoff = now - MAX_AGE_MS;
  const fineFrom = now - FINE_WINDOW_MS;
  const kept = [];
  const seenHour = /* @__PURE__ */ new Set();
  for (const s of arr) {
    if (s.t < cutoff) continue;
    if (s.t >= fineFrom) {
      kept.push(s);
      continue;
    }
    const bucket = Math.floor(s.t / HOUR_MS);
    if (!seenHour.has(bucket)) {
      seenHour.add(bucket);
      kept.push(s);
    }
  }
  return kept;
}
function recordEnergy(pluginId, samples) {
  const now = Date.now();
  const data = readHistory(pluginId);
  for (const [key, counters] of Object.entries(samples)) {
    const clean = {};
    for (const [name, wh] of Object.entries(counters)) {
      if (typeof wh === "number" && Number.isFinite(wh)) clean[name] = wh;
    }
    if (Object.keys(clean).length === 0) continue;
    const arr = data[key] ?? [];
    const last = arr[arr.length - 1];
    if (!last || now - last.t >= MIN_GAP_MS) arr.push({ t: now, c: clean });
    data[key] = arr;
  }
  for (const key of Object.keys(data)) {
    const compacted = compact(data[key], now);
    if (compacted.length === 0) delete data[key];
    else data[key] = compacted;
  }
  writeHistory(pluginId, data);
}
function sumWindow(snaps, counter, sinceMs) {
  let prev = null;
  let wh = 0;
  for (const snap of snaps) {
    const v = snap.c[counter];
    if (typeof v !== "number") continue;
    if (snap.t < sinceMs) {
      prev = v;
      continue;
    }
    if (prev != null && v >= prev) wh += v - prev;
    prev = v;
  }
  return wh / 1e3;
}
function windowsKwh(pluginId, deviceKey, counter, since) {
  const snaps = readHistory(pluginId)[deviceKey] ?? [];
  const out = {};
  for (const name of Object.keys(since)) {
    out[name] = sumWindow(snaps, counter, since[name]);
  }
  return out;
}
function bucketStart(ms, unit) {
  const d = new Date(ms);
  if (unit === "day") d.setHours(0, 0, 0, 0);
  else d.setMinutes(0, 0, 0);
  return d.getTime();
}
function nextBucket(ms, unit) {
  const d = new Date(ms);
  if (unit === "day") {
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
  } else {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return d.getTime();
}
function countBuckets(fromMs, toMs, unit) {
  let n = 0;
  for (let t = bucketStart(fromMs, unit); t < toMs && n <= 1e5; t = nextBucket(t, unit)) n++;
  return n;
}
function bucketsKwh(pluginId, deviceKey, counter, fromMs, toMs, unit) {
  const out = [];
  const slot = /* @__PURE__ */ new Map();
  for (let t = bucketStart(fromMs, unit); t < toMs; t = nextBucket(t, unit)) {
    slot.set(t, out.length);
    out.push({ t, kwh: 0 });
  }
  if (out.length === 0) return out;
  const snaps = readHistory(pluginId)[deviceKey] ?? [];
  const wh = new Array(out.length).fill(0);
  let prev = null;
  for (const snap of snaps) {
    const v = snap.c[counter];
    if (typeof v !== "number") continue;
    if (snap.t < fromMs) {
      prev = v;
      continue;
    }
    if (snap.t >= toMs) break;
    if (prev != null && v >= prev) {
      const i = slot.get(bucketStart(snap.t, unit));
      if (i != null) wh[i] += v - prev;
    }
    prev = v;
  }
  for (let i = 0; i < out.length; i++) out[i].kwh = wh[i] / 1e3;
  return out;
}

// plugins-pack/shelly-plug/server.ts
var dynamic = "force-dynamic";
var PLUGIN_ID = "shelly-plug";
var MAX_DEVICES = 16;
var MAX_BUCKETS = 1200;
function devicePassword(dev, fallback) {
  return dev.password ? openSealedSecret(dev.password) : fallback;
}
async function readDevice(dev, password, signal) {
  const base = normalizeShellyBase(dev.ip);
  const st = await shellyRpc(base, "Switch.GetStatus?id=0", password, signal);
  const aenergy = st.aenergy ?? {};
  const temperature = st.temperature ?? {};
  const result = {
    id: dev.id,
    name: dev.name,
    online: true,
    output: typeof st.output === "boolean" ? st.output : null,
    power: num(st.apower),
    voltage: num(st.voltage),
    current: num(st.current),
    tempC: num(temperature.tC)
  };
  return { result, energyWh: num(aenergy.total) };
}
async function handleStatus(devices, password, track, signal) {
  const settled = await Promise.all(
    devices.map(async (dev) => {
      try {
        return await readDevice(dev, devicePassword(dev, password), signal);
      } catch (e) {
        const code = mapShellyError(e);
        if (code !== "timeout") void logPluginApiFailure(PLUGIN_ID, "status", `${code}:${dev.id}`);
        const result = {
          id: dev.id,
          name: dev.name,
          online: false,
          output: null,
          power: null,
          voltage: null,
          current: null,
          tempC: null,
          error: code
        };
        return { result, energyWh: null };
      }
    })
  );
  if (track) {
    const samples = {};
    for (const { result, energyWh } of settled) {
      if (energyWh != null) samples[result.id] = { e: energyWh };
    }
    if (Object.keys(samples).length > 0) recordEnergy(PLUGIN_ID, samples);
    const now = Date.now();
    const since = { today: startOfToday(), week: now - 7 * DAY_MS, month: startOfMonth() };
    for (const { result } of settled) {
      if (!result.online) continue;
      result.energy = windowsKwh(PLUGIN_ID, result.id, "e", since);
    }
  }
  return Response.json({ devices: settled.map((s) => s.result) });
}
async function handleSwitch(device, on, password, signal) {
  try {
    const base = normalizeShellyBase(device.ip);
    await shellyRpc(base, `Switch.Set?id=0&on=${on ? "true" : "false"}`, password, signal);
    return Response.json({ ok: true, output: on });
  } catch (e) {
    const code = mapShellyError(e);
    if (code !== "timeout") void logPluginApiFailure(PLUGIN_ID, "switch", `${code}:${device.id}`);
    const status = code === "auth_failed" ? 401 : code === "blocked_url" ? 400 : 502;
    return Response.json({ error: code }, { status });
  }
}
function handleHistory(body) {
  const device = parseOneDevice(body.device);
  if (!device) return Response.json({ error: "invalid_target" }, { status: 400 });
  const unit = body.unit === "day" ? "day" : "hour";
  const now = Date.now();
  const rawFrom = Number(body.from);
  const rawTo = Number(body.to);
  if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) {
    return Response.json({ error: "invalid_range" }, { status: 400 });
  }
  const oldest = now - HISTORY_RETENTION_MS;
  const from = Math.max(oldest, Math.min(rawFrom, now));
  const to = Math.max(from, Math.min(rawTo, now));
  if (to <= from) return Response.json({ error: "invalid_range" }, { status: 400 });
  const wanted = countBuckets(from, to, unit);
  if (wanted > MAX_BUCKETS) {
    return Response.json({ error: "range_too_large", maxBuckets: MAX_BUCKETS, buckets: wanted }, { status: 400 });
  }
  const buckets = bucketsKwh(PLUGIN_ID, device.id, "e", from, to, unit);
  const total = buckets.reduce((sum, b) => sum + b.kwh, 0);
  const peak = buckets.reduce((max, b) => b.kwh > max ? b.kwh : max, 0);
  return Response.json({
    id: device.id,
    unit,
    from,
    to,
    clamped: from !== rawFrom || to !== rawTo,
    oldest,
    total,
    peak,
    buckets
  });
}
async function handlePost(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.action === "history") return handleHistory(body);
  const password = openSealedSecret(str(body.password));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SHELLY_TIMEOUT_MS);
  try {
    if (body.action === "switch") {
      const device = parseOneDevice(body.device);
      if (!device) return Response.json({ error: "invalid_target" }, { status: 400 });
      if (typeof body.on !== "boolean") return Response.json({ error: "invalid_state" }, { status: 400 });
      return await handleSwitch(device, body.on, devicePassword(device, password), ac.signal);
    }
    const devices = parseDevices(body.devices, MAX_DEVICES);
    if (devices.length === 0) return Response.json({ error: "no_devices" }, { status: 400 });
    return await handleStatus(devices, password, body.track === true, ac.signal);
  } finally {
    clearTimeout(timer);
  }
}
function shellyPlugServerHandler(ctx) {
  if (ctx.request.method !== "POST") {
    return Promise.resolve(Response.json({ error: "method_not_allowed" }, { status: 405 }));
  }
  return handlePost(ctx.request);
}
export {
  shellyPlugServerHandler as default,
  dynamic
};
