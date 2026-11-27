import { handleNode64, n64Arr, n64Get, n64Num, n64Obj, n64Str, n64Try, type Node64Conn } from '../_shared/node64'
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
  gpu: { util: number; memUsed: number; memTotal: number; temp: number; power: number; fan: number } | null
}

export type ServersPayload = {
  counts: { ok: number; warn: number; crit: number; unknown: number }
  hosts: ServerHost[]
}

async function work(conn: Node64Conn, _b: unknown, signal: AbortSignal): Promise<ServersPayload> {
  const ov = n64Obj(await n64Get(conn, '/monitor64/overview', signal))
  const c = n64Obj(ov.counts)
  // Quittierte Probleme nicht mehr als Problem zählen.
  const open = new Map<string, number>()
  for (const p of n64Arr(ov.problems).map(n64Obj)) {
    if (p.acked === true) continue
    const uid = n64Str(p.host_uid, 40)
    open.set(uid, (open.get(uid) ?? 0) + 1)
  }
  const hosts: ServerHost[] = n64Arr(ov.hosts).map((x) => {
    const h = n64Obj(x)
    const uid = n64Str(h.uid, 40)
    const unacked = open.get(uid) ?? 0
    const raw = n64Str(h.state, 20) || 'unknown'
    return {
      id: uid,
      name: n64Str(h.name, 100),
      address: n64Str(h.address, 100),
      group: n64Str(h.group, 64),
      state: (raw === 'warn' || raw === 'crit') && unacked === 0 ? 'ok' : raw,
      offline: n64Str(h.view, 20) === 'offline',
      problems: unacked,
      services: n64Num(h.services),
      cpu: h.has_cpu === true ? Math.round(n64Num(h.cpu)) : null,
      ram: h.has_ram === true ? Math.round(n64Num(h.ram)) : null,
      meters: n64Arr(h.meters)
        .map(n64Obj)
        .filter((m) => !['cpu', 'ram'].includes(n64Str(m.label, 30)))
        .slice(0, 4)
        .map((m) => ({ label: n64Str(m.label, 30), value: Math.round(n64Num(m.value)), state: n64Str(m.state, 20) })),
      gpu: null,
    }
  })
  // GPU-Werte (NVIDIA, über einen Prometheus-Exporter in Monitor64) aus den Host-Details.
  await Promise.all(
    hosts
      .filter((h) => !h.offline && h.id)
      .map(async (h) => {
        const d = n64Obj(await n64Try(n64Get(conn, `/monitor64/hosts/${encodeURIComponent(h.id)}`, signal), {}))
        const v = (metric: string): number | null => {
          const svc = n64Arr(d.services)
            .map(n64Obj)
            .find((x) => n64Str(x.key, 300).startsWith(`prom:nvidia_smi_${metric}`))
          if (!svc) return null
          const m = n64Arr(svc.metrics).map(n64Obj)[0]
          return m ? n64Num(m.value) : null
        }
        const util = v('utilization_gpu_ratio')
        if (util === null) return
        h.gpu = {
          util: Math.round(util),
          memUsed: v('memory_used_bytes') ?? 0,
          memTotal: v('memory_total_bytes') ?? 0,
          temp: Math.round(v('temperature_gpu') ?? 0),
          power: Math.round((v('power_draw_watts') ?? 0) * 10) / 10,
          fan: Math.round(v('fan_speed_ratio') ?? 0),
        }
      }),
  )
  // Reihenfolge nach Adresse (192.168.1.2 vor .3), ausgeschaltete Hosts zuletzt.
  const ipKey = (a: string) => a.split('.').map((p) => p.padStart(3, '0')).join('.')
  hosts.sort((a, b) => Number(a.offline) - Number(b.offline) || ipKey(a.address).localeCompare(ipKey(b.address)))
  return {
    counts: { ok: n64Num(c.ok), warn: n64Num(c.warn), crit: n64Num(c.crit), unknown: n64Num(c.unknown) },
    hosts,
  }
}

export default function node64ServersServer(ctx: PluginServerContext): Promise<Response> {
  return handleNode64('node64-servers', ctx.request, work)
}
