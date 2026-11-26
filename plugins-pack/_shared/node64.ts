/**
 * Gemeinsamer Server-Baustein der Node64-Plugins (node64-checks, node64-dns,
 * node64-proxy, node64-map, node64-servers).
 *
 * Node64 (https://node64.de) hat eine lokale JSON-API unter /api/, Anmeldung
 * per API-Key (`Authorization: Bearer node64_…`). Die Plugins fragen sie
 * serverseitig ab, damit der Key nie im Browser-Netzwerkverkehr steht.
 * HTTP und HTTPS laufen bei Node64 auf demselben Port; bei HTTPS ist das
 * Zertifikat ab Werk selbst signiert, deshalb `insecureTls` nur für diese Node.
 */
import { fetchChecked } from './insecure-fetch'
import { logPluginApiFailure } from './log'
import { openSealedSecret } from './secret-crypto'
import { UnsafeOutboundUrlError } from './ssrf'

export const NODE64_TIMEOUT_MS = 10_000

export type Node64Conn = { base: string; key: string }

export class Node64Error extends Error {
  constructor(
    public code: string,
    public status: number,
    public detail?: string,
  ) {
    super(code)
  }
}

export function n64Num(v: unknown): number {
  const x = typeof v === 'number' ? v : Number(String(v ?? ''))
  return Number.isFinite(x) ? x : 0
}

export function n64Str(v: unknown, max = 200): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v)
  return s.length > max ? s.slice(0, max) : s
}

export function n64Obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function n64Arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** Basis-URL prüfen: nur http(s), ohne Zugangsdaten/Pfad; Standard-Port 8080. */
export function normalizeNode64Base(raw: string): string {
  let t = raw.trim().replace(/\/+$/, '')
  if (!t) throw new Node64Error('missing_url', 400)
  if (!/^https?:\/\//i.test(t)) t = `http://${t}`
  let u: URL
  try {
    u = new URL(t)
  } catch {
    throw new Node64Error('invalid_url', 400)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Node64Error('invalid_url', 400)
  if (!u.port && !/\.[a-z]{2,}$/i.test(u.hostname)) u.port = '8080'
  return `${u.protocol}//${u.host}`
}

/** Liest { url, apiKey } aus dem POST-Body und prüft beides. */
export async function readNode64Request<T extends Record<string, unknown>>(
  req: Request,
): Promise<{ conn: Node64Conn; body: T }> {
  if (req.method !== 'POST') throw new Node64Error('method_not_allowed', 405)
  let body: T
  try {
    body = (await req.json()) as T
  } catch {
    throw new Node64Error('invalid_json', 400)
  }
  const base = normalizeNode64Base(n64Str(body.url, 300))
  const key = openSealedSecret(n64Str(body.apiKey, 300).trim())
  if (!key) throw new Node64Error('missing_key', 400)
  if (!/^node64_[A-Za-z0-9_-]{8,}$/.test(key)) throw new Node64Error('invalid_key', 400)
  return { conn: { base, key }, body }
}

async function call(
  conn: Node64Conn,
  method: 'GET' | 'POST',
  path: string,
  signal: AbortSignal,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${conn.key}`,
    Accept: 'application/json',
    'X-Agent-Actor': 'selfdashboard',
  }
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetchChecked(
    `${conn.base}/api${path}`,
    { method, headers, signal, redirect: 'error', body: body ? JSON.stringify(body) : undefined },
    { insecureTls: conn.base.startsWith('https:') },
  )
  if (res.status === 401) throw new Node64Error('unauthorized', 401)
  if (res.status === 403) throw new Node64Error('forbidden', 403)
  if (res.status === 404) throw new Node64Error('module_off', 404, path)
  if (res.status === 429) throw new Node64Error('rate_limited', 429)
  if (!res.ok) throw new Node64Error('upstream_error', 502, `HTTP ${res.status}`)
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Node64Error('invalid_response', 502)
  }
}

export function n64Get(conn: Node64Conn, path: string, signal: AbortSignal): Promise<unknown> {
  return call(conn, 'GET', path, signal)
}

export function n64Post(
  conn: Node64Conn,
  path: string,
  signal: AbortSignal,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return call(conn, 'POST', path, signal, body)
}

/** Holt einen Wert, liefert bei einem Fehler `fallback` (für optionale Teilbereiche). */
export async function n64Try<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof Node64Error && (e.code === 'unauthorized' || e.code === 'forbidden')) throw e
    return fallback
  }
}

/**
 * Rahmen für jeden Plugin-Handler: Body lesen, Zeitlimit, Fehler einheitlich
 * als { error, detail } mit passendem Status zurückgeben.
 */
export async function handleNode64<T extends Record<string, unknown>>(
  pluginId: string,
  req: Request,
  work: (conn: Node64Conn, body: T, signal: AbortSignal) => Promise<unknown>,
): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), NODE64_TIMEOUT_MS)
  try {
    const { conn, body } = await readNode64Request<T>(req)
    const data = await work(conn, body, ac.signal)
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof Node64Error) {
      if (e.status >= 500) void logPluginApiFailure(pluginId, 'request', e.code, { detail: e.detail })
      return Response.json({ error: e.code, detail: e.detail }, { status: e.status })
    }
    if (e instanceof UnsafeOutboundUrlError) {
      return Response.json({ error: 'blocked_url', detail: e.message }, { status: 400 })
    }
    if (e instanceof Error && e.name === 'AbortError') {
      void logPluginApiFailure(pluginId, 'request', 'timeout')
      return Response.json({ error: 'timeout' }, { status: 504 })
    }
    void logPluginApiFailure(pluginId, 'request', 'network_error', {
      message: e instanceof Error ? e.message : String(e),
    })
    return Response.json({ error: 'network_error' }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
