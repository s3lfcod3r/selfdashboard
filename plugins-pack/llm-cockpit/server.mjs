// plugins-pack/_shared/log.ts
async function logPluginApiFailure(pluginId, operation, message, detail) {
  const extra = detail ? ` ${JSON.stringify(detail).slice(0, 500)}` : "";
  console.error(`[SelfDashboard][${pluginId}] ${operation}: ${message}${extra}`);
}

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
async function fetchWithSsrfGuard(urlStr, init, maxRedirects = 5) {
  assertUpstreamHostUp(urlStr);
  await assertSafeOutboundUrlResolved(urlStr);
  let current = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let resp;
    try {
      resp = await fetch(current, { ...init, redirect: "manual" });
    } catch (e) {
      noteUpstreamError(current, e);
      throw e;
    }
    noteUpstreamOk(current);
    if (resp.status < 300 || resp.status >= 400) return resp;
    const location = resp.headers.get("location");
    if (!location) return resp;
    current = new URL(location, current).href;
    await assertSafeOutboundUrlResolved(current);
  }
  throw new UnsafeOutboundUrlError("too_many_redirects");
}

// plugins-pack/_shared/plugin-stale-cache.ts
async function snapshot(res) {
  const headers = [];
  res.headers.forEach((value, name) => {
    if (name !== "set-cookie" && name !== "content-length") headers.push([name, value]);
  });
  return { status: res.status, headers, body: await res.text() };
}
function toResponse(snap, cache, ageMs) {
  const headers = new Headers(snap.headers);
  headers.set("X-SD-Cache", cache);
  headers.set("X-SD-Data-Age", String(Math.round(ageMs / 1e3)));
  return new Response(snap.body, { status: snap.status, headers });
}
function staleOverride() {
  const raw = process.env.SELFDASHBOARD_STALE_MAX_MS;
  const n = raw === void 0 || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function createPluginStaleCache(options) {
  const freshMs = Math.max(0, options.freshMs);
  const staleMs = Math.max(freshMs, staleOverride() ?? options.staleMs);
  const maxEntries = Math.max(1, options.maxEntries ?? 32);
  const label = options.label ?? "plugin";
  const maxWaitMs = Math.max(0, options.maxWaitMs ?? 0);
  const entries = /* @__PURE__ */ new Map();
  const inflight = /* @__PURE__ */ new Map();
  const scheduled = /* @__PURE__ */ new Map();
  let generation = 0;
  function store2(key, snap, cacheable) {
    if (snap.status < 200 || snap.status >= 300) return;
    if (cacheable) {
      try {
        if (!cacheable(snap.body)) return;
      } catch {
        return;
      }
    }
    entries.delete(key);
    while (entries.size >= maxEntries) {
      const first = entries.keys().next().value;
      if (first === void 0) break;
      entries.delete(first);
    }
    entries.set(key, { snap, at: Date.now() });
  }
  function load(key, loader, cacheable) {
    const running = inflight.get(key);
    if (running) return running;
    const gen = generation;
    const p = Promise.resolve().then(loader).then(snapshot).then((snap) => {
      if (gen === generation) store2(key, snap, cacheable);
      return snap;
    }).finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
    inflight.set(key, p);
    return p;
  }
  return {
    async respond(key, loader, opts) {
      const cached = entries.get(key);
      if (cached) {
        const age = Date.now() - cached.at;
        if (age < freshMs) return toResponse(cached.snap, "hit", age);
        if (age < staleMs && maxWaitMs > 0) {
          const pending = load(key, loader, opts?.cacheable).catch((e) => {
            console.warn(
              `[SelfDashboard][stale-cache] ${label}: Refresh fehlgeschlagen`,
              e instanceof Error ? e.message : e
            );
            return null;
          });
          let timer;
          const fresh = await Promise.race([
            pending,
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(null), maxWaitMs);
            })
          ]);
          clearTimeout(timer);
          if (fresh) return toResponse(fresh, "refresh", 0);
          return toResponse(cached.snap, "stale", age);
        }
        if (age < staleMs) {
          if (!scheduled.has(key)) {
            scheduled.set(
              key,
              setTimeout(() => {
                scheduled.delete(key);
                void load(key, loader, opts?.cacheable).catch((e) => {
                  console.warn(
                    `[SelfDashboard][stale-cache] ${label}: Hintergrund-Refresh fehlgeschlagen`,
                    e instanceof Error ? e.message : e
                  );
                });
              }, 0)
            );
          }
          return toResponse(cached.snap, "stale", age);
        }
        entries.delete(key);
      }
      const snap = await load(key, loader, opts?.cacheable);
      return toResponse(snap, "miss", 0);
    },
    clear() {
      for (const timer of scheduled.values()) clearTimeout(timer);
      scheduled.clear();
      entries.clear();
      inflight.clear();
      generation += 1;
    }
  };
}

