/**
 * Offline-Merker für Upstream-Hosts der Plugin-Server.
 *
 * Ist ein Host nicht erreichbar (EHOSTUNREACH & Co. — im LAN typisch erst nach
 * ~3 s ARP-Timeout), werden weitere Anfragen an ihn sofort abgelehnt statt
 * jedes Mal 3 s zu warten. Ob er wieder da ist, prüft eine TCP-Probe im
 * HINTERGRUND (höchstens alle PROBE_MS, angestoßen durch eingehende Anfragen) —
 * keine Nutzer-Anfrage wartet auf die Probe. Erfolgreiche Probe oder Antwort
 * hebt die Sperre auf.
 *
 * Zustand liegt auf globalThis, damit Image-Builtins und Volume-Plugins
 * (jede server.mjs bündelt ihre eigene Kopie) denselben Stand teilen.
 *
 * Env: SELFDASHBOARD_HOST_DOWN_MS=0 schaltet den Merker ab.
 *
 * Keep in sync: plugins-pack/_shared/upstream-health.ts ↔ src/lib/upstreamHealth.ts
 */
import net from 'node:net'

const DOWN_CODES = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])
const PROBE_MS = 15_000
const PROBE_TIMEOUT_MS = 4_000
const STORE_KEY = '__sdUpstreamHealth'

type HostState = { code: string; lastProbe: number; probing: boolean }

function store(): Map<string, HostState> {
  const g = globalThis as Record<string, unknown>
  let s = g[STORE_KEY] as Map<string, HostState> | undefined
  if (!s) {
    s = new Map()
    g[STORE_KEY] = s
  }
  return s
}

function enabled(): boolean {
  return process.env.SELFDASHBOARD_HOST_DOWN_MS !== '0'
}

function target(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
    if (!host) return null
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
    return { host, port }
  } catch {
    return null
  }
}

/** Fehlercode aus fetch (undici: err.cause.code) bzw. node-fetch (err.code). */
function errorCode(e: unknown): string | null {
  let cur: unknown = e
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const code = (cur as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
    cur = (cur as { cause?: unknown }).cause
  }
  return null
}

function markUp(host: string): void {
  if (store().delete(host)) {
    console.info(`[SelfDashboard][upstream] ${host} wieder erreichbar`)
  }
}

/** TCP-Connect im Hintergrund; jede Antwort außer „nicht erreichbar“ (auch ECONNREFUSED) heißt: Host lebt. */
function startProbe(host: string, port: number, state: HostState): void {
  state.probing = true
  state.lastProbe = Date.now()
  let settled = false
  const finish = (up: boolean) => {
    if (settled) return
    settled = true
    state.probing = false
    socket.destroy()
    if (up) markUp(host)
  }
  const socket = net.connect({ host, port })
  socket.setTimeout(PROBE_TIMEOUT_MS)
  socket.once('connect', () => finish(true))
  socket.once('timeout', () => finish(false))
  socket.once('error', (err) => {
    const code = errorCode(err)
    finish(!code || !DOWN_CODES.has(code))
  })
}

export class UpstreamHostDownError extends Error {
  readonly code: string

  constructor(host: string, code: string) {
    super(`host_down:${host} (${code}, cached)`)
    this.name = 'UpstreamHostDownError'
    this.code = code
  }
}

/** Wirft sofort, wenn der Host als offline gilt; stößt bei Bedarf eine Hintergrund-Probe an. */
export function assertUpstreamHostUp(url: string): void {
  const t = target(url)
  if (!t) return
  const state = store().get(t.host)
  if (!state) return
  if (!state.probing && Date.now() - state.lastProbe >= PROBE_MS) {
    startProbe(t.host, t.port, state)
  }
  throw new UpstreamHostDownError(t.host, state.code)
}

/** Nach einem fehlgeschlagenen Request aufrufen: merkt Host als offline, wenn der Fehler danach aussieht. */
export function noteUpstreamError(url: string, err: unknown): void {
  if (!enabled()) return
  const code = errorCode(err)
  if (!code || !DOWN_CODES.has(code)) return
  const t = target(url)
  if (!t) return
  const hosts = store()
  const existing = hosts.get(t.host)
  if (existing) {
    existing.code = code
    return
  }
  console.warn(
    `[SelfDashboard][upstream] ${t.host} nicht erreichbar (${code}) — Anfragen werden sofort abgelehnt, Hintergrund-Probe alle ${PROBE_MS / 1000}s`,
  )
  hosts.set(t.host, { code, lastProbe: Date.now(), probing: false })
}

/** Nach einem erfolgreichen Request (egal welcher HTTP-Status) aufrufen. */
export function noteUpstreamOk(url: string): void {
  const t = target(url)
  if (t) markUp(t.host)
}
