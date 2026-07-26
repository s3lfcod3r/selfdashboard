/**
 * Dreame robot vacuum (Dreamehome cloud) — status + control.
 *
 * Endpoint: POST /api/plugins/dreame  (login-gated by the host).
 * Talks to Dreame's cloud (see ../_shared/dreame.ts). The account password is
 * only used for the first login; afterwards a refresh token (stored encrypted
 * in the data volume) is used, so the password is not sent to Dreame on every
 * poll. Cached/stored tokens are bound to a password verifier so one dashboard
 * user cannot reuse another account's session just by knowing the email.
 *
 * BETA: this is a reverse-engineered cloud API and can break when Dreame ships
 * a new app version.
 */
import { logPluginApiFailure } from '../_shared/log'
import { decrypt, encrypt, openSealedSecret } from '../_shared/secret-crypto'
import { dataDir } from '../_shared/data-dir'
import type { PluginServerContext } from '../_shared/plugin-server-types'
import {
  DreameAuthError,
  dreameAction,
  dreameGetProperties,
  dreameListVacuums,
  dreameLogin,
  DREAME_TIMEOUT_MS,
  type DreameDevice,
  type DreameTokens,
} from '../_shared/dreame'
import crypto from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const dynamic = 'force-dynamic'

const PLUGIN_ID = 'dreame'
const MAX_DEVICES = 4
const LOGIN_MAX_FAILS = 5
const LOGIN_LOCK_MS = 60_000

type ReqBody = {
  action?: 'status' | 'command'
  email?: string
  password?: string
  country?: string
  did?: string
  cmd?: string
}

// MIOT identifiers (classic Dreame vacuum spec — adjust here if a model differs).
const PROP = {
  state: { siid: 2, piid: 1 },
  error: { siid: 2, piid: 2 },
  battery: { siid: 3, piid: 1 },
  charging: { siid: 3, piid: 2 },
  cleanTime: { siid: 4, piid: 2 },
  cleanArea: { siid: 4, piid: 3 },
}
const ACTION = {
  start: { siid: 2, aiid: 1 },
  pause: { siid: 2, aiid: 2 },
  dock: { siid: 3, aiid: 1 },
}
const ALL_PROPS = Object.values(PROP)

/** Normalize a raw state code into a coarse status the widget can style. */
function normalizeStatus(code: number): string {
  if ([1, 7, 9, 12, 25, 26, 27, 37, 38].includes(code)) return 'cleaning'
  if ([5, 10, 17, 18, 28, 31].includes(code)) return 'returning'
  if ([6, 13, 24].includes(code)) return 'charging'
  if ([3, 21, 36].includes(code)) return 'paused'
  if ([2, 29].includes(code)) return 'idle'
  if (code === 4) return 'error'
  return 'other'
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''
}
function numOr(v: unknown, d: number | null): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

// ---------------------------------------------------------------------------
// Token cache (in-memory per account) + encrypted refresh token at rest.
// Cached/stored tokens are only served when the request's password matches the
// verifier captured at login — so email alone can't unlock another's session.
// ---------------------------------------------------------------------------

type CacheEntry = { tokens: DreameTokens; verifier: string; devices?: DreameDevice[]; devicesTs?: number }
type StoredEntry = { r: string; v: string } // r = encrypted refresh, v = verifier

const cache = new Map<string, CacheEntry>()
const authLocks = new Map<string, Promise<CacheEntry>>()
const loginFails = new Map<string, { fails: number; until: number }>()
const DEVICES_TTL_MS = 10 * 60 * 1000

function accountKey(email: string, country: string): string {
  return crypto.createHash('sha256').update(`${country}:${email}`).digest('hex').slice(0, 24)
}
function verifierFor(email: string, password: string, country: string): string {
  return crypto.createHash('sha256').update(`${country}:${email}:${password}`).digest('hex')
}
function sameVerifier(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

function tokenPath(): string {
  return join(dataDir(), 'plugins', PLUGIN_ID, 'tokens.json')
}
function readStoredAll(): Record<string, StoredEntry> {
  const file = tokenPath()
  if (!existsSync(file)) return {}
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? (data as Record<string, StoredEntry>) : {}
  } catch {
    return {}
  }
}
function writeStored(key: string, refresh: string, verifier: string): void {
  const file = tokenPath()
  mkdirSync(dirname(file), { recursive: true })
  const data = readStoredAll()
  data[key] = { r: encrypt(refresh), v: verifier }
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data), 'utf8')
  renameSync(tmp, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    /* best effort (e.g. Windows) */
  }
}

