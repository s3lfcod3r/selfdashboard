import 'server-only'

import { isIP } from 'node:net'

/**
 * Unban über die CrowdSec Local API (LAPI) — kein Docker-Socket nötig.
 * Zugang: eigene Maschine im CrowdSec-Container anlegen
 *   cscli machines add selfdashboard --password '<langes-passwort>' -f /dev/null
 * und CROWDSEC_LAPI_URL / CROWDSEC_LAPI_MACHINE_ID / CROWDSEC_LAPI_PASSWORD setzen.
 */

const DEFAULT_LAPI_URL = 'http://crowdsec:8080'
/** JWT gilt bei CrowdSec 1 h — nach 30 min neu anmelden. */
const TOKEN_TTL_MS = 30 * 60_000
const REQUEST_TIMEOUT_MS = 10_000

interface LapiConfig {
  url: string
  machineId: string
  password: string
}

let cachedToken: { key: string; token: string; at: number } | null = null

function lapiConfig(): LapiConfig {
  const url = (process.env.CROWDSEC_LAPI_URL?.trim() || DEFAULT_LAPI_URL).replace(/\/+$/, '')
  const machineId = process.env.CROWDSEC_LAPI_MACHINE_ID?.trim() ?? ''
  const password = process.env.CROWDSEC_LAPI_PASSWORD ?? ''
  if (!machineId || !password) throw new Error('lapi_credentials_missing')
  return { url, machineId, password }
}

async function lapiFetch(
  cfg: LapiConfig,
  method: string,
  path: string,
  init: { body?: unknown; token?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'selfdashboard' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  let res: Response
  try {
    res = await fetch(cfg.url + path, {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    throw new Error('lapi_unreachable')
  }
  let body: Record<string, unknown> = {}
  try {
    const j: unknown = await res.json()
    if (j && typeof j === 'object' && !Array.isArray(j)) body = j as Record<string, unknown>
  } catch {
    /* leere Antwort */
  }
  return { status: res.status, body }
}

async function lapiLogin(cfg: LapiConfig, force = false): Promise<string> {
  const key = `${cfg.url}|${cfg.machineId}|${cfg.password}`
  if (!force && cachedToken && cachedToken.key === key && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    return cachedToken.token
  }
  cachedToken = null
  const { status, body } = await lapiFetch(cfg, 'POST', '/v1/watchers/login', {
    body: { machine_id: cfg.machineId, password: cfg.password, scenarios: [] },
  })
  const token = typeof body.token === 'string' ? body.token : ''
  if (status === 401 || status === 403) throw new Error('lapi_login_failed')
  if (status !== 200 || !token) throw new Error(`lapi_error_${status}`)
  cachedToken = { key, token, at: Date.now() }
  return token
}

/** Authentifizierter Call; bei abgelaufenem Token einmal neu anmelden. */
async function lapiCall(cfg: LapiConfig, method: string, path: string) {
  let res = await lapiFetch(cfg, method, path, { token: await lapiLogin(cfg) })
  if (res.status === 401) res = await lapiFetch(cfg, method, path, { token: await lapiLogin(cfg, true) })
  return res
}

export async function crowdsecUnbanIp(ip: string): Promise<{ deleted: number }> {
  const trimmed = ip.trim()
  if (!trimmed || !isIP(trimmed)) throw new Error('invalid_ip')
  const cfg = lapiConfig()
  const query = `?ip=${encodeURIComponent(trimmed)}`
  const res = await lapiCall(cfg, 'DELETE', `/v1/decisions${query}`)
  if (res.status !== 200) throw new Error(`lapi_error_${res.status}`)
  // Alerts mitlöschen ist optional: die LAPI erlaubt das nur von localhost/trusted_ips.
  try {
    await lapiCall(cfg, 'DELETE', `/v1/alerts${query}`)
  } catch {
    /* best effort */
  }
  const deleted = Number(res.body.nbDeleted ?? 0)
  return { deleted: Number.isFinite(deleted) ? deleted : 0 }
}

/** Nur für Tests. */
export function resetCrowdsecLapiTokenCache(): void {
  cachedToken = null
}
