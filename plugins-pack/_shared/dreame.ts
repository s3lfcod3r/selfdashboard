/**
 * Dreame Home cloud client (Gen2+ robot vacuums that only pair to the
 * "Dreamehome" app, e.g. L10s Ultra). Bundle-safe for plugins-pack server.mjs.
 *
 * Protocol reverse-engineered / ported from the Tasshack/dreame-vacuum Home
 * Assistant integration (dreame/protocol.py, DreameVacuumDreameHomeCloudProtocol).
 * It is Dreame's own Alibaba-hosted IoT cloud (NOT Xiaomi Mi Home, NOT Tuya) and
 * keeps the Xiaomi MIOT property/action model on top of a plain OAuth2 transport.
 *
 * Flow: OAuth2 password grant → access+refresh token → list devices → read MIOT
 * properties / send MIOT actions via /device/sendCommand. No per-request signing,
 * no payload encryption. This is a cloud dependency and can break when Dreame
 * changes the app version / endpoints (hence the plugin ships as Beta).
 */
import crypto from 'node:crypto'

const HOST_SUFFIX = '.iot.dreame.tech'
const PORT = '13267'
const PASSWORD_SALT = 'RAylYC%fmSKp7%Tq'
const USER_AGENT = 'Dreame_Smarthome/2.1.9 (iPhone; iOS 18.4.1; Scale/3.00)'
const BASIC_AUTH = 'Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg='
const DEFAULT_TENANT = '000000'
const AUTH_PATH = '/dreame-auth/oauth/token'

export const DREAME_TIMEOUT_MS = 20_000

export class DreameAuthError extends Error {
  /** true when a refresh token was rejected (caller should retry with password). */
  readonly refreshExpired: boolean
  constructor(message = 'auth_failed', refreshExpired = false) {
    super(message)
    this.name = 'DreameAuthError'
    this.refreshExpired = refreshExpired
  }
}

export type DreameTokens = {
  key: string // access token (Dreame-Auth header)
  refresh: string // refresh token
  ti: string // tenant id
  uid: string
  /** epoch ms after which the access token must be refreshed. */
  expireMs: number
}

export type DreameDevice = { did: string; name: string; model: string; bindDomain: string }

/** Validate the region/country segment so it can only ever hit *.iot.dreame.tech. */
function apiBase(country: string): string {
  if (!/^[a-z]{2,3}$/.test(country)) throw new Error('invalid_country')
  return `https://${country}${HOST_SUFFIX}:${PORT}`
}

function md5Hex(input: string): string {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex')
}

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, init)
  let json: unknown = null
  try {
    const text = await res.text()
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Log in with email+password, or refresh an existing token. */
export async function dreameLogin(
  country: string,
  creds: { email?: string; password?: string; refresh?: string },
  signal: AbortSignal,
): Promise<DreameTokens> {
  const body = creds.refresh
    ? `platform=IOS&scope=all&grant_type=refresh_token&refresh_token=${encodeURIComponent(creds.refresh)}`
    : `platform=IOS&scope=all&grant_type=password&username=${encodeURIComponent(creds.email ?? '')}` +
      `&password=${md5Hex((creds.password ?? '') + PASSWORD_SALT)}&type=account`

  const { status, json } = await fetchJson(apiBase(country) + AUTH_PATH, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Language': 'en-US;q=0.8',
      'User-Agent': USER_AGENT,
      Authorization: BASIC_AUTH,
      'Tenant-Id': DEFAULT_TENANT,
    },
    body,
    signal,
  })

  if (status === 200 && isObj(json) && typeof json.access_token === 'string') {
    const expiresSec = typeof json.expires_in === 'number' ? json.expires_in : 3600
    return {
      key: json.access_token,
      refresh: typeof json.refresh_token === 'string' ? json.refresh_token : (creds.refresh ?? ''),
      ti: typeof json.tenant_id === 'string' ? json.tenant_id : DEFAULT_TENANT,
      uid: typeof json.uid === 'string' ? json.uid : String(json.uid ?? ''),
      expireMs: Date.now() + Math.max(60, expiresSec - 120) * 1000,
    }
  }

  // Any failure of a refresh-grant call → tell the caller to fall back to the
  // password (network/timeout errors throw before reaching here, so a non-200
  // on a refresh call means the refresh token is no longer usable).
  if (creds.refresh) throw new DreameAuthError('refresh_expired', true)
  throw new DreameAuthError('auth_failed', false)
}