// Rate-limit password logins so the endpoint can't be used to spray Dreame.
function loginLocked(key: string): boolean {
  const e = loginFails.get(key)
  return e ? Date.now() < e.until : false
}
function recordLoginFail(key: string): void {
  const e = loginFails.get(key) ?? { fails: 0, until: 0 }
  e.fails += 1
  if (e.fails >= LOGIN_MAX_FAILS) e.until = Date.now() + LOGIN_LOCK_MS
  loginFails.set(key, e)
}

/** Perform the actual refresh-or-password auth for one account. */
async function doAuth(
  key: string,
  email: string,
  password: string,
  country: string,
  verifier: string,
  signal: AbortSignal,
): Promise<CacheEntry> {
  const prev = cache.get(key)
  const stored = readStoredAll()[key]

  // Only reuse a refresh token whose verifier matches this request's password.
  let refresh: string | null = null
  if (prev && sameVerifier(prev.verifier, verifier)) refresh = prev.tokens.refresh || null
  if (!refresh && stored && sameVerifier(stored.v, verifier)) refresh = stored.r ? decrypt(stored.r) || null : null

  if (refresh) {
    try {
      const tokens = await dreameLogin(country, { refresh }, signal)
      const entry: CacheEntry = { tokens, verifier, devices: prev?.devices, devicesTs: prev?.devicesTs }
      cache.set(key, entry)
      if (tokens.refresh) writeStored(key, tokens.refresh, verifier)
      return entry
    } catch (e) {
      if (!(e instanceof DreameAuthError && e.refreshExpired)) throw e
      // refresh rejected → fall through to password
    }
  }

  if (!password) throw new DreameAuthError('missing_credentials')
  if (loginLocked(key)) throw new DreameAuthError('auth_failed')
  try {
    const tokens = await dreameLogin(country, { email, password }, signal)
    loginFails.delete(key)
    const entry: CacheEntry = { tokens, verifier, devices: prev?.devices, devicesTs: prev?.devicesTs }
    cache.set(key, entry)
    if (tokens.refresh) writeStored(key, tokens.refresh, verifier)
    return entry
  } catch (e) {
    recordLoginFail(key)
    throw e
  }
}

/** Ensure valid tokens for the account, de-duplicating concurrent auth work. */
async function ensureTokens(email: string, password: string, country: string, signal: AbortSignal): Promise<{ key: string; tokens: DreameTokens }> {
  const key = accountKey(email, country)
  const verifier = verifierFor(email, password, country)

  const cached = cache.get(key)
  if (cached && sameVerifier(cached.verifier, verifier) && cached.tokens.expireMs > Date.now() + 30_000) {
    return { key, tokens: cached.tokens }
  }

  // Coalesce concurrent logins for the same account (refresh tokens rotate).
  const pending = authLocks.get(key)
  if (pending) {
    const entry = await pending.catch(() => null)
    if (entry && sameVerifier(entry.verifier, verifier) && entry.tokens.expireMs > Date.now() + 30_000) {
      return { key, tokens: entry.tokens }
    }
  }

  const work = doAuth(key, email, password, country, verifier, signal)
  authLocks.set(key, work)
  try {
    const entry = await work
    return { key, tokens: entry.tokens }
  } finally {
    if (authLocks.get(key) === work) authLocks.delete(key)
  }
}

async function getDevices(key: string, tokens: DreameTokens, country: string, signal: AbortSignal): Promise<DreameDevice[]> {
  const entry = cache.get(key)
  if (entry?.devices && entry.devicesTs && Date.now() - entry.devicesTs < DEVICES_TTL_MS) {
    return entry.devices
  }
  const devices = await dreameListVacuums(country, tokens, signal)
  if (entry) {
    entry.devices = devices
    entry.devicesTs = Date.now()
  }
  return devices
}

