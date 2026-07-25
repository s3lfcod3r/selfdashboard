/**
 * Shelly Gen2+/Gen3 local RPC helpers + a small per-device energy-history store.
 *
 * Bundle-safe for plugins-pack/<id>/server.mjs — imports only sibling _shared
 * modules, never Next.js / @/lib. Shared by the shelly-3em and shelly-plug
 * plugins so the RPC/auth/history/parsing logic lives in one place.
 *
 * Devices are reached over their local HTTP RPC API (no cloud, no key). Auth is
 * optional: a Shelly with authentication disabled answers unauthenticated; with
 * it enabled it uses HTTP Digest (RFC 7616, SHA-256, fixed user "admin").
 */
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertSafeOutboundUrlResolved, fetchWithSsrfGuard, UnsafeOutboundUrlError } from './ssrf'
import { dataDir } from './data-dir'
import { logPluginApiFailure } from './log'

export { UnsafeOutboundUrlError }

/** Thrown when a device rejects the request (no/invalid password). */
export class ShellyAuthError extends Error {
  constructor() {
    super('auth_failed')
    this.name = 'ShellyAuthError'
  }
}

export const SHELLY_TIMEOUT_MS = 8_000

export type ShellyDevice = { id: string; name: string; ip: string }

// ---------------------------------------------------------------------------
// Shared value/parse helpers (used by both plugin servers — keep them here so a
// fix lands once instead of drifting between two copies).
// ---------------------------------------------------------------------------

export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''
}

/**
 * Coerce to a finite number, or null. Crucially, JSON `null`/`undefined` map to
 * null (NOT 0) — Shelly returns `null` for fields that aren't meaningful right
 * now (e.g. power factor at idle, an unconnected phase), and treating that as a
 * real 0 would corrupt the energy-counter baseline.
 */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Map any thrown error to a stable client-facing code (never leak details). */
export function mapShellyError(e: unknown): string {
  if (e instanceof ShellyAuthError) return 'auth_failed'
  if (e instanceof UnsafeOutboundUrlError) return 'blocked_url'
  if (e instanceof Error && e.name === 'AbortError') return 'timeout'
  return 'unreachable'
}

/** Parse a device list (array or JSON string) into a bounded, validated list. */
export function parseDevices(raw: unknown, maxDevices: number): ShellyDevice[] {
  let arr: unknown = raw
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw || '[]')
    } catch {
      return []
    }
  }
  if (!Array.isArray(arr)) return []
  return arr
    .slice(0, maxDevices)
    .map((d): ShellyDevice | null => {
      if (typeof d !== 'object' || d === null) return null
      const o = d as Record<string, unknown>
      const ip = str(o.ip)
      if (!ip) return null
      return { id: str(o.id) || ip, name: str(o.name), ip }
    })
    .filter((d): d is ShellyDevice => d !== null)
}

/** Parse a single device object (for the switch action). */
export function parseOneDevice(raw: unknown): ShellyDevice | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const ip = str(o.ip)
  if (!ip) return null
  return { id: str(o.id) || ip, name: str(o.name), ip }
}

// ---------------------------------------------------------------------------
// URL handling
// ---------------------------------------------------------------------------

/** Accept "192.168.1.20", "shelly.local" or a full URL; strip path/query. */
export function normalizeShellyBase(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) throw new Error('missing_ip')
  const withProto = /^https?:\/\//i.test(s) ? s : `http://${s}`
  const u = new URL(withProto)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('invalid_ip')
  u.pathname = ''
  u.search = ''
  u.hash = ''
  return u.toString().replace(/\/+$/, '')
}

// ---------------------------------------------------------------------------
// Digest auth (RFC 7616, SHA-256). Shelly Gen2+ always authenticates as "admin".
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/** Reject values carrying quotes/CR/LF so a device can't break out of a header. */
function safeParam(v: string | undefined): string | null {
  if (v == null) return null
  return /["\r\n]/.test(v) ? null : v
}

/** Parse a WWW-Authenticate Digest header into its key/value params. */
function parseAuthParams(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(header))) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  }
  return out
}

