// plugins-pack/bambu-cam/server.ts
import tls from "tls";

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

// plugins-pack/bambu-cam/server.ts
var dynamic = "force-dynamic";
var CONNECT_TIMEOUT_MS = 8e3;
var MAX_JPEG = 6 * 1024 * 1024;
function isPrivateHost(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h.trim());
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return false;
  if (o[0] === 10) return true;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  return false;
}
function authPacket(accessCode) {
  const b = Buffer.alloc(80);
  b.writeUInt32LE(64, 0);
  b.writeUInt32LE(12288, 4);
  b.writeUInt32LE(0, 8);
  b.writeUInt32LE(0, 12);
  Buffer.from("bblp", "ascii").copy(b, 16);
  Buffer.from(accessCode, "ascii").copy(b, 48, 0, 32);
  return b;
}
function grabSnapshot(host, accessCode) {
  return new Promise((resolve, reject) => {
    let done = false;
    let chunks = Buffer.alloc(0);
    let payloadLen = -1;
    const socket = tls.connect(
      { host, port: 6e3, rejectUnauthorized: false, timeout: CONNECT_TIMEOUT_MS },
      () => socket.write(authPacket(accessCode))
    );
    const finish = (err, jpeg) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
      }
      if (err) reject(err);
      else resolve(jpeg);
    };
    const timer = setTimeout(() => finish(new Error("timeout")), CONNECT_TIMEOUT_MS + 1500);
    socket.on("data", (d) => {
      chunks = Buffer.concat([chunks, d]);
      if (chunks.length > MAX_JPEG + 64) {
        clearTimeout(timer);
        finish(new Error("frame_too_large"));
        return;
      }
      for (; ; ) {
        if (payloadLen < 0) {
          if (chunks.length < 16) return;
          payloadLen = chunks.readUInt32LE(0);
          if (payloadLen <= 0 || payloadLen > MAX_JPEG) {
            clearTimeout(timer);
            finish(new Error("bad_frame"));
            return;
          }
          chunks = chunks.subarray(16);
        }
        if (chunks.length < payloadLen) return;
        const jpeg = chunks.subarray(0, payloadLen);
        if (jpeg.length > 3 && jpeg[0] === 255 && jpeg[1] === 216) {
          clearTimeout(timer);
          finish(null, Buffer.from(jpeg));
          return;
        }
        chunks = chunks.subarray(payloadLen);
        payloadLen = -1;
      }
    });
    socket.on("timeout", () => {
      clearTimeout(timer);
      finish(new Error("timeout"));
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      finish(e instanceof Error ? e : new Error("socket_error"));
    });
    socket.on("close", () => {
      clearTimeout(timer);
      finish(new Error("closed"));
    });
  });
}
async function handleGet(req) {
  const sp = new URL(req.url).searchParams;
  const action = sp.get("action") || "";
  if (action === "snapshot") {
    const host = (sp.get("host") || "").trim();
    if (!isPrivateHost(host)) return Response.json({ error: "invalid_host" }, { status: 400 });
    const code = openSealedSecret(sp.get("code") || "");
    if (!code) return Response.json({ error: "missing_code" }, { status: 400 });
    const target2 = `tls://${host}:6000`;
    try {
      assertUpstreamHostUp(target2);
      const jpeg = await grabSnapshot(host, code).catch((e) => {
        noteUpstreamError(target2, e);
        throw e;
      });
      noteUpstreamOk(target2);
      return new Response(new Uint8Array(jpeg), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store, max-age=0" }
      });
    } catch (e) {
      void logPluginApiFailure("bambu-cam", "snapshot", e instanceof Error ? e.message : "error");
      return Response.json({ error: "snapshot_failed", detail: e instanceof Error ? e.message : "error" }, { status: 502 });
    }
  }
  if (action === "proxy") {
    const raw = sp.get("url") || "";
    let u;
    try {
      u = new URL(raw);
    } catch {
      return Response.json({ error: "invalid_url" }, { status: 400 });
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return Response.json({ error: "invalid_url" }, { status: 400 });
    if (!isPrivateHost(u.hostname)) return Response.json({ error: "invalid_host" }, { status: 400 });
    try {
      assertUpstreamHostUp(raw);
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15e3);
      const r = await fetch(raw, { cache: "no-store", signal: ac.signal }).catch((e) => {
        noteUpstreamError(raw, e);
        throw e;
      });
      noteUpstreamOk(raw);
      clearTimeout(t);
      if (!r.ok || !r.body) {
        void logPluginApiFailure("bambu-cam", "proxy", `http_${r.status}`);
        return Response.json({ error: "proxy_failed" }, { status: 502 });
      }
      return new Response(r.body, {
        headers: {
          "Content-Type": r.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "no-store, max-age=0"
        }
      });
    } catch (e) {
      void logPluginApiFailure("bambu-cam", "proxy", e instanceof Error ? e.message : "error");
      return Response.json({ error: "proxy_failed" }, { status: 502 });
    }
  }
  return Response.json({ error: "invalid_action" }, { status: 400 });
}
async function handleBambuCamRequest(req, _path) {
  if (req.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  return handleGet(req);
}
function bambuCamServerHandler(ctx) {
  return handleBambuCamRequest(ctx.request, ctx.path);
}
export {
  bambuCamServerHandler as default,
  dynamic
};
