import { handleNode64, n64Arr, n64Get, n64Obj, n64Str, n64Try, type Node64Conn } from '../_shared/node64'
import type { PluginServerContext } from '../_shared/plugin-server-types'

export const dynamic = 'force-dynamic'

export type CheckRow = {
  id: string
  name: string
  group: string
  type: string
  state: string
  latency: number | null
  message: string
  since: string
}

export type ChecksPayload = {
  checks: CheckRow[]
  incidents: { name: string; reason: string; started: string }[]
  counts: { up: number; down: number; paused: number; other: number; total: number }
  update: string
  modules: { running: number; enabled: number }
}

function stateOf(c: Record<string, unknown>): string {
  if (c.paused === true) return 'paused'
  const s = n64Obj(c.state)
  if (s.maintenance === true) return 'maintenance'
  const v = n64Str(s.state, 20)
  return ['up', 'down', 'degraded', 'paused', 'stabilizing', 'pending'].includes(v) ? v : 'pending'
}

async function work(conn: Node64Conn, _b: unknown, signal: AbortSignal): Promise<ChecksPayload> {
  const [checksRaw, incRaw, overview] = await Promise.all([
    n64Get(conn, '/checks', signal),
    n64Try(n64Get(conn, '/incidents?limit=30', signal), []),
    n64Try(n64Get(conn, '/overview', signal), {}),
  ])
  const names = new Map<string, string>()
  const checks: CheckRow[] = n64Arr(checksRaw).map((x) => {
    const c = n64Obj(x)
    const s = n64Obj(c.state)
    const id = n64Str(c.token, 64)
    const name = n64Str(c.name, 100)
    names.set(id, name)
    const lat = Number(s.last_latency_ms)
    return {
      id,
      name,
      group: n64Str(c.group, 100),
      type: n64Str(c.type, 20),
      state: stateOf(c),
      latency: Number.isFinite(lat) && lat > 0 ? Math.round(lat * 10) / 10 : null,
      message: n64Str(s.last_message, 120),
      since: n64Str(s.since, 40),
    }
  })
  const counts = { up: 0, down: 0, paused: 0, other: 0, total: checks.length }
  for (const c of checks) {
    if (c.state === 'up') counts.up++
    else if (c.state === 'down' || c.state === 'degraded') counts.down++
    else if (c.state === 'paused' || c.state === 'maintenance') counts.paused++
    else counts.other++
  }
  const pausedIds = new Set(checks.filter((c) => c.state === 'paused').map((c) => c.id))
  const incidents = n64Arr(incRaw)
    .map(n64Obj)
    .filter((i) => i.open === true && !pausedIds.has(n64Str(i.token, 64)))
    .slice(0, 10)
    .map((i) => ({
      name: names.get(n64Str(i.token, 64)) ?? '?',
      reason: n64Str(i.message, 120) || n64Str(i.reason, 40),
      started: n64Str(i.started_at, 40),
    }))
  const ov = n64Obj(overview)
  const upd = n64Obj(ov.update)
  const mods = n64Arr(ov.modules).map(n64Obj)
  return {
    checks,
    incidents,
    counts,
    update: upd.newer === true ? n64Str(upd.version, 20) : '',
    modules: {
      running: mods.filter((m) => m.running === true).length,
      enabled: mods.filter((m) => m.enabled === true).length,
    },
  }
}

export default function node64ChecksServer(ctx: PluginServerContext): Promise<Response> {
  return handleNode64('node64-checks', ctx.request, work)
}
