import { logPluginApiFailure } from '../_shared/log'
import { openSealedSecret } from '../_shared/secret-crypto'
import { fetchCheckedJson } from '../_shared/insecure-fetch'
import { UnsafeOutboundUrlError } from '../_shared/ssrf'
import { createPluginServerCache } from '../_shared/plugin-server-cache'
import type { PluginServerContext } from '../_shared/plugin-server-types'

export const dynamic = 'force-dynamic'

const FETCH_TIMEOUT_MS = 10_000

// Live-Polling mehrerer Browser gleichzeitig soll ntopng nicht fluten.
const cache = createPluginServerCache({ ttlMs: 5_000, maxEntries: 8 })

type ReqBody = {
  ntopngUrl?: string
  username?: string
  password?: string
  ifid?: number | string
  alertsUrl?: string
  alertsToken?: string
  maxAlerts?: number | string
  importantOnly?: boolean
}

export type NetzwachtHost = {
  ip: string
  name: string
  mac: string
  bps: number
  totalBytes: number
  score: number
}

export type NetzwachtAlert = {
  ts: string
  sig: string
  cat: string
  sev: number
  src: string
  spt: number | null
  dst: string
  dpt: number | null
  proto: string
}

export type NetzwachtPayload = {
  ntopng: {
    ok: boolean
    error?: string
    throughputBps?: number
    numLocalHosts?: number
    numHosts?: number
    alertedFlows?: number
    engagedAlerts?: number
    topHosts?: NetzwachtHost[]
  }
  suricata: {
    ok: boolean
    configured: boolean
    error?: string
    h24?: { high: number; medium: number; low: number; total: number }
    latest?: string | null
    alerts?: NetzwachtAlert[]
  }
}

