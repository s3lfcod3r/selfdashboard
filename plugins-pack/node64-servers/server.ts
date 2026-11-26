import { handleNode64, n64Arr, n64Get, n64Num, n64Obj, n64Str, type Node64Conn } from '../_shared/node64'
import type { PluginServerContext } from '../_shared/plugin-server-types'

export const dynamic = 'force-dynamic'

export type ServerHost = {
  id: string
  name: string
  address: string
  group: string
  state: string
  offline: boolean
  problems: number
  services: number
  cpu: number | null
  ram: number | null
  meters: { label: string; value: number; state: string }[]
}

export type ServersPayload = {
  counts: { ok: number; warn: number; crit: number; unknown: number }
  hosts: ServerHost[]
}

async function work(conn: Node64Conn, _b: unknown, signal: AbortSignal): Promise<ServersPayload> {
  const ov = n64Obj(await n64Get(conn, '/monitor64/overview', signal))
  const c = n64Obj(ov.counts)
  const hosts: ServerHost[] = n64Arr(ov.hosts).map((x) => {
    const h = n64Obj(x)
    return {
      id: n64Str(h.uid, 40),
      name: n64Str(h.name, 100),
      address: n64Str(h.address, 100),
      group: n64Str(h.group, 64),
      state: n64Str(h.state, 20) || 'unknown',
      offline: n64Str(h.view, 20) === 'offline',
      problems: n64Num(h.problems),
      services: n64Num(h.services),
      cpu: h.has_cpu === true ? Math.round(n64Num(h.cpu)) : null,
      ram: h.has_ram === true ? Math.round(n64Num(h.ram)) : null,
      meters: n64Arr(h.meters)
        .map(n64Obj)
        .filter((m) => !['cpu', 'ram'].includes(n64Str(m.label, 30)))
        .slice(0, 4)
        .map((m) => ({ label: n64Str(m.label, 30), value: Math.round(n64Num(m.value)), state: n64Str(m.state, 20) })),
    }
  })
  return {
    counts: { ok: n64Num(c.ok), warn: n64Num(c.warn), crit: n64Num(c.crit), unknown: n64Num(c.unknown) },
    hosts,
  }
}

export default function node64ServersServer(ctx: PluginServerContext): Promise<Response> {
  return handleNode64('node64-servers', ctx.request, work)
}