function authHeaders(t: DreameTokens): Record<string, string> {
  return {
    Accept: '*/*',
    'Content-Type': 'application/json',
    'Accept-Language': 'en-US;q=0.8',
    'User-Agent': USER_AGENT,
    Authorization: BASIC_AUTH,
    'Tenant-Id': t.ti || DEFAULT_TENANT,
    'Dreame-Auth': t.key,
  }
}

/** POST an authenticated JSON call; throws DreameAuthError on 401. */
async function apiCall(country: string, t: DreameTokens, path: string, params: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
  const { status, json } = await fetchJson(`${apiBase(country)}/${path}`, {
    method: 'POST',
    headers: authHeaders(t),
    body: params != null ? JSON.stringify(params) : undefined,
    signal,
  })
  if (status === 401) throw new DreameAuthError('token_expired', true)
  if (!isObj(json)) throw new Error(`bad_response_${status}`)
  return json
}

// ---------------------------------------------------------------------------
// Devices + MIOT
// ---------------------------------------------------------------------------

/** List all bound devices; returns the vacuum records (model contains ".vacuum."). */
export async function dreameListVacuums(country: string, t: DreameTokens, signal: AbortSignal): Promise<DreameDevice[]> {
  const res = await apiCall(country, t, 'dreame-user-iot/iotuserbind/device/listV2', null, signal)
  const data = isObj(res.data) ? res.data : {}
  const page = isObj(data.page) ? data.page : {}
  const records = Array.isArray(page.records) ? page.records : []
  const out: DreameDevice[] = []
  for (const r of records) {
    if (!isObj(r)) continue
    const model = String(r.model ?? '')
    if (!model.includes('.vacuum.')) continue
    const info = isObj(r.deviceInfo) ? r.deviceInfo : {}
    out.push({
      did: String(r.did ?? ''),
      name: String(r.customName || info.displayName || 'Dreame'),
      model,
      bindDomain: String(r.bindDomain ?? ''),
    })
  }
  return out
}

/** Send a raw MIOT command (get_properties / action / set_properties) to a device. */
async function sendCommand(
  country: string,
  t: DreameTokens,
  device: DreameDevice,
  method: string,
  params: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  // bindDomain comes from the cloud's device list; sanitize before putting it in
  // the path so a hostile/malformed value can't inject a path/query segment.
  let sub = ''
  if (device.bindDomain) {
    const first = device.bindDomain.split('.')[0]
    if (/^[A-Za-z0-9_-]+$/.test(first)) sub = `-${first}`
  }
  const id = Math.floor((Date.now() % 1_000_000) + 1)
  const res = await apiCall(country, t, `dreame-iot-com${sub}/device/sendCommand`, {
    did: device.did,
    id,
    data: { did: device.did, id, method, params },
  }, signal)
  const data = isObj(res.data) ? res.data : {}
  return data.result
}

export type MiotProp = { siid: number; piid: number }
export type MiotReading = { siid: number; piid: number; value: unknown }

/** Read a batch of MIOT properties. Returns the raw {siid,piid,value} list. */
export async function dreameGetProperties(
  country: string,
  t: DreameTokens,
  device: DreameDevice,
  props: MiotProp[],
  signal: AbortSignal,
): Promise<MiotReading[]> {
  const params = props.map((p) => ({ did: device.did, siid: p.siid, piid: p.piid }))
  const result = await sendCommand(country, t, device, 'get_properties', params, signal)
  if (!Array.isArray(result)) return []
  return result
    .filter(isObj)
    .map((r) => ({ siid: Number(r.siid), piid: Number(r.piid), value: r.value }))
}

/** Trigger a MIOT action (siid/aiid). */
export async function dreameAction(
  country: string,
  t: DreameTokens,
  device: DreameDevice,
  siid: number,
  aiid: number,
  signal: AbortSignal,
): Promise<void> {
  await sendCommand(country, t, device, 'action', { did: device.did, siid, aiid, in: [] }, signal)
}
