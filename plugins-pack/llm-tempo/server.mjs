// plugins-pack/_shared/log.ts
async function logPluginApiFailure(pluginId, operation, message, detail) {
  const extra = detail ? ` ${JSON.stringify(detail).slice(0, 500)}` : "";
  console.error(`[SelfDashboard][${pluginId}] ${operation}: ${message}${extra}`);
}

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

// plugins-pack/llm-tempo/server.ts
var PLUGIN_ID = "llm-tempo";
var TIMEOUT_MS = 5e3;
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
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
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
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
  let servers = [];
  try {
    const body = await request.json();
    if (Array.isArray(body.servers)) {
      servers = body.servers.filter((s) => !!s && typeof s.name === "string" && typeof s.url === "string" && s.url.trim() !== "").slice(0, MAX_SERVERS);
    }
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (servers.length === 0) return json({ error: "missing_servers" }, 400);
  try {
    return json({ servers: await Promise.all(servers.map(readServer)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logPluginApiFailure(PLUGIN_ID, "read-metrics", message);
    return json({ error: "failed" }, 500);
  }
}
function llmTempoServerHandler(ctx) {
  return handle(ctx.request);
}
export {
  llmTempoServerHandler as default
};
