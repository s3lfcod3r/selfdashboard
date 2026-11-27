import { handleNode64, n64Arr, n64Get, n64Num, n64Obj, n64Str, n64Try, type Node64Conn } from '../_shared/node64'
import type { PluginServerContext } from '../_shared/plugin-server-types'

export const dynamic = 'force-dynamic'

export type ProxyHost = {
  id: number
  name: string
  extra: number
  kind: string
  enabled: boolean
  reach: string
  ms: number | null
  requests: number
  errors: number
  blocked: number
  certDays: number | null
  certState: string
}

export type ProxyPayload = {
  hosts: ProxyHost[]
  totals: { requests: number; blocked: number; decoy: number; errors: number; bytes: number }
  timeline: { total: number; part: number }[]
}

/**
 * Ohne eigene Erreichbarkeitsprüfung (z. B. reine WebSocket-Dienste mit
 * „Ziel nicht prüfen") zählt der verknüpfte Healthcheck.
 */
function reachState(own: string, hcs: Record<string, unknown>[]): string {
  if (own && own !== 'unknown') return own
  const states = hcs.filter((c) => c.paused !== true).map((c) => n64Str(c.state, 20))
  if (states.includes('down')) return 'down'
  if (states.includes('up')) return 'up'
  return 'unknown'
}

async function work(conn: Node64Conn, _b: unknown, signal: AbortSignal): Promise<ProxyPayload> {
  const [hostsRaw, statsRaw] = await Promise.all([
    n64Get(conn, '/cdn64/hosts', signal),
    n64Try(n64Get(conn, '/cdn64/stats?hours=24', signal), {}),
  ])
  const hosts: ProxyHost[] = n64Arr(hostsRaw).map((x) => {
    const h = n64Obj(x)
    const reach = n64Obj(h.reach)
    const st = n64Obj(h.stats)
    const cert = n64Obj(h.certificate)
    const names = n64Arr(h.names).map((n) => n64Str(n, 120))
    const days = Number(cert.days_left)
    const ms = Number(reach.ms)
    return {
      id: n64Num(h.id),
      name: names[0] ?? '?',
      extra: Math.max(0, names.length - 1),
      kind: n64Str(h.kind, 20),
      enabled: h.enabled !== false,
      reach: reachState(n64Str(reach.state, 20), n64Arr(h.healthchecks).map(n64Obj)),
      ms: Number.isFinite(ms) && n64Str(reach.state) === 'up' ? ms : null,
      requests: n64Num(st.requests),
      errors: n64Num(st.errors),
      blocked: n64Num(st.blocked),
      certDays: Number.isFinite(days) && cert.state ? days : null,
      certState: n64Str(cert.state, 20),
    }
  })
  const stats = n64Obj(statsRaw)
  const tl = n64Arr(stats.timeline).map(n64Obj)
  const totals = { requests: 0, blocked: 0, decoy: 0, errors: 0, bytes: 0 }
  for (const b of tl) {
    totals.requests += n64Num(b.requests)
    totals.blocked += n64Num(b.blocked) + n64Num(b.conn_blocked)
    totals.decoy += n64Num(b.decoy)
    totals.errors += n64Num(b['5xx'])
    totals.bytes += n64Num(b.bytes)
  }
  return {
    hosts,
    totals,
    timeline: tl.map((b) => ({ total: n64Num(b.requests), part: n64Num(b.blocked) + n64Num(b.decoy) })),
  }
}

export default function node64ProxyServer(ctx: PluginServerContext): Promise<Response> {
  return handleNode64('node64-proxy', ctx.request, work)
}