/** Build the Authorization header for a Digest challenge, or null if unusable. */
function buildDigestHeader(
  wwwAuth: string,
  method: string,
  uri: string,
  password: string,
): string | null {
  const p = parseAuthParams(wwwAuth)
  const realm = safeParam(p.realm)
  const nonce = safeParam(p.nonce)
  if (!realm || !nonce) return null
  // Shelly Gen2+ only offers SHA-256; refuse anything else rather than send a
  // wrong (potentially weaker) response.
  const algo = (p.algorithm ?? '').toUpperCase()
  if (algo && algo !== 'SHA-256') return null
  // qop must offer "auth" (Shelly always does); bail if it advertises something else.
  if (p.qop && !p.qop.split(',').map((q) => q.trim()).includes('auth')) return null

  const username = 'admin'
  const nc = '00000001'
  const cnonce = crypto.randomBytes(8).toString('hex')
  const qop = 'auth'
  const ha1 = sha256Hex(`${username}:${realm}:${password}`)
  const ha2 = sha256Hex(`${method}:${uri}`)
  const response = sha256Hex(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    'algorithm=SHA-256',
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`,
  ]
  const opaque = safeParam(p.opaque)
  if (opaque) parts.push(`opaque="${opaque}"`)
  return `Digest ${parts.join(', ')}`
}

// ---------------------------------------------------------------------------
// RPC call
// ---------------------------------------------------------------------------

/**
 * GET /rpc/<rpcPath> against a Shelly device. If the device answers 401 and a
 * password is configured, retries once with a Digest Authorization header.
 * Every outbound URL is SSRF-checked; LAN targets require the operator to have
 * set SELFDASHBOARD_ALLOW_PRIVATE_URLS=1 on the container.
 */
export async function shellyRpc<T = Record<string, unknown>>(
  base: string,
  rpcPath: string,
  password: string,
  signal: AbortSignal,
): Promise<T> {
  const uri = `/rpc/${rpcPath}`
  const url = `${base}${uri}`

  await assertSafeOutboundUrlResolved(url)
  let res = await fetchWithSsrfGuard(url, { method: 'GET', cache: 'no-store', signal })

  if (res.status === 401 && password) {
    const auth = buildDigestHeader(res.headers.get('www-authenticate') ?? '', 'GET', uri, password)
    if (auth) {
      await assertSafeOutboundUrlResolved(url)
      res = await fetchWithSsrfGuard(url, {
        method: 'GET',
        headers: { Authorization: auth },
        cache: 'no-store',
        signal,
      })
    }
  }

  if (res.status === 401) throw new ShellyAuthError()
  if (!res.ok) throw new Error(`http_${res.status}`)
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Energy history — cumulative counter snapshots per device, in the data volume.
// kWh over a window is the sum of positive deltas, so a counter reset (device
// reboot / firmware) never produces a negative or absurd figure.
// ---------------------------------------------------------------------------

/** One snapshot: epoch ms + a map of counter-name → cumulative Wh. */
type CounterSnap = { t: number; c: Record<string, number> }
type HistoryFile = Record<string, CounterSnap[]>

/** Keep ~40 days so a 30-day window always has a baseline before it. */
const MAX_AGE_MS = 40 * 24 * 60 * 60 * 1000
/** Don't persist snapshots faster than this, whatever the poll interval. */
const MIN_GAP_MS = 60 * 1000
/** Full 1-min resolution for the last 2 days; older samples thin to hourly. */
const FINE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export const DAY_MS = 24 * 60 * 60 * 1000

/** Local midnight today, in epoch ms (container timezone). */
export function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function historyPath(pluginId: string): string {
  return join(dataDir(), 'plugins', pluginId, 'energy.json')
}

function readHistory(pluginId: string): HistoryFile {
  const file = historyPath(pluginId)
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as HistoryFile) : {}
  } catch {
    // A corrupt file would otherwise silently wipe history — leave a trail.
    void logPluginApiFailure(pluginId, 'history', 'corrupt_history_file')
    return {}
  }
}

/** Atomic write (temp + rename) so a crash mid-write can't truncate the file. */
function writeHistory(pluginId: string, data: HistoryFile): void {
  const file = historyPath(pluginId)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data), 'utf8')
  renameSync(tmp, file)
}

/** Drop stale samples and thin everything older than the fine window to hourly. */
function compact(arr: CounterSnap[], now: number): CounterSnap[] {
  const cutoff = now - MAX_AGE_MS
  const fineFrom = now - FINE_WINDOW_MS
  const kept: CounterSnap[] = []
  const seenHour = new Set<number>()
  for (const s of arr) {
    if (s.t < cutoff) continue
    if (s.t >= fineFrom) {
      kept.push(s)
      continue
    }
    const bucket = Math.floor(s.t / HOUR_MS)
    if (!seenHour.has(bucket)) {
      seenHour.add(bucket)
      kept.push(s)
    }
  }
  return kept
}

/**
 * Append the current cumulative counters for one or more devices in a single
 * read-modify-write (callers batch all devices of a poll to avoid file races).
 * `samples` maps a stable device key → its counters in Wh. Every key in the
 * file is compacted on write, so removed/offline devices are garbage-collected
 * and the file stays bounded.
 */
export function recordEnergy(pluginId: string, samples: Record<string, Record<string, number>>): void {
  const now = Date.now()
  const data = readHistory(pluginId)

  for (const [key, counters] of Object.entries(samples)) {
    const clean: Record<string, number> = {}
    for (const [name, wh] of Object.entries(counters)) {
      if (typeof wh === 'number' && Number.isFinite(wh)) clean[name] = wh
    }
    if (Object.keys(clean).length === 0) continue
    const arr = data[key] ?? []
    const last = arr[arr.length - 1]
    if (!last || now - last.t >= MIN_GAP_MS) arr.push({ t: now, c: clean })
    data[key] = arr
  }

  // Compact/prune ALL keys (not just those in this poll) so orphaned devices
  // expire and the file never grows unbounded.
  for (const key of Object.keys(data)) {
    const compacted = compact(data[key], now)
    if (compacted.length === 0) delete data[key]
    else data[key] = compacted
  }

  writeHistory(pluginId, data)
}

/**
 * kWh accumulated on `counter` for `deviceKey` since `sinceMs`, summing only
 * positive step deltas. The last snapshot before the window seeds the baseline
 * so the first in-window step is measured from the window start.
 */
export function windowKwh(pluginId: string, deviceKey: string, counter: string, sinceMs: number): number {
  const arr = readHistory(pluginId)[deviceKey] ?? []
  let prev: number | null = null
  let wh = 0
  for (const snap of arr) {
    const v = snap.c[counter]
    if (typeof v !== 'number') continue
    if (snap.t < sinceMs) {
      prev = v
      continue
    }
    if (prev != null && v >= prev) wh += v - prev
    prev = v
  }
  return wh / 1000
}

/** Convenience: today / last 7 days / last 30 days kWh for a counter. */
export function energyWindows(
  pluginId: string,
  deviceKey: string,
  counter: string,
): { today: number; week: number; month: number } {
  const now = Date.now()
  return {
    today: windowKwh(pluginId, deviceKey, counter, startOfToday()),
    week: windowKwh(pluginId, deviceKey, counter, now - 7 * DAY_MS),
    month: windowKwh(pluginId, deviceKey, counter, now - 30 * DAY_MS),
  }
}
