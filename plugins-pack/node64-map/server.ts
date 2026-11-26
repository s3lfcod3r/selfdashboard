/**
 * Angriffskarte aus Honeypot64 (+ Sperren aus PROXY64).
 * Bewusst NICHT weitergegeben: Benutzernamen, Passwörter und Zugangsdaten aus
 * /honeypot/stats (top_users, top_passwords, top_credentials) – die könnten
 * echte Zugangsdaten aus dem eigenen Netz enthalten.
 */
import { handleNode64, n64Arr, n64Get, n64Num, n64Obj, n64Str, n64Try, type Node64Conn } from '../_shared/node64'
import type { PluginServerContext } from '../_shared/plugin-server-types'

export const dynamic = 'force-dynamic'

export type MapPoint = { cc: string; count: number; severity: 'crit' | 'warn' | 'info' }

export type MapPayload = {
  range: string
  home: string
  attacks: number
  sources: number
  countries: number
  banned: number
  points: MapPoint[]
  recent: { t: number; cc: string; ip: string; kind: string; port: number }[]
}

type Body = { range?: string }

function kindGroup(kind: string, group: string): string {
  if (group === 'login' || /bruteforce|login|auth/.test(kind)) return 'login'
  if (/exploit|rce|traversal|inject/.test(kind)) return 'exploit'
  if (group === 'scan' || /scan|probe/.test(kind)) return 'scan'
  return 'other'
}

function severity(kinds: Set<string>): MapPoint['severity'] {
  if (kinds.has('exploit') || kinds.has('login')) return 'crit'
  if (kinds.has('scan')) return 'warn'
  return 'info'
}

async function work(conn: Node64Conn, body: Body, signal: AbortSignal): Promise<MapPayload> {
  const range = ['1h', '24h', '7d'].includes(String(body.range)) ? String(body.range) : '24h'
  const minutes = range === '1h' ? 60 : 1440
  const [live, stats, hp] = await Promise.all([
    n64Get(conn, `/honeypot/live?minutes=${minutes}`, signal),
    range === '1h' ? Promise.resolve({}) : n64Try(n64Get(conn, `/honeypot/stats?since=${range}&top=60`, signal), {}),
    n64Try(n64Get(conn, '/cdn64/honeypot', signal), {}),
  ])
  const lv = n64Obj(live)
  const events = n64Arr(lv.events).map(n64Obj)
  const kindsByCc = new Map<string, Set<string>>()
  const liveCount = new Map<string, number>()
  const ips = new Set<string>()
  for (const e of events) {
    const cc = n64Str(e.cc, 2).toUpperCase()
    if (!/^[A-Z]{2}$/.test(cc)) continue
    const g = kindGroup(n64Str(e.kind, 40), n64Str(e.group, 20))
    kindsByCc.set(cc, (kindsByCc.get(cc) ?? new Set()).add(g))
    liveCount.set(cc, (liveCount.get(cc) ?? 0) + 1)
    ips.add(n64Str(e.ip, 64))
  }
  const st = n64Obj(stats)
  const byCountry = n64Arr(st.by_country).map(n64Obj)
  const counts = new Map<string, number>()
  if (range === '1h' || !byCountry.length) for (const [cc, n] of liveCount) counts.set(cc, n)
  else
    for (const c of byCountry) {
      const cc = n64Str(c.key, 2).toUpperCase()
      if (/^[A-Z]{2}$/.test(cc)) counts.set(cc, n64Num(c.count))
    }
  const points: MapPoint[] = [...counts.entries()]
    .map(([cc, count]) => ({ cc, count, severity: severity(kindsByCc.get(cc) ?? new Set()) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 80)
  const recent = events.slice(0, 12).map((e) => ({
    t: n64Num(e.t),
    cc: n64Str(e.cc, 2).toUpperCase(),
    ip: n64Str(e.ip, 64),
    kind: kindGroup(n64Str(e.kind, 40), n64Str(e.group, 20)),
    port: n64Num(e.port),
  }))
  const blocks = n64Arr(n64Obj(hp).blocks)
  return {
    range,
    home: n64Str(n64Obj(lv.target).cc, 2).toUpperCase() || 'DE',
    attacks: range === '1h' || !byCountry.length ? events.length : n64Num(st.events),
    sources: range === '1h' || !byCountry.length ? ips.size : n64Num(st.sources),
    countries: counts.size,
    banned: blocks.length,
    points,
    recent,
  }
}

export default function node64MapServer(ctx: PluginServerContext): Promise<Response> {
  return handleNode64<Body>('node64-map', ctx.request, work)
}
