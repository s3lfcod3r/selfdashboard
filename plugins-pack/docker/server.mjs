// plugins-pack/_shared/host-guard.ts
function hostGuards() {
  return globalThis.__selfDashboardServerHost;
}
function call(name, req) {
  const fn = hostGuards()?.[name];
  if (typeof fn !== "function") {
    return Response.json({ error: "forbidden", detail: "host_guard_missing" }, { status: 403 });
  }
  return fn(req);
}
function requireFullAdmin(req) {
  return call("requireFullAdmin", req);
}

// plugins-pack/_shared/log.ts
async function logPluginApiFailure(pluginId, operation, message, detail) {
  const extra = detail ? ` ${JSON.stringify(detail).slice(0, 500)}` : "";
  console.error(`[SelfDashboard][${pluginId}] ${operation}: ${message}${extra}`);
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
  const entries = /* @__PURE__ */ new Map();
  const inflight = /* @__PURE__ */ new Map();
  const scheduled = /* @__PURE__ */ new Map();
  let generation = 0;
  function store(key, snap, cacheable) {
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
      if (gen === generation) store(key, snap, cacheable);
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

// plugins-pack/docker/lib/dockerEngine.ts
import * as http from "node:http";

// plugins-pack/docker/lib/dockerShared.ts
var CONTAINER_ID_RE = /^[a-f0-9]{8,128}$/i;

// plugins-pack/docker/lib/dockerEngine.ts
function socketPath() {
  return process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
}
function dockerRequest(method, pathAndQuery, body, timeoutMs = 12e3) {
  return new Promise((resolve, reject) => {
    const payload = body ?? "";
    const headers = {
      Host: "localhost",
      Accept: "application/json"
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload, "utf8");
    }
    const req = http.request(
      {
        socketPath: socketPath(),
        path: pathAndQuery,
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        });
        res.on("end", () => {
          const resBody = Buffer.concat(chunks).toString("utf8");
          const code = res.statusCode ?? 500;
          resolve({ ok: code >= 200 && code < 300, status: code, body: resBody });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("Timeout beim Docker-Socket"));
    });
    if (payload) req.write(payload, "utf8");
    req.end();
  });
}
function dockerGet(pathAndQuery) {
  return dockerRequest("GET", pathAndQuery, void 0, 12e3);
}
var STATS_ONE_SHOT_TIMEOUT_MS = 6e3;
var MIN_SYSTEM_CPU_DELTA_NS = BigInt(1e7);
function parseDockerStatsJson(body) {
  try {
    const patched = body.replace(/"system_cpu_usage"\s*:\s*(\d+)/g, '"system_cpu_usage":"$1"').replace(/"total_usage"\s*:\s*(\d+)/g, '"total_usage":"$1"');
    return JSON.parse(patched, (key, val) => {
      if ((key === "system_cpu_usage" || key === "total_usage") && typeof val === "string" && /^\d+$/.test(val)) {
        return BigInt(val);
      }
      return val;
    });
  } catch {
    return null;
  }
}
function toBigU(v) {
  const zero = BigInt(0);
  if (typeof v === "bigint") return v >= zero ? v : zero;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return zero;
}
function memoryUsageBytesNoCache(mem) {
  if (!mem) return null;
  const usageRaw = mem.usage;
  const limitRaw = mem.limit;
  const usageTotal = typeof usageRaw === "number" && Number.isFinite(usageRaw) && usageRaw >= 0 ? usageRaw : null;
  if (usageTotal == null) return null;
  const memLimitBytes = typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null;
  const statsRaw = mem.stats;
  let memUsageBytes = usageTotal;
  if (statsRaw && typeof statsRaw === "object") {
    const st = statsRaw;
    const num = (k) => {
      const v = st[k];
      return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
    };
    const tif = num("total_inactive_file");
    if (tif != null && tif < usageTotal) memUsageBytes = usageTotal - tif;
    else {
      const inactiveFile = num("inactive_file");
      if (inactiveFile != null && inactiveFile < usageTotal) memUsageBytes = usageTotal - inactiveFile;
    }
  }
  return { usage: memUsageBytes, limit: memLimitBytes };
}
var CPU_SAMPLE_MAX_AGE_MS = 10 * 6e4;
var lastCpuSample = /* @__PURE__ */ new Map();
function rememberCpuSample(id, sample) {
  lastCpuSample.set(id, sample);
  if (lastCpuSample.size > 512) {
    const cutoff = Date.now() - CPU_SAMPLE_MAX_AGE_MS;
    for (const [key, s] of lastCpuSample) {
      if (s.at < cutoff) lastCpuSample.delete(key);
    }
  }
}
function parseStatsBody(body, prev) {
  const j = parseDockerStatsJson(body);
  if (!j) return null;
  const ms = j.memory_stats;
  const memParsed = memoryUsageBytesNoCache(ms);
  const memUsageBytes = memParsed ? memParsed.usage : null;
  const memLimitBytes = memParsed?.limit ?? null;
  const memPct = memUsageBytes != null && memLimitBytes != null && memLimitBytes > 0 ? Math.min(100, memUsageBytes / memLimitBytes * 100) : null;
  const cpu_stats = j.cpu_stats;
  const precpu_stats = j.precpu_stats;
  const cpuUsage = (x) => x?.cpu_usage ?? void 0;
  const totalUsage = (u) => toBigU(u?.total_usage);
  const ncpusFrom = (cs) => {
    const n = Number(cs?.online_cpus);
    if (Number.isFinite(n) && n > 0) return n;
    const per = cpuUsage(cs)?.percpu_usage;
    return Array.isArray(per) && per.length > 0 ? per.length : 1;
  };
  const zero = BigInt(0);
  const cpuPercent = (cpuDelta, sysDelta) => {
    const ncpus = ncpusFrom(cpu_stats);
    if (sysDelta < MIN_SYSTEM_CPU_DELTA_NS || cpuDelta <= zero || ncpus <= 0) return null;
    const p = Number(cpuDelta * BigInt(ncpus) * BigInt(100) / sysDelta);
    return Number.isFinite(p) ? Math.min(9999, Math.max(0, p)) : null;
  };
  const curTotal = totalUsage(cpuUsage(cpu_stats));
  const curSystem = toBigU(cpu_stats?.system_cpu_usage);
  let sample = curSystem > zero ? { total: curTotal, system: curSystem, at: Date.now() } : null;
  let cpuPct = null;
  const preSystem = toBigU(precpu_stats?.system_cpu_usage);
  if (cpu_stats && precpu_stats && preSystem > zero) {
    cpuPct = cpuPercent(curTotal - totalUsage(cpuUsage(precpu_stats)), curSystem - preSystem);
  } else if (prev && sample) {
    const sysDelta = curSystem - prev.system;
    if (sysDelta < MIN_SYSTEM_CPU_DELTA_NS) {
      sample = null;
    } else {
      cpuPct = cpuPercent(curTotal - prev.total, sysDelta);
    }
  }
  return { stats: { cpuPct, memUsageBytes, memLimitBytes, memPct }, sample };
}
async function fetchContainerStats(id) {
  try {
    const pathOneShot = `/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=true`;
    const pathLegacy = `/containers/${encodeURIComponent(id)}/stats?stream=false`;
    let r = await dockerRequest("GET", pathOneShot, void 0, STATS_ONE_SHOT_TIMEOUT_MS);
    if (!r.ok && r.status === 400) {
      r = await dockerRequest("GET", pathLegacy, void 0, STATS_ONE_SHOT_TIMEOUT_MS);
    }
    if (!r.ok) return null;
    const prev = lastCpuSample.get(id);
    const usablePrev = prev && Date.now() - prev.at <= CPU_SAMPLE_MAX_AGE_MS ? prev : null;
    const parsed = parseStatsBody(r.body, usablePrev);
    if (!parsed) return null;
    if (parsed.sample) rememberCpuSample(id, parsed.sample);
    return parsed.stats;
  } catch {
    return null;
  }
}
async function poolMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const nWorkers = Math.max(1, Math.min(concurrency, items.length || 1));
  const workers = Array.from({ length: items.length === 0 ? 0 : nWorkers }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

// plugins-pack/docker/server.ts
var listCache = createPluginStaleCache({
  freshMs: Math.max(0, Number(process.env.DOCKER_LIST_CACHE_MS) || 5e3),
  staleMs: 10 * 6e4,
  maxEntries: 8,
  label: "docker"
});
function parseContainerAction(body) {
  if (!body || typeof body !== "object") return null;
  const o = body;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const action = o.action;
  if (!CONTAINER_ID_RE.test(id)) return null;
  if (action !== "start" && action !== "stop" && action !== "restart") return null;
  return { id, action };
}
async function handleListGet(req) {
  const { searchParams } = new URL(req.url);
  const all = searchParams.get("all") === "1" ? "true" : "false";
  const includeStats = searchParams.get("stats") === "1";
  return listCache.respond(`list:${all}:${includeStats ? "1" : "0"}`, () => loadList(all, includeStats));
}
async function loadList(all, includeStats) {
  try {
    const r = await dockerGet(`/containers/json?all=${all}`);
    if (!r.ok) {
      const err = r.body?.slice(0, 400) || `Docker HTTP ${r.status}`;
      void logPluginApiFailure("docker", "list", err, { status: r.status });
      return Response.json(
        { error: "Docker-Anfrage fehlgeschlagen" },
        { status: r.status >= 400 && r.status < 600 ? r.status : 502 }
      );
    }
    let data;
    try {
      data = JSON.parse(r.body);
    } catch {
      return Response.json({ error: "Ung\xFCltige JSON-Antwort von Docker" }, { status: 502 });
    }
    if (includeStats && Array.isArray(data)) {
      const arr = data;
      const runningIds = [];
      for (const c of arr) {
        const id = typeof c.Id === "string" ? c.Id : "";
        if (c.State === "running" && CONTAINER_ID_RE.test(id)) runningIds.push(id);
      }
      const unique = [...new Set(runningIds)];
      const statsArray = await poolMap(unique, 16, async (id) => ({ id, stats: await fetchContainerStats(id) }));
      const byId = new Map(statsArray.map((x) => [x.id, x.stats]));
      for (const c of arr) {
        const id = typeof c.Id === "string" ? c.Id : "";
        if (c.State === "running" && CONTAINER_ID_RE.test(id)) {
          c.sdStats = byId.get(id) ?? null;
        } else {
          c.sdStats = null;
        }
      }
    }
    return Response.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/EACCES|permission denied/i.test(msg)) {
      void logPluginApiFailure("docker", "list", "docker_socket_eacces");
      return Response.json(
        {
          error: "Kein Zugriff auf den Docker-Socket (EACCES). Unter Unraid: Extra Parameter --group-add=281 (oder GID von stat -c %g /var/run/docker.sock). Neuere Images laufen als root und umgehen das oft automatisch."
        },
        { status: 503 }
      );
    }
    const hint = msg.includes("ENOENT") || msg.includes("ENOTDIR") ? "Docker-Socket nicht gefunden \u2014 z. B. -v /var/run/docker.sock:/var/run/docker.sock am SelfDashboard-Container." : "Docker ist nicht erreichbar.";
    void logPluginApiFailure("docker", "list", msg);
    return Response.json({ error: hint }, { status: 503 });
  }
}
async function handleActionPost(req) {
  const auth = requireFullAdmin(req);
  if (auth instanceof Response) return auth;
  let parsed;
  try {
    const raw = await req.text();
    let body;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return Response.json({ error: "Ung\xFCltiges JSON" }, { status: 400 });
    }
    const p = parseContainerAction(body);
    if (!p) {
      return Response.json({ error: "Ung\xFCltige Parameter (id, action)" }, { status: 400 });
    }
    parsed = p;
  } catch {
    return Response.json({ error: "Body konnte nicht gelesen werden" }, { status: 400 });
  }
  const path = parsed.action === "start" ? `/containers/${encodeURIComponent(parsed.id)}/start` : parsed.action === "stop" ? `/containers/${encodeURIComponent(parsed.id)}/stop?t=10` : `/containers/${encodeURIComponent(parsed.id)}/restart?t=10`;
  try {
    const r = await dockerRequest("POST", path, "", 6e4);
    if (!r.ok) {
      let msg = r.body?.slice(0, 500) || `Docker HTTP ${r.status}`;
      try {
        const j = JSON.parse(r.body);
        if (typeof j.message === "string" && j.message.trim()) msg = j.message.trim();
      } catch {
      }
      const status = r.status >= 400 && r.status < 600 ? r.status : 502;
      void logPluginApiFailure("docker", parsed.action, msg, { id: parsed.id, status: r.status });
      return Response.json({ error: "Aktion fehlgeschlagen" }, { status });
    }
    listCache.clear();
    return Response.json({ ok: true, action: parsed.action, id: parsed.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/EACCES|permission denied/i.test(msg)) {
      void logPluginApiFailure("docker", parsed.action, "docker_socket_eacces", { id: parsed.id });
      return Response.json(
        {
          error: "Kein Zugriff auf den Docker-Socket (EACCES). Unter Unraid: Extra Parameter --group-add=281 (oder GID von stat -c %g /var/run/docker.sock). Neuere Images laufen als root und umgehen das oft automatisch."
        },
        { status: 503 }
      );
    }
    void logPluginApiFailure("docker", parsed.action, msg, { id: parsed.id });
    return Response.json({ error: "Docker ist nicht erreichbar." }, { status: 503 });
  }
}
async function dockerServerHandler(ctx) {
  const method = ctx.request.method.toUpperCase();
  const [seg] = ctx.path;
  if (method === "GET" && (!seg || seg === "containers")) {
    return handleListGet(ctx.request);
  }
  if (method === "POST" && (!seg || seg === "containers")) {
    return handleActionPost(ctx.request);
  }
  return Response.json(
    { error: "not_found", pluginId: ctx.pluginId, path: ctx.path.join("/") },
    { status: 404 }
  );
}
var server_default = dockerServerHandler;
export {
  server_default as default,
  dockerServerHandler
};
