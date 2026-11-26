import {
  Node64Error,
  handleNode64,
  n64Arr,
  n64Get,
  n64Num,
  n64Obj,
  n64Post,
  n64Str,
  n64Try,
  type Node64Conn,
} from '../_shared/node64'
import { openSealedSecret } from '../_shared/secret-crypto'
import type { PluginServerContext } from '../_shared/plugin-server-types'

export const dynamic = 'force-dynamic'

const RANGES = ['1h', '24h', '7d'] as const

export type DnsPayload = {
  total: number
  blocked: number
  clients: number
  avgMs: number
  listSize: number
  paused: boolean
  pausedUntil: string
  timeline: { t: number; total: number; blocked: number }[]
  topBlocked: { name: string; count: number }[]
  topClients: { name: string; host: string; count: number; blocked: number }[]
  ok?: boolean
}

type Body = { range?: string; action?: string; adminKey?: string }

/** Bei 7 Tagen sind die Zahlen der Zusammenfassung zu kurz – Summe aus dem Verlauf. */
function sumTimeline(tl: DnsPayload['timeline']): { total: number; blocked: number } {
  return tl.reduce((a, b) => ({ total: a.total + b.total, blocked: a.blocked + b.blocked }), { total: 0, blocked: 0 })
}

async function action(conn: Node64Conn, body: Body, signal: AbortSignal): Promise<{ ok: true }> {
  const admin = openSealedSecret(n64Str(body.adminKey, 300).trim())
  if (!admin) throw new Node64Error('forbidden', 403)
  if (!/^node64_[A-Za-z0-9_-]{8,}$/.test(admin)) throw new Node64Error('invalid_key', 400)
  const adminConn = { base: conn.base, key: admin }
  if (body.action === 'pause') await n64Post(adminConn, '/dns64/pause', signal, { minutes: 10 })
  else if (body.action === 'resume') await n64Post(adminConn, '/dns64/resume', signal, {})
  else throw new Node64Error('invalid_action', 400)
  return { ok: true }
}

async function work(conn: Node64Conn, body: Body, signal: AbortSignal): Promise<DnsPayload | { ok: true }> {
  if (body.action) return action(conn, body, signal)
  const range = (RANGES as readonly string[]).includes(String(body.range)) ? String(body.range) : '24h'
  const [summary, status, timeline, topB, topC] = await Promise.all([
    n64Get(conn, '/dns64/summary', signal),
    n64Try(n64Get(conn, '/dns64/status', signal), {}),
    n64Try(n64Get(conn, `/dns64/timeline?range=${range}`, signal), {}),
    n64Try(n64Get(conn, `/dns64/top/list?kind=blocked&range=${range}&limit=8`, signal), {}),
    n64Try(n64Get(conn, `/dns64/top/list?kind=clients&range=${range}&limit=6`, signal), {}),
  ])
  const sum = n64Obj(n64Obj(summary).summary)
  const block = n64Obj(n64Obj(status).blocking)
  const tl = n64Arr(n64Obj(timeline).buckets)
    .map(n64Obj)
    .map((b) => ({ t: n64Num(b.t), total: n64Num(b.total), blocked: n64Num(b.blocked) }))
  const totals = range === '24h' ? { total: n64Num(sum.total), blocked: n64Num(sum.blocked) } : sumTimeline(tl)
  return {
    total: totals.total,
    blocked: totals.blocked,
    clients: n64Num(sum.clients),
    avgMs: Math.round(n64Num(sum.avgUpstreamMs) * 10) / 10,
    listSize: n64Num(n64Obj(summary).blocklistSize),
    paused: block.paused === true,
    pausedUntil: block.until_resumed === true ? '' : n64Str(block.paused_until, 40),
    timeline: tl,
    topBlocked: n64Arr(n64Obj(topB).items)
      .map(n64Obj)
      .map((i) => ({ name: n64Str(i.name, 120), count: n64Num(i.count) })),
    topClients: n64Arr(n64Obj(topC).items)
      .map(n64Obj)
      .map((i) => ({
        name: n64Str(i.name, 60),
        host: n64Str(i.hostname, 80).replace(/\.fritz\.box$/i, ''),
        count: n64Num(i.count),
        blocked: n64Num(i.blocked),
      })),
  }
}

export default function node64DnsServer(ctx: PluginServerContext): Promise<Response> {
  return handleNode64<Body>('node64-dns', ctx.request, work)
}
