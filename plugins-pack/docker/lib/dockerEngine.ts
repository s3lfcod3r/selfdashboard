import * as http from 'node:http'
import type { SdContainerStats } from './dockerShared'

export { CONTAINER_ID_RE } from './dockerShared'
export type { SdContainerStats } from './dockerShared'

export function socketPath(): string {
  return process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock'
}

export function dockerRequest(
  method: 'GET' | 'POST',
  pathAndQuery: string,
  body?: string,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body ?? ''
    const headers: http.OutgoingHttpHeaders = {
      Host: 'localhost',
      Accept: 'application/json',
    }
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(payload, 'utf8')
    }
    const req = http.request(
      {
        socketPath: socketPath(),
        path: pathAndQuery,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: string | Buffer) => {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
        })
        res.on('end', () => {
          const resBody = Buffer.concat(chunks).toString('utf8')
          const code = res.statusCode ?? 500
          resolve({ ok: code >= 200 && code < 300, status: code, body: resBody })
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('Timeout beim Docker-Socket'))
    })
    if (payload) req.write(payload, 'utf8')
    req.end()
  })
}

export function dockerGet(pathAndQuery: string): Promise<{ ok: boolean; status: number; body: string }> {
  return dockerRequest('GET', pathAndQuery, undefined, 12_000)
}

const STATS_ONE_SHOT_TIMEOUT_MS = 6000

/** Nanoseconds — deltas shorter than this often produce misleading CPU % (noise / same-tick samples). */
const MIN_SYSTEM_CPU_DELTA_NS = BigInt(10_000_000)

/**
 * Docker stats JSON uses uint64 for `system_cpu_usage` and `cpu_usage.total_usage`.
 * Values often exceed `Number.MAX_SAFE_INTEGER` on long-running hosts; `JSON.parse`
 * rounds them and CPU deltas become garbage. Quote digits + revive as BigInt (same idea as json-bigint).
 */
function parseDockerStatsJson(body: string): Record<string, unknown> | null {
  try {
    const patched = body
      .replace(/"system_cpu_usage"\s*:\s*(\d+)/g, '"system_cpu_usage":"$1"')
      .replace(/"total_usage"\s*:\s*(\d+)/g, '"total_usage":"$1"')
    return JSON.parse(patched, (key, val) => {
      if (
        (key === 'system_cpu_usage' || key === 'total_usage') &&
        typeof val === 'string' &&
        /^\d+$/.test(val)
      ) {
        return BigInt(val)
      }
      return val
    }) as Record<string, unknown>
  } catch {
    return null
  }
}

function toBigU(v: unknown): bigint {
  const zero = BigInt(0)
  if (typeof v === 'bigint') return v >= zero ? v : zero
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return BigInt(Math.trunc(v))
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v)
  return zero
}

/**
 * Same idea as Docker CLI `calculateMemUsageUnixNoCache` (cli/command/container/stats_helpers.go):
 * subtract page cache so RAM matches `docker stats` / most UIs (cAdvisor-style), not raw cgroup `usage`.
 */
function memoryUsageBytesNoCache(mem: Record<string, unknown> | undefined): { usage: number; limit: number | null } | null {
  if (!mem) return null
  const usageRaw = mem.usage
  const limitRaw = mem.limit
  const usageTotal = typeof usageRaw === 'number' && Number.isFinite(usageRaw) && usageRaw >= 0 ? usageRaw : null
  if (usageTotal == null) return null
  const memLimitBytes = typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null

  const statsRaw = mem.stats
  let memUsageBytes = usageTotal
  if (statsRaw && typeof statsRaw === 'object') {
    const st = statsRaw as Record<string, unknown>
    const num = (k: string): number | null => {
      const v = st[k]
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
    }
    const tif = num('total_inactive_file')
    if (tif != null && tif < usageTotal) memUsageBytes = usageTotal - tif
    else {
      const inactiveFile = num('inactive_file')
      if (inactiveFile != null && inactiveFile < usageTotal) memUsageBytes = usageTotal - inactiveFile
    }
  }

  return { usage: memUsageBytes, limit: memLimitBytes }
}

/** Letzte CPU-Messung pro Container — ersetzt das 1–2 s lange „Priming“ von Docker (one-shot=false). */
type CpuSample = { total: bigint; system: bigint; at: number }

const CPU_SAMPLE_MAX_AGE_MS = 10 * 60_000
const lastCpuSample = new Map<string, CpuSample>()

function rememberCpuSample(id: string, sample: CpuSample): void {
  lastCpuSample.set(id, sample)
  if (lastCpuSample.size > 512) {
    const cutoff = Date.now() - CPU_SAMPLE_MAX_AGE_MS
    for (const [key, s] of lastCpuSample) {
      if (s.at < cutoff) lastCpuSample.delete(key)
    }
  }
}

export function parseOneShotStats(body: string): SdContainerStats | null {
  return parseStatsBody(body, null)?.stats ?? null
}

