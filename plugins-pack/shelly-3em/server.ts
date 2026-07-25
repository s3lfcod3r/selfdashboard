/**
 * Shelly Pro 3EM (and 3EM) — 3-phase whole-house measurement over the local
 * RPC API. Reads EM.GetStatus (live per-phase power/voltage/current + signed
 * total) and EMData.GetStatus (cumulative import/export energy counters).
 *
 * Endpoint: POST /api/plugins/shelly-3em  (login-gated by the host).
 * No cloud, no API key — talks straight to the device on the LAN.
 */
import { logPluginApiFailure } from '../_shared/log'
import { openSealedSecret } from '../_shared/secret-crypto'
import type { PluginServerContext } from '../_shared/plugin-server-types'
import {
  energyWindows,
  mapShellyError,
  normalizeShellyBase,
  num,
  parseDevices,
  recordEnergy,
  type ShellyDevice,
  shellyRpc,
  SHELLY_TIMEOUT_MS,
  str,
} from '../_shared/shelly'

export const dynamic = 'force-dynamic'

const PLUGIN_ID = 'shelly-3em'
const MAX_DEVICES = 8

type ReqBody = {
  devices?: unknown
  password?: string
  track?: boolean
}

type PhaseReading = { v: number | null; i: number | null; p: number | null }

type EnergyReading = {
  importToday: number
  importWeek: number
  importMonth: number
  exportToday: number
  exportWeek: number
  exportMonth: number
}

type DeviceResult = {
  id: string
  name: string
  online: boolean
  totalPower: number | null
  totalCurrent: number | null
  phases: PhaseReading[]
  energy?: EnergyReading
  error?: string
}

/** Sum a set of possibly-missing numeric fields; null if none are present. */
function sumFields(obj: Record<string, unknown>, keys: string[]): number | null {
  let total = 0
  let seen = false
  for (const k of keys) {
    const n = num(obj[k])
    if (n != null) {
      total += n
      seen = true
    }
  }
  return seen ? total : null
}

const PHASE_KEYS = ['a', 'b', 'c'] as const

function parsePhases(em: Record<string, unknown>): PhaseReading[] {
  return PHASE_KEYS.map((ph) => ({
    v: num(em[`${ph}_voltage`]),
    i: num(em[`${ph}_current`]),
    p: num(em[`${ph}_act_power`]),
  }))
}

/** Import/export Wh from EMData: prefer the totals, fall back to per-phase sums. */
function parseCounters(emData: Record<string, unknown>): { imp: number | null; exp: number | null } {
  const imp =
    num(emData.total_act) ??
    sumFields(emData, ['a_total_act_energy', 'b_total_act_energy', 'c_total_act_energy'])
  const exp =
    num(emData.total_act_ret) ??
    sumFields(emData, ['a_total_act_ret_energy', 'b_total_act_ret_energy', 'c_total_act_ret_energy'])
  return { imp, exp }
}

async function readDevice(
  dev: ShellyDevice,
  password: string,
  track: boolean,
  signal: AbortSignal,
): Promise<{ result: DeviceResult; counters: { imp: number | null; exp: number | null } }> {
  const base = normalizeShellyBase(dev.ip)
  const em = await shellyRpc<Record<string, unknown>>(base, 'EM.GetStatus?id=0', password, signal)

  const result: DeviceResult = {
    id: dev.id,
    name: dev.name,
    online: true,
    totalPower: num(em.total_act_power),
    totalCurrent: num(em.total_current),
    phases: parsePhases(em),
  }

  let counters: { imp: number | null; exp: number | null } = { imp: null, exp: null }
  // Energy counters live in a separate call; if it fails we still return live power.
  if (track) {
    try {
      const emData = await shellyRpc<Record<string, unknown>>(base, 'EMData.GetStatus?id=0', password, signal)
      counters = parseCounters(emData)
    } catch (e) {
      const code = mapShellyError(e)
      if (code !== 'timeout') void logPluginApiFailure(PLUGIN_ID, 'energy', `${code}:${dev.id}`)
    }
    result.energy = {
      importToday: 0,
      importWeek: 0,
      importMonth: 0,
      exportToday: 0,
      exportWeek: 0,
      exportMonth: 0,
    }
  }

  return { result, counters }
}

async function handlePost(req: Request): Promise<Response> {
  let body: ReqBody
  try {
    body = (await req.json()) as ReqBody
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const devices = parseDevices(body.devices, MAX_DEVICES)
  if (devices.length === 0) {
    return Response.json({ error: 'no_devices' }, { status: 400 })
  }
  const password = openSealedSecret(str(body.password))
  const track = body.track === true

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), SHELLY_TIMEOUT_MS)
  try {
    const settled = await Promise.all(
      devices.map(async (dev) => {
        try {
          return await readDevice(dev, password, track, ac.signal)
        } catch (e) {
          const code = mapShellyError(e)
          if (code !== 'timeout') void logPluginApiFailure(PLUGIN_ID, 'status', `${code}:${dev.id}`)
          const result: DeviceResult = {
            id: dev.id,
            name: dev.name,
            online: false,
            totalPower: null,
            totalCurrent: null,
            phases: [],
            error: code,
          }
          return { result, counters: { imp: null, exp: null } }
        }
      }),
    )

    // Persist all counters in one write to avoid file races between devices.
    if (track) {
      const samples: Record<string, Record<string, number>> = {}
      for (const { result, counters } of settled) {
        const c: Record<string, number> = {}
        if (counters.imp != null) c.imp = counters.imp
        if (counters.exp != null) c.exp = counters.exp
        if (Object.keys(c).length > 0) samples[result.id] = c
      }
      if (Object.keys(samples).length > 0) recordEnergy(PLUGIN_ID, samples)

      // Fill in the windowed figures after recording so today's latest sample counts.
      for (const { result } of settled) {
        if (!result.energy) continue
        const imp = energyWindows(PLUGIN_ID, result.id, 'imp')
        const exp = energyWindows(PLUGIN_ID, result.id, 'exp')
        result.energy = {
          importToday: imp.today,
          importWeek: imp.week,
          importMonth: imp.month,
          exportToday: exp.today,
          exportWeek: exp.week,
          exportMonth: exp.month,
        }
      }
    }

    return Response.json({ devices: settled.map((s) => s.result) })
  } finally {
    clearTimeout(timer)
  }
}

export default function shelly3emServerHandler(ctx: PluginServerContext): Promise<Response> {
  if (ctx.request.method !== 'POST') {
    return Promise.resolve(Response.json({ error: 'method_not_allowed' }, { status: 405 }))
  }
  return handlePost(ctx.request)
}