function mapError(e: unknown): string {
  if (e instanceof DreameAuthError) return e.message === 'missing_credentials' ? 'missing_credentials' : 'auth_failed'
  if (e instanceof Error && e.name === 'AbortError') return 'timeout'
  return 'unreachable'
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function parseCountry(v: unknown): string {
  const c = str(v).toLowerCase()
  return /^[a-z]{2,3}$/.test(c) ? c : 'de'
}

async function readDevice(country: string, tokens: DreameTokens, device: DreameDevice, signal: AbortSignal) {
  const readings = await dreameGetProperties(country, tokens, device, ALL_PROPS, signal)
  // An empty read (cloud returned no usable result) means we can't trust the
  // values — report offline rather than a misleading "idle, 0%".
  if (readings.length === 0) {
    return { did: device.did, name: device.name, model: device.model, online: false, status: 'other', stateCode: -1 }
  }
  const val = (p: { siid: number; piid: number }): unknown =>
    readings.find((r) => r.siid === p.siid && r.piid === p.piid)?.value
  const stateCode = numOr(val(PROP.state), -1) ?? -1
  return {
    did: device.did,
    name: device.name,
    model: device.model,
    online: true,
    battery: numOr(val(PROP.battery), null),
    charging: numOr(val(PROP.charging), null),
    stateCode,
    status: normalizeStatus(stateCode),
    error: numOr(val(PROP.error), 0),
    cleaningTime: numOr(val(PROP.cleanTime), null),
    cleanedArea: numOr(val(PROP.cleanArea), null),
  }
}

async function handlePost(req: Request): Promise<Response> {
  let body: ReqBody
  try {
    body = (await req.json()) as ReqBody
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const email = str(body.email)
  const password = openSealedSecret(str(body.password))
  const country = parseCountry(body.country)
  if (!email) return Response.json({ error: 'missing_credentials' }, { status: 400 })

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), DREAME_TIMEOUT_MS)
  try {
    const { key, tokens } = await ensureTokens(email, password, country, ac.signal)

    if (body.action === 'command') {
      const cmd = str(body.cmd)
      const did = str(body.did)
      const act = cmd === 'start' ? ACTION.start : cmd === 'pause' ? ACTION.pause : cmd === 'dock' ? ACTION.dock : null
      if (!act) return Response.json({ error: 'invalid_command' }, { status: 400 })
      const devices = await getDevices(key, tokens, country, ac.signal)
      const device = devices.find((d) => d.did === did) ?? devices[0]
      if (!device) return Response.json({ error: 'no_device' }, { status: 404 })
      await dreameAction(country, tokens, device, act.siid, act.aiid, ac.signal)
      return Response.json({ ok: true })
    }

    // status
    const devices = await getDevices(key, tokens, country, ac.signal)
    if (devices.length === 0) return Response.json({ devices: [] })
    const results = await Promise.all(
      devices.slice(0, MAX_DEVICES).map(async (d) => {
        try {
          return await readDevice(country, tokens, d, ac.signal)
        } catch {
          return { did: d.did, name: d.name, model: d.model, online: false, status: 'other', stateCode: -1 }
        }
      }),
    )
    return Response.json({ devices: results })
  } catch (e) {
    const code = mapError(e)
    if (code !== 'timeout') void logPluginApiFailure(PLUGIN_ID, str(body.action) || 'status', code)
    const httpStatus = code === 'auth_failed' || code === 'missing_credentials' ? 401 : 502
    return Response.json({ error: code }, { status: httpStatus })
  } finally {
    clearTimeout(timer)
  }
}

export default function dreameServerHandler(ctx: PluginServerContext): Promise<Response> {
  if (ctx.request.method !== 'POST') {
    return Promise.resolve(Response.json({ error: 'method_not_allowed' }, { status: 405 }))
  }
  return handlePost(ctx.request)
}