/**
 * CPU-% bevorzugt aus `precpu_stats` (one-shot=false liefert das), sonst aus der
 * vorherigen eigenen Messung `prev` (one-shot=true liefert kein precpu).
 * `sample` = neue Messung zum Merken; null, wenn die alte behalten werden soll
 * (Abstand zu kurz für einen sinnvollen Delta-Wert).
 */
function parseStatsBody(
  body: string,
  prev: CpuSample | null,
): { stats: SdContainerStats; sample: CpuSample | null } | null {
  const j = parseDockerStatsJson(body)
  if (!j) return null

  const ms = j.memory_stats as Record<string, unknown> | undefined
  const memParsed = memoryUsageBytesNoCache(ms)
  const memUsageBytes = memParsed ? memParsed.usage : null
  const memLimitBytes = memParsed?.limit ?? null
  const memPct =
    memUsageBytes != null && memLimitBytes != null && memLimitBytes > 0
      ? Math.min(100, (memUsageBytes / memLimitBytes) * 100)
      : null

  const cpu_stats = j.cpu_stats as Record<string, unknown> | undefined
  const precpu_stats = j.precpu_stats as Record<string, unknown> | undefined

  const cpuUsage = (x: Record<string, unknown> | undefined) =>
    (x?.cpu_usage as { total_usage?: unknown; percpu_usage?: unknown[] } | undefined) ?? undefined
  const totalUsage = (u: ReturnType<typeof cpuUsage>) => toBigU(u?.total_usage)
  const ncpusFrom = (cs: Record<string, unknown> | undefined): number => {
    const n = Number(cs?.online_cpus)
    if (Number.isFinite(n) && n > 0) return n
    const per = cpuUsage(cs)?.percpu_usage
    return Array.isArray(per) && per.length > 0 ? per.length : 1
  }

  const zero = BigInt(0)
  const cpuPercent = (cpuDelta: bigint, sysDelta: bigint): number | null => {
    const ncpus = ncpusFrom(cpu_stats)
    if (sysDelta < MIN_SYSTEM_CPU_DELTA_NS || cpuDelta <= zero || ncpus <= 0) return null
    const p = Number((cpuDelta * BigInt(ncpus) * BigInt(100)) / sysDelta)
    return Number.isFinite(p) ? Math.min(9999, Math.max(0, p)) : null
  }

  const curTotal = totalUsage(cpuUsage(cpu_stats))
  const curSystem = toBigU(cpu_stats?.system_cpu_usage)
  let sample: CpuSample | null = curSystem > zero ? { total: curTotal, system: curSystem, at: Date.now() } : null

  let cpuPct: number | null = null
  const preSystem = toBigU(precpu_stats?.system_cpu_usage)
  if (cpu_stats && precpu_stats && preSystem > zero) {
    cpuPct = cpuPercent(curTotal - totalUsage(cpuUsage(precpu_stats)), curSystem - preSystem)
  } else if (prev && sample) {
    const sysDelta = curSystem - prev.system
    if (sysDelta < MIN_SYSTEM_CPU_DELTA_NS) {
      sample = null // zu kurz seit der letzten Messung — alte als Basis behalten
    } else {
      cpuPct = cpuPercent(curTotal - prev.total, sysDelta)
    }
  }

  return { stats: { cpuPct, memUsageBytes, memLimitBytes, memPct }, sample }
}

/**
 * one-shot=true antwortet sofort (statt 1–2 s auf eine zweite Docker-Messung zu
 * warten). CPU-% kommt aus dem Abstand zur vorherigen Abfrage; beim allerersten
 * Abruf nach dem Start ist sie daher null und ab dem nächsten Refresh da.
 */
export async function fetchContainerStats(id: string): Promise<SdContainerStats | null> {
  try {
    const pathOneShot = `/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=true`
    const pathLegacy = `/containers/${encodeURIComponent(id)}/stats?stream=false`
    let r = await dockerRequest('GET', pathOneShot, undefined, STATS_ONE_SHOT_TIMEOUT_MS)
    if (!r.ok && r.status === 400) {
      r = await dockerRequest('GET', pathLegacy, undefined, STATS_ONE_SHOT_TIMEOUT_MS)
    }
    if (!r.ok) return null
    const prev = lastCpuSample.get(id)
    const usablePrev = prev && Date.now() - prev.at <= CPU_SAMPLE_MAX_AGE_MS ? prev : null
    const parsed = parseStatsBody(r.body, usablePrev)
    if (!parsed) return null
    if (parsed.sample) rememberCpuSample(id, parsed.sample)
    return parsed.stats
  } catch {
    return null
  }
}

export async function poolMap<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const nWorkers = Math.max(1, Math.min(concurrency, items.length || 1))
  const workers = Array.from({ length: items.length === 0 ? 0 : nWorkers }, async () => {
    while (true) {
      const idx = nextIndex++
      if (idx >= items.length) break
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}
