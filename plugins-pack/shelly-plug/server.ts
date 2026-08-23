/**
 * Shelly Plug (PM Gen3 / Plug S Gen3 and other Gen2+ single-switch devices) —
 * per-socket power monitoring and on/off control over the local RPC API.
 *
 * Endpoint: POST /api/plugins/shelly-plug  (login-gated by the host — every
 * plugin API call passes requirePluginAccess before reaching this handler).
 * No cloud, no API key.
 *
 * Body actions:
 *   { action?: 'status', devices, password?, track? }  → live readings for all
 *   { action: 'switch', device, on, password? }         → set one socket on/off
 *
 * `password` is the plugin-wide fallback. A device entry may carry its own
 * `password`, which wins — sockets on different passwords work in one widget.
 * Both are plaintext-at-rest (pack plugins are excluded from the host's seal
 * allowlist) but only reachable by logged-in dashboard users.
 */
import { logPluginApiFailure } from '../_shared/log'
import { openSealedSecret } from '../_shared/secret-crypto'
import type { PluginServerContext } from '../_shared/plugin-server-types'
import {
  DAY_MS,
  mapShellyError,
  normalizeShellyBase,
  num,
  parseDevices,
  parseOneDevice,
  recordEnergy,
  type ShellyDevice,
  shellyRpc,
  SHELLY_TIMEOUT_MS,
  startOfMonth,
  startOfToday,
  str,
  windowsKwh,
} from '../_shared/shelly'

export const dynamic = 'force-dynamic'

const PLUGIN_ID = 'shelly-plug'
const MAX_DEVICES = 16

type ReqBody = {
  action?: 'status' | 'switch'
  devices?: unknown
  device?: unknown
  on?: unknown
  password?: string
  track?: boolean
}

/**
 * kWh per window. `month` is the CALENDAR month (resets on the 1st), not a
 * rolling 30 days — that is what lines up with an electricity bill.
 */
type EnergyReading = { today: number; week: number; month: number }

type DeviceResult = {
  id: string
  name: string
  online: boolean
  output: boolean | null
  power: number | null
  voltage: number | null
  current: number | null
  tempC: number | null
  energy?: EnergyReading
  error?: string
}

/**
 * The password to use for one device: its own if configured, otherwise the
 * plugin-wide one. Run through openSealedSecret either way — it returns sealed
 * values decrypted and plaintext unchanged, so this keeps working whichever way
 * the host stores them.
 */
function devicePassword(dev: ShellyDevice, fallback: string): string {
  return dev.password ? openSealedSecret(dev.password) : fallback
}

/** Switch.GetStatus → readings + the cumulative Wh counter for history. */
async function readDevice(
  dev: ShellyDevice,
  password: string,
  signal: AbortSignal,
): Promise<{ result: DeviceResult; energyWh: number | null }> {
  const base = normalizeShellyBase(dev.ip)
  const st = await shellyRpc<Record<string, unknown>>(base, 'Switch.GetStatus?id=0', password, signal)

  const aenergy = (st.aenergy ?? {}) as Record<string, unknown>
  const temperature = (st.temperature ?? {}) as Record<string, unknown>

  const result: DeviceResult = {
    id: dev.id,
    name: dev.name,
    online: true,
    output: typeof st.output === 'boolean' ? st.output : null,
    power: num(st.apower),
    voltage: num(st.voltage),
    current: num(st.current),
    tempC: num(temperature.tC),
  }
  return { result, energyWh: num(aenergy.total) }
}

async function handleStatus(devices: ShellyDevice[], password: string, track: boolean, signal: AbortSignal): Promise<Response> {
  const settled = await Promise.all(
    devices.map(async (dev) => {
      try {
        return await readDevice(dev, devicePassword(dev, password), signal)
      } catch (e) {
        const code = mapShellyError(e)
        if (code !== 'timeout') void logPluginApiFailure(PLUGIN_ID, 'status', `${code}:${dev.id}`)
        const result: DeviceResult = {
          id: dev.id,
          name: dev.name,
          online: false,
          output: null,
          power: null,
          voltage: null,
          current: null,
          tempC: null,
          error: code,
        }
        return { result, energyWh: null }
      }
    }),
  )

  if (track) {
    const samples: Record<string, Record<string, number>> = {}
    for (const { result, energyWh } of settled) {
      if (energyWh != null) samples[result.id] = { e: energyWh }
    }
    if (Object.keys(samples).length > 0) recordEnergy(PLUGIN_ID, samples)
    // One history read per device covering all three windows — see windowsKwh.
    const now = Date.now()
    const since = { today: startOfToday(), week: now - 7 * DAY_MS, month: startOfMonth() }
    for (const { result } of settled) {
      if (!result.online) continue
      result.energy = windowsKwh(PLUGIN_ID, result.id, 'e', since)
    }
  }

  return Response.json({ devices: settled.map((s) => s.result) })
}

async function handleSwitch(device: ShellyDevice, on: boolean, password: string, signal: AbortSignal): Promise<Response> {
  try {
    // Inside the try so a malformed IP is mapped to a clean error like the
    // status path, instead of throwing uncaught through the handler.
    const base = normalizeShellyBase(device.ip)
    await shellyRpc(base, `Switch.Set?id=0&on=${on ? 'true' : 'false'}`, password, signal)
    return Response.json({ ok: true, output: on })
  } catch (e) {
    const code = mapShellyError(e)
    if (code !== 'timeout') void logPluginApiFailure(PLUGIN_ID, 'switch', `${code}:${device.id}`)
    const status = code === 'auth_failed' ? 401 : code === 'blocked_url' ? 400 : 502
    return Response.json({ error: code }, { status })
  }
}

async function handlePost(req: Request): Promise<Response> {
  let body: ReqBody
  try {
    body = (await req.json()) as ReqBody
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const password = openSealedSecret(str(body.password))
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), SHELLY_TIMEOUT_MS)
  try {
    if (body.action === 'switch') {
      const device = parseOneDevice(body.device)
      if (!device) return Response.json({ error: 'invalid_target' }, { status: 400 })
      if (typeof body.on !== 'boolean') return Response.json({ error: 'invalid_state' }, { status: 400 })
      return await handleSwitch(device, body.on, devicePassword(device, password), ac.signal)
    }

    const devices = parseDevices(body.devices, MAX_DEVICES)
    if (devices.length === 0) return Response.json({ error: 'no_devices' }, { status: 400 })
    return await handleStatus(devices, password, body.track === true, ac.signal)
  } finally {
    clearTimeout(timer)
  }
}

export default function shellyPlugServerHandler(ctx: PluginServerContext): Promise<Response> {
  if (ctx.request.method !== 'POST') {
    return Promise.resolve(Response.json({ error: 'method_not_allowed' }, { status: 405 }))
  }
  return handlePost(ctx.request)
}
