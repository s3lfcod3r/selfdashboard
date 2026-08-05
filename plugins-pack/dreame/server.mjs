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
function encrypt(plaintext) {
  if (!plaintext) return "";
  const key = loadOrCreateKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}
function decrypt(ciphertext) {
  if (!ciphertext) return "";
  const key = loadOrCreateKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
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

// plugins-pack/_shared/dreame.ts
import crypto from "node:crypto";
var HOST_SUFFIX = ".iot.dreame.tech";
var PORT = "13267";
var PASSWORD_SALT = "RAylYC%fmSKp7%Tq";
var USER_AGENT = "Dreame_Smarthome/2.1.9 (iPhone; iOS 18.4.1; Scale/3.00)";
var BASIC_AUTH = "Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=";
var DEFAULT_TENANT = "000000";
var AUTH_PATH = "/dreame-auth/oauth/token";
var DREAME_TIMEOUT_MS = 2e4;
var DreameAuthError = class extends Error {
  constructor(message = "auth_failed", refreshExpired = false) {
    super(message);
    this.name = "DreameAuthError";
    this.refreshExpired = refreshExpired;
  }
};
function apiBase(country) {
  if (!/^[a-z]{2,3}$/.test(country)) throw new Error("invalid_country");
  return `https://${country}${HOST_SUFFIX}:${PORT}`;
}
function md5Hex(input) {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  let json = null;
  try {
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
async function dreameLogin(country, creds, signal) {
  const body = creds.refresh ? `platform=IOS&scope=all&grant_type=refresh_token&refresh_token=${encodeURIComponent(creds.refresh)}` : `platform=IOS&scope=all&grant_type=password&username=${encodeURIComponent(creds.email ?? "")}&password=${md5Hex((creds.password ?? "") + PASSWORD_SALT)}&type=account`;
  const { status, json } = await fetchJson(apiBase(country) + AUTH_PATH, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept-Language": "en-US;q=0.8",
      "User-Agent": USER_AGENT,
      Authorization: BASIC_AUTH,
      "Tenant-Id": DEFAULT_TENANT
    },
    body,
    signal
  });
  if (status === 200 && isObj(json) && typeof json.access_token === "string") {
    const expiresSec = typeof json.expires_in === "number" ? json.expires_in : 3600;
    return {
      key: json.access_token,
      refresh: typeof json.refresh_token === "string" ? json.refresh_token : creds.refresh ?? "",
      ti: typeof json.tenant_id === "string" ? json.tenant_id : DEFAULT_TENANT,
      uid: typeof json.uid === "string" ? json.uid : String(json.uid ?? ""),
      expireMs: Date.now() + Math.max(60, expiresSec - 120) * 1e3
    };
  }
  if (creds.refresh) throw new DreameAuthError("refresh_expired", true);
  throw new DreameAuthError("auth_failed", false);
}
function authHeaders(t) {
  return {
    Accept: "*/*",
    "Content-Type": "application/json",
    "Accept-Language": "en-US;q=0.8",
    "User-Agent": USER_AGENT,
    Authorization: BASIC_AUTH,
    "Tenant-Id": t.ti || DEFAULT_TENANT,
    "Dreame-Auth": t.key
  };
}
async function apiCall(country, t, path, params, signal) {
  const { status, json } = await fetchJson(`${apiBase(country)}/${path}`, {
    method: "POST",
    headers: authHeaders(t),
    body: params != null ? JSON.stringify(params) : void 0,
    signal
  });
  if (status === 401) throw new DreameAuthError("token_expired", true);
  if (!isObj(json)) throw new Error(`bad_response_${status}`);
  return json;
}
async function dreameListVacuums(country, t, signal) {
  const res = await apiCall(country, t, "dreame-user-iot/iotuserbind/device/listV2", null, signal);
  const data = isObj(res.data) ? res.data : {};
  const page = isObj(data.page) ? data.page : {};
  const records = Array.isArray(page.records) ? page.records : [];
  const out = [];
  for (const r of records) {
    if (!isObj(r)) continue;
    const model = String(r.model ?? "");
    if (!model.includes(".vacuum.")) continue;
    const info = isObj(r.deviceInfo) ? r.deviceInfo : {};
    out.push({
      did: String(r.did ?? ""),
      name: String(r.customName || info.displayName || "Dreame"),
      model,
      bindDomain: String(r.bindDomain ?? "")
    });
  }
  return out;
}
async function sendCommand(country, t, device, method, params, signal) {
  let sub = "";
  if (device.bindDomain) {
    const first = device.bindDomain.split(".")[0];
    if (/^[A-Za-z0-9_-]+$/.test(first)) sub = `-${first}`;
  }
  const id = Math.floor(Date.now() % 1e6 + 1);
  const res = await apiCall(country, t, `dreame-iot-com${sub}/device/sendCommand`, {
    did: device.did,
    id,
    data: { did: device.did, id, method, params }
  }, signal);
  const data = isObj(res.data) ? res.data : {};
  return data.result;
}
async function dreameGetProperties(country, t, device, props, signal) {
  const params = props.map((p) => ({ did: device.did, siid: p.siid, piid: p.piid }));
  const result = await sendCommand(country, t, device, "get_properties", params, signal);
  if (!Array.isArray(result)) return [];
  return result.filter(isObj).map((r) => ({ siid: Number(r.siid), piid: Number(r.piid), value: r.value }));
}
async function dreameAction(country, t, device, siid, aiid, signal) {
  await sendCommand(country, t, device, "action", { did: device.did, siid, aiid, in: [] }, signal);
}

// plugins-pack/dreame/server.ts
import crypto2 from "node:crypto";
import { chmodSync as chmodSync2, existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, renameSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, join as join3 } from "node:path";
var dynamic = "force-dynamic";
var PLUGIN_ID = "dreame";
var MAX_DEVICES = 4;
var LOGIN_MAX_FAILS = 5;
var LOGIN_LOCK_MS = 6e4;
var PROP = {
  state: { siid: 2, piid: 1 },
  error: { siid: 2, piid: 2 },
  battery: { siid: 3, piid: 1 },
  charging: { siid: 3, piid: 2 },
  cleanTime: { siid: 4, piid: 2 },
  cleanArea: { siid: 4, piid: 3 }
};
var ACTION = {
  start: { siid: 2, aiid: 1 },
  pause: { siid: 2, aiid: 2 },
  dock: { siid: 3, aiid: 1 }
};
var CONSUMABLE = {
  mainBrush: { siid: 9, piid: 2 },
  sideBrush: { siid: 10, piid: 2 },
  filter: { siid: 11, piid: 1 },
  sensor: { siid: 16, piid: 1 },
  mopPad: { siid: 18, piid: 1 }
};
var ALL_PROPS = [...Object.values(PROP), ...Object.values(CONSUMABLE)];
function normalizeStatus(code) {
  if ([1, 7, 9, 12, 25, 26, 27, 37, 38].includes(code)) return "cleaning";
  if ([5, 10, 17, 18, 28, 31].includes(code)) return "returning";
  if ([6, 13, 24].includes(code)) return "charging";
  if ([3, 21, 36].includes(code)) return "paused";
  if ([2, 29].includes(code)) return "idle";
  if (code === 4) return "error";
  return "other";
}
function str(v) {
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}
function numOr(v, d) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
var cache = /* @__PURE__ */ new Map();
var authLocks = /* @__PURE__ */ new Map();
var loginFails = /* @__PURE__ */ new Map();
var DEVICES_TTL_MS = 10 * 60 * 1e3;
function accountKey(email, country) {
  return crypto2.createHash("sha256").update(`${country}:${email}`).digest("hex").slice(0, 24);
}
function verifierFor(email, password, country) {
  return crypto2.createHash("sha256").update(`${country}:${email}:${password}`).digest("hex");
}
function sameVerifier(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto2.timingSafeEqual(ba, bb);
}
function tokenPath() {
  return join3(dataDir(), "plugins", PLUGIN_ID, "tokens.json");
}
function readStoredAll() {
  const file = tokenPath();
  if (!existsSync2(file)) return {};
  try {
    const data = JSON.parse(readFileSync2(file, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}
function writeStored(key, refresh, verifier) {
  const file = tokenPath();
  mkdirSync(dirname(file), { recursive: true });
  const data = readStoredAll();
  data[key] = { r: encrypt(refresh), v: verifier };
  const tmp = `${file}.tmp`;
  writeFileSync2(tmp, JSON.stringify(data), "utf8");
  renameSync(tmp, file);
  try {
    chmodSync2(file, 384);
  } catch {
  }
}
function loginLocked(key) {
  const e = loginFails.get(key);
  return e ? Date.now() < e.until : false;
}
function recordLoginFail(key) {
  const e = loginFails.get(key) ?? { fails: 0, until: 0 };
  e.fails += 1;
  if (e.fails >= LOGIN_MAX_FAILS) e.until = Date.now() + LOGIN_LOCK_MS;
  loginFails.set(key, e);
}
async function doAuth(key, email, password, country, verifier, signal) {
  const prev = cache.get(key);
  const stored = readStoredAll()[key];
  let refresh = null;
  if (prev && sameVerifier(prev.verifier, verifier)) refresh = prev.tokens.refresh || null;
  if (!refresh && stored && sameVerifier(stored.v, verifier)) refresh = stored.r ? decrypt(stored.r) || null : null;
  if (refresh) {
    try {
      const tokens = await dreameLogin(country, { refresh }, signal);
      const entry = { tokens, verifier, devices: prev?.devices, devicesTs: prev?.devicesTs };
      cache.set(key, entry);
      if (tokens.refresh) writeStored(key, tokens.refresh, verifier);
      return entry;
    } catch (e) {
      if (!(e instanceof DreameAuthError && e.refreshExpired)) throw e;
    }
  }
  if (!password) throw new DreameAuthError("missing_credentials");
  if (loginLocked(key)) throw new DreameAuthError("auth_failed");
  try {
    const tokens = await dreameLogin(country, { email, password }, signal);
    loginFails.delete(key);
    const entry = { tokens, verifier, devices: prev?.devices, devicesTs: prev?.devicesTs };
    cache.set(key, entry);
    if (tokens.refresh) writeStored(key, tokens.refresh, verifier);
    return entry;
  } catch (e) {
    recordLoginFail(key);
    throw e;
  }
}
async function ensureTokens(email, password, country, signal) {
  const key = accountKey(email, country);
  const verifier = verifierFor(email, password, country);
  const cached = cache.get(key);
  if (cached && sameVerifier(cached.verifier, verifier) && cached.tokens.expireMs > Date.now() + 3e4) {
    return { key, tokens: cached.tokens };
  }
  const pending = authLocks.get(key);
  if (pending) {
    const entry = await pending.catch(() => null);
    if (entry && sameVerifier(entry.verifier, verifier) && entry.tokens.expireMs > Date.now() + 3e4) {
      return { key, tokens: entry.tokens };
    }
  }
  const work = doAuth(key, email, password, country, verifier, signal);
  authLocks.set(key, work);
  try {
    const entry = await work;
    return { key, tokens: entry.tokens };
  } finally {
    if (authLocks.get(key) === work) authLocks.delete(key);
  }
}
async function getDevices(key, tokens, country, signal) {
  const entry = cache.get(key);
  if (entry?.devices && entry.devicesTs && Date.now() - entry.devicesTs < DEVICES_TTL_MS) {
    return entry.devices;
  }
  const devices = await dreameListVacuums(country, tokens, signal);
  if (entry) {
    entry.devices = devices;
    entry.devicesTs = Date.now();
  }
  return devices;
}
function mapError(e) {
  if (e instanceof DreameAuthError) return e.message === "missing_credentials" ? "missing_credentials" : "auth_failed";
  if (e instanceof Error && e.name === "AbortError") return "timeout";
  return "unreachable";
}
function parseCountry(v) {
  const c = str(v).toLowerCase();
  return /^[a-z]{2,3}$/.test(c) ? c : "eu";
}
async function readDevice(country, tokens, device, signal) {
  const readings = await dreameGetProperties(country, tokens, device, ALL_PROPS, signal);
  if (readings.length === 0) {
    return { did: device.did, name: device.name, model: device.model, online: false, status: "other", stateCode: -1 };
  }
  const val = (p) => readings.find((r) => r.siid === p.siid && r.piid === p.piid)?.value;
  const stateCode = numOr(val(PROP.state), -1) ?? -1;
  return {
    did: device.did,
    name: device.name,
    model: device.model,
    online: true,
    battery: numOr(val(PROP.battery), null),
    charging: numOr(val(PROP.charging), null),
    stateCode,
    status: normalizeStatus(stateCode),
    error: numOr(val(PROP.error), 0),
    cleaningTime: numOr(val(PROP.cleanTime), null),
    cleanedArea: numOr(val(PROP.cleanArea), null),
    consumables: {
      mainBrush: numOr(val(CONSUMABLE.mainBrush), null),
      sideBrush: numOr(val(CONSUMABLE.sideBrush), null),
      filter: numOr(val(CONSUMABLE.filter), null),
      sensor: numOr(val(CONSUMABLE.sensor), null),
      mopPad: numOr(val(CONSUMABLE.mopPad), null)
    }
  };
}
async function handlePost(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = str(body.email);
  const password = openSealedSecret(str(body.password));
  const country = parseCountry(body.country);
  if (!email) return Response.json({ error: "missing_credentials" }, { status: 400 });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DREAME_TIMEOUT_MS);
  let acctKey;
  try {
    const { key, tokens } = await ensureTokens(email, password, country, ac.signal);
    acctKey = key;
    if (body.action === "command") {
      const cmd = str(body.cmd);
      const did = str(body.did);
      const act = cmd === "start" ? ACTION.start : cmd === "pause" ? ACTION.pause : cmd === "dock" ? ACTION.dock : null;
      if (!act) return Response.json({ error: "invalid_command" }, { status: 400 });
      const devices2 = await getDevices(key, tokens, country, ac.signal);
      const device = devices2.find((d) => d.did === did) ?? devices2[0];
      if (!device) return Response.json({ error: "no_device" }, { status: 404 });
      await dreameAction(country, tokens, device, act.siid, act.aiid, ac.signal);
      return Response.json({ ok: true });
    }
    const devices = await getDevices(key, tokens, country, ac.signal);
    if (devices.length === 0) return Response.json({ devices: [] });
    const results = await Promise.all(
      devices.slice(0, MAX_DEVICES).map(async (d) => {
        try {
          return await readDevice(country, tokens, d, ac.signal);
        } catch {
          return { did: d.did, name: d.name, model: d.model, online: false, status: "other", stateCode: -1 };
        }
      })
    );
    return Response.json({ devices: results });
  } catch (e) {
    if (e instanceof DreameAuthError && e.message !== "missing_credentials" && acctKey) cache.delete(acctKey);
    const code = mapError(e);
    if (code !== "timeout") void logPluginApiFailure(PLUGIN_ID, str(body.action) || "status", code);
    const httpStatus = code === "auth_failed" || code === "missing_credentials" ? 401 : 502;
    return Response.json({ error: code }, { status: httpStatus });
  } finally {
    clearTimeout(timer);
  }
}
function dreameServerHandler(ctx) {
  if (ctx.request.method !== "POST") {
    return Promise.resolve(Response.json({ error: "method_not_allowed" }, { status: 405 }));
  }
  return handlePost(ctx.request);
}
export {
  dreameServerHandler as default,
  dynamic
};