function num(v: unknown): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v))
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function normalizeBase(raw: string): string {
  const t = raw.trim().replace(/\/+$/, '')
  if (!t) throw new Error('missing_url')
  // ntopng laeuft im Heimnetz standardmaessig ohne TLS auf Port 3000.
  const withProto = /^https?:\/\//i.test(t) ? t : `http://${t}`
  const u = new URL(withProto)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('invalid_url')
  u.username = ''
  u.password = ''
  u.hash = ''
  return u.toString().replace(/\/+$/, '')
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

async function fetchNtopng(
  base: string,
  auth: string,
  ifid: number,
  signal: AbortSignal,
): Promise<NetzwachtPayload['ntopng']> {
  const init = { headers: { Accept: 'application/json', Authorization: auth }, signal }
  const [ifaceRes, hostsRes] = await Promise.all([
    fetchCheckedJson(`${base}/lua/rest/v2/get/interface/data.lua?ifid=${ifid}`, init),
    fetchCheckedJson(
      `${base}/lua/rest/v2/get/host/active.lua?ifid=${ifid}&perPage=5&sortColumn=column_traffic&sortOrder=desc&mode=local`,
      init,
    ),
  ])

  // Bei falschen Zugangsdaten liefert ntopng einen Redirect auf die Login-Seite.
  if (ifaceRes.status === 401 || ifaceRes.status === 403 || (ifaceRes.status >= 300 && ifaceRes.status < 400)) {
    void logPluginApiFailure('netzwacht', 'ntopng-auth', `status_${ifaceRes.status}`)
    return { ok: false, error: 'auth_failed' }
  }
  if (!ifaceRes.ok || !isObject(ifaceRes.json)) {
    void logPluginApiFailure('netzwacht', 'ntopng', `http_${ifaceRes.status}`)
    return { ok: false, error: 'upstream_error' }
  }
  const iface = isObject(ifaceRes.json.rsp) ? ifaceRes.json.rsp : {}

  const topHosts: NetzwachtHost[] = []
  if (hostsRes.ok && isObject(hostsRes.json) && isObject(hostsRes.json.rsp)) {
    const data = hostsRes.json.rsp.data
    if (Array.isArray(data)) {
      for (const h of data) {
        if (!isObject(h)) continue
        const thpt = isObject(h.thpt) ? h.thpt : {}
        const bytes = isObject(h.bytes) ? h.bytes : {}
        topHosts.push({
          ip: str(h.ip),
          name: str(h.name),
          mac: str(h.mac),
          bps: num(thpt.bps),
          totalBytes: num(bytes.total),
          score: num(h.score),
        })
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
    topHosts,
  }
}

async function fetchSuricata(
  alertsUrl: string,
  token: string,
  maxAlerts: number,
  importantOnly: boolean,
  signal: AbortSignal,
): Promise<NetzwachtPayload['suricata']> {
  const base = normalizeBase(alertsUrl)
  // minsev=2: die Alarm-API filtert Info-Rauschen schon serverseitig heraus,
  // damit wichtige Meldungen nicht hinter den letzten N Info-Events verschwinden.
  const res = await fetchCheckedJson(`${base}/alerts?limit=${Math.max(50, maxAlerts)}&minsev=${importantOnly ? 2 : 0}`, {
    headers: { Accept: 'application/json', 'X-Api-Token': token },
    signal,
  })
  if (res.status === 401) {
    void logPluginApiFailure('netzwacht', 'alert-api-auth', 'token_rejected')
    return { ok: false, configured: true, error: 'alerts_auth_failed' }
  }
  if (!res.ok || !isObject(res.json)) {
    void logPluginApiFailure('netzwacht', 'alert-api', `http_${res.status}`)
    return { ok: false, configured: true, error: 'alerts_upstream_error' }
  }
  const summary = isObject(res.json.summary) ? res.json.summary : {}
  const h24raw = isObject(summary.h24) ? summary.h24 : {}
  const alerts: NetzwachtAlert[] = []
  if (Array.isArray(res.json.alerts)) {
    for (const a of res.json.alerts) {
      if (!isObject(a)) continue
      alerts.push({
        ts: str(a.ts),
        sig: str(a.sig),
        cat: str(a.cat),
        sev: num(a.sev) || 3,
        src: str(a.src),
        spt: a.spt == null ? null : num(a.spt),
        dst: str(a.dst),
        dpt: a.dpt == null ? null : num(a.dpt),
        proto: str(a.proto),
      })
    }
  }
  return {
    ok: true,
    configured: true,
    h24: {
      high: num(h24raw.high),
      medium: num(h24raw.medium),
      low: num(h24raw.low),
      total: num(h24raw.total),
    },
    latest: typeof summary.latest === 'string' ? summary.latest : null,
    alerts,
  }
}

async function handlePost(req: Request): Promise<Response> {
  let body: ReqBody
  try {
    body = (await req.json()) as ReqBody
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  let ntopngBase: string
  try {
    ntopngBase = normalizeBase(String(body.ntopngUrl ?? ''))
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'invalid_url' }, { status: 400 })
  }

  const username = String(body.username ?? '').trim()
  const password = openSealedSecret(String(body.password ?? '').trim())
  if (!username || !password) {
    return Response.json({ error: 'missing_credentials' }, { status: 400 })
  }

  const ifid = Math.max(0, num(body.ifid))
  const alertsUrl = String(body.alertsUrl ?? '').trim()
  const alertsToken = openSealedSecret(String(body.alertsToken ?? '').trim())
  const maxAlerts = Math.min(25, Math.max(1, num(body.maxAlerts) || 6))
  const importantOnly = body.importantOnly !== false

  const cacheKey = `${ntopngBase}|${ifid}|${alertsUrl}|${maxAlerts}|${importantOnly}|${username}`
  const cached = cache.get(cacheKey)
  if (cached) return Response.json(cached)

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)

  try {
    const auth = basicAuth(username, password)
    const [ntopngResult, suricataResult] = await Promise.allSettled([
      fetchNtopng(ntopngBase, auth, ifid, ac.signal),
      alertsUrl && alertsToken
        ? fetchSuricata(alertsUrl, alertsToken, maxAlerts, importantOnly, ac.signal)
        : Promise.resolve({ ok: false, configured: false } as NetzwachtPayload['suricata']),
    ])

    const payload: NetzwachtPayload = {
      ntopng:
        ntopngResult.status === 'fulfilled'
          ? ntopngResult.value
          : { ok: false, error: settleError(ntopngResult.reason) },
      suricata:
        suricataResult.status === 'fulfilled'
          ? suricataResult.value
          : { ok: false, configured: true, error: settleError(suricataResult.reason) },
    }
    if (payload.ntopng.ok || payload.suricata.ok) cache.set(cacheKey, payload)
    return Response.json(payload)
  } finally {
    clearTimeout(t)
  }
}

function settleError(e: unknown): string {
  if (e instanceof UnsafeOutboundUrlError) return 'blocked_url'
  if (e instanceof Error && e.name === 'AbortError') return 'timeout'
  void logPluginApiFailure('netzwacht', 'request', e instanceof Error ? e.message : String(e))
  return 'network_error'
}

// ---------------------------------------------------------------------------
// /ipinfo — Zusatzinfos zur Gegenstelle eines Alarms (rDNS, Geo, Statistik,
// CrowdSec-Status). Wird vom Detail-Popup des Widgets abgerufen.
// ---------------------------------------------------------------------------

const ipInfoCache = createPluginServerCache({ ttlMs: 10 * 60_000, maxEntries: 64 })

function isPrivateIp(ip: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.|fe80:|fd|::1)/i.test(ip)
}

