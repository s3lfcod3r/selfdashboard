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
  signal: AbortSignal,
): Promise<NetzwachtPayload['suricata']> {
  const base = normalizeBase(alertsUrl)
  // Immer genug holen, damit das Widget nach Wichtigkeit filtern kann.
  const res = await fetchCheckedJson(`${base}/alerts?limit=${Math.max(50, maxAlerts)}`, {
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

  const cacheKey = `${ntopngBase}|${ifid}|${alertsUrl}|${maxAlerts}|${username}`
  const cached = cache.get(cacheKey)
  if (cached) return Response.json(cached)

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)

  try {
    const auth = basicAuth(username, password)
    const [ntopngResult, suricataResult] = await Promise.allSettled([
      fetchNtopng(ntopngBase, auth, ifid, ac.signal),
      alertsUrl && alertsToken
        ? fetchSuricata(alertsUrl, alertsToken, maxAlerts, ac.signal)
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

async function handleNetzwachtPluginRequest(req: Request, _path: string[]): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  return handlePost(req)
}

export default function netzwachtServerHandler(ctx: PluginServerContext): Promise<Response> {
  return handleNetzwachtPluginRequest(ctx.request, ctx.path)
}