// plugins-pack/llm-cockpit/server.ts
var PLUGIN_ID = "llm-cockpit";
var TIMEOUT_MS = 8e3;
var TEMPO_TIMEOUT_MS = 5e3;
var MAX_SERVERS = 8;
var WANTED = /* @__PURE__ */ new Set([
  "prompt_tokens_total",
  "prompt_seconds_total",
  "tokens_predicted_total",
  "tokens_predicted_seconds_total",
  "spec_decode_num_draft_tokens_total",
  "spec_decode_num_accepted_tokens_total",
  "requests_processing"
]);
var statusCache = createPluginStaleCache({ freshMs: 15e3, staleMs: 10 * 6e4, maxEntries: 8, label: `${PLUGIN_ID}/status` });
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
async function fetchJson(url, operation) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchWithSsrfGuard(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return json({ error: "upstream_status", status: res.status, host: hostOf(url) }, 502);
    return json(await res.json());
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) return json({ error: "unsafe_url", detail: err.message, host: hostOf(url) }, 400);
    const message = err instanceof Error ? err.message : String(err);
    await logPluginApiFailure(PLUGIN_ID, operation, message, { host: hostOf(url) });
    const timeout = ctrl.signal.aborted || /timeout|ETIMEDOUT/i.test(message);
    return json({ error: timeout ? "timeout" : "unreachable", host: hostOf(url) }, 502);
  } finally {
    clearTimeout(timer);
  }
}
function parseMetrics(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^llamacpp:([a-z_]+)\s+([-0-9.eE+]+)\s*$/.exec(line.trim());
    if (m && WANTED.has(m[1])) out[m[1]] = Number(m[2]);
  }
  return out;
}
function metricsUrl(base) {
  const trimmed = base.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${trimmed}/metrics`;
}
async function readServer(s) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TEMPO_TIMEOUT_MS);
  try {
    const res = await fetchWithSsrfGuard(metricsUrl(s.url), { signal: ctrl.signal });
    if (res.status === 501) return { name: s.name, state: "no_metrics" };
    if (!res.ok) return { name: s.name, state: "error" };
    return { name: s.name, state: "ok", metrics: parseMetrics(await res.text()) };
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) return { name: s.name, state: "error" };
    return { name: s.name, state: "off" };
  } finally {
    clearTimeout(timer);
  }
}
async function handle(request) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (body.kind === "tokens") {
    if (!url) return json({ error: "missing_url" }, 400);
    return fetchJson(url, "fetch-tokens");
  }
  if (body.kind === "status") {
    if (!url) return json({ error: "missing_url" }, 400);
    return statusCache.respond(url, () => fetchJson(url, "fetch-status"));
  }
  if (body.kind === "tempo") {
    const servers = Array.isArray(body.servers) ? body.servers.filter((s) => !!s && typeof s.name === "string" && typeof s.url === "string" && s.url.trim() !== "").slice(0, MAX_SERVERS) : [];
    if (servers.length === 0) return json({ error: "missing_servers" }, 400);
    return json({ servers: await Promise.all(servers.map(readServer)) });
  }
  return json({ error: "unknown_kind" }, 400);
}
function llmCockpitServerHandler(ctx) {
  return handle(ctx.request);
}
export {
  llmCockpitServerHandler as default
};