function isValidIp(ip: string): boolean {
  return /^[0-9a-fA-F.:]{3,45}$/.test(ip)
}

async function lookupRdns(ip: string): Promise<string | null> {
  try {
    const dns = await import('node:dns/promises')
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ])
    return Array.isArray(names) && names.length > 0 ? names[0] : null
  } catch {
    return null
  }
}

type GeoInfo = { country: string; countryCode: string; city: string; isp: string; org: string; as: string } | null

async function lookupGeo(ip: string, signal: AbortSignal): Promise<GeoInfo> {
  try {
    const res = await fetchCheckedJson(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,city,isp,org,as`,
      { headers: { Accept: 'application/json' }, signal },
    )
    if (!res.ok || !isObject(res.json) || res.json.status !== 'success') return null
    const g = res.json
    return {
      country: str(g.country),
      countryCode: str(g.countryCode),
      city: str(g.city),
      isp: str(g.isp),
      org: str(g.org),
      as: str(g.as),
    }
  } catch {
    return null
  }
}

type CrowdsecInfo = { banned: boolean; scenario: string; until: string } | null

async function lookupCrowdsec(ip: string): Promise<CrowdsecInfo> {
  try {
    const [{ default: Database }, fs] = await Promise.all([import('better-sqlite3'), import('node:fs')])
    const dbPath = process.env.CROWDSEC_DB_PATH || '/crowdsec-data/crowdsec.db'
    if (!fs.existsSync(dbPath)) return null
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const row = db
        .prepare(
          "SELECT scenario, until FROM decisions WHERE value = ? AND (until IS NULL OR until > datetime('now')) ORDER BY until DESC LIMIT 1",
        )
        .get(ip) as { scenario?: string; until?: string } | undefined
      return { banned: Boolean(row), scenario: str(row?.scenario), until: str(row?.until) }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

async function lookupAlertStats(
  alertsUrl: string,
  token: string,
  ip: string,
  sig: string,
  signal: AbortSignal,
): Promise<{ ip24h: number; sig24h: number } | null> {
  try {
    const base = normalizeBase(alertsUrl)
    const res = await fetchCheckedJson(
      `${base}/stats?ip=${encodeURIComponent(ip)}&sig=${encodeURIComponent(sig)}`,
      { headers: { Accept: 'application/json', 'X-Api-Token': token }, signal },
    )
    if (!res.ok || !isObject(res.json)) return null
    return { ip24h: num(res.json.ip24h), sig24h: num(res.json.sig24h) }
  } catch {
    return null
  }
}

async function handleIpInfoPost(req: Request): Promise<Response> {
  let body: { ip?: string; sig?: string; alertsUrl?: string; alertsToken?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const ip = String(body.ip ?? '').trim()
  if (!isValidIp(ip)) return Response.json({ error: 'invalid_ip' }, { status: 400 })
  const sig = String(body.sig ?? '').trim().slice(0, 200)
  const alertsUrl = String(body.alertsUrl ?? '').trim()
  const alertsToken = openSealedSecret(String(body.alertsToken ?? '').trim())
  const pub = !isPrivateIp(ip)

  const cacheKey = `ipinfo|${ip}|${sig}`
  const cached = ipInfoCache.get(cacheKey)
  if (cached) return Response.json(cached)

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 8000)
  try {
    const [rdns, geo, crowdsec, stats] = await Promise.all([
      pub ? lookupRdns(ip) : Promise.resolve(null),
      pub ? lookupGeo(ip, ac.signal) : Promise.resolve(null),
      pub ? lookupCrowdsec(ip) : Promise.resolve(null),
      alertsUrl && alertsToken ? lookupAlertStats(alertsUrl, alertsToken, ip, sig, ac.signal) : Promise.resolve(null),
    ])
    const payload = { ip, isPublic: pub, rdns, geo, crowdsec, stats }
    ipInfoCache.set(cacheKey, payload)
    return Response.json(payload)
  } finally {
    clearTimeout(t)
  }
}

async function handleNetzwachtPluginRequest(req: Request, path: string[]): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  if (path[0] === 'ipinfo') return handleIpInfoPost(req)
  return handlePost(req)
}

export default function netzwachtServerHandler(ctx: PluginServerContext): Promise<Response> {
  return handleNetzwachtPluginRequest(ctx.request, ctx.path)
}
