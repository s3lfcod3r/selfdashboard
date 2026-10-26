import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataDir } from '../_shared/data-dir'
import { logPluginApiFailure } from '../_shared/log'
import { fetchWithSsrfGuard, UnsafeOutboundUrlError } from '../_shared/ssrf'
import { createPluginStaleCache } from '../_shared/plugin-stale-cache'
import type { PluginServerContext } from '../_shared/plugin-server-types'

// Ein Serverteil fuer alle drei Bereiche der LLM-Cockpit-Kachel:
//   kind 'tokens' -> Token-Sammler (GET /tokens), wie llm-token
//   kind 'tempo'  -> /metrics der llama.cpp-Server, wie llm-tempo
//   kind 'status' -> Projektstatus-Dienst (GET /status), wie openclaw-status
// Bei Fehlern kommt der Host mit zurueck, damit die Kachel sagen kann, WER fehlt.

const PLUGIN_ID = 'llm-cockpit'
const TIMEOUT_MS = 8000
const TEMPO_TIMEOUT_MS = 5000
const MAX_SERVERS = 8

const WANTED = new Set([
  'prompt_tokens_total',
  'prompt_seconds_total',
  'tokens_predicted_total',
  'tokens_predicted_seconds_total',
  'spec_decode_num_draft_tokens_total',
  'spec_decode_num_accepted_tokens_total',
  'requests_processing',
])

const statusCache = createPluginStaleCache({ freshMs: 15_000, staleMs: 10 * 60_000, maxEntries: 8, label: `${PLUGIN_ID}/status` })

type ServerIn = { name: string; url: string }
type Tempo = { schreibt: number | null; schnitt: number | null; liest: number | null; mtp: number | null; verlauf: number[] }
type ServerOut = {
  name: string
  state: 'ok' | 'off' | 'no_metrics' | 'error'
  metrics?: Record<string, number>
  /** Letzte Messung, wenn der Server gerade nicht antwortet. */
  letzte?: Tempo & { t: number }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** JSON von einem Dienst holen; Fehler als { error, host } statt nur "unreachable". */
async function fetchJson(url: string, operation: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetchWithSsrfGuard(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) return json({ error: 'upstream_status', status: res.status, host: hostOf(url) }, 502)
    return json((await res.json()) as unknown)
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) return json({ error: 'unsafe_url', detail: err.message, host: hostOf(url) }, 400)
    const message = err instanceof Error ? err.message : String(err)
    await logPluginApiFailure(PLUGIN_ID, operation, message, { host: hostOf(url) })
    const timeout = ctrl.signal.aborted || /timeout|ETIMEDOUT/i.test(message)
    return json({ error: timeout ? 'timeout' : 'unreachable', host: hostOf(url) }, 502)
  } finally {
    clearTimeout(timer)
  }
}

function parseMetrics(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = /^llamacpp:([a-z_]+)\s+([-0-9.eE+]+)\s*$/.exec(line.trim())
    if (m && WANTED.has(m[1])) out[m[1]] = Number(m[2])
  }
  return out
}

function metricsUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  return `${trimmed}/metrics`
}

async function readServer(s: ServerIn): Promise<ServerOut> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TEMPO_TIMEOUT_MS)
  try {
    const res = await fetchWithSsrfGuard(metricsUrl(s.url), { signal: ctrl.signal })
    if (res.status === 501) return { name: s.name, state: 'no_metrics' }
    if (!res.ok) return { name: s.name, state: 'error' }
    return { name: s.name, state: 'ok', metrics: parseMetrics(await res.text()) }
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) return { name: s.name, state: 'error' }
    // Nicht erreichbar heisst hier fast immer: Modell ist aus. Kein Fehler-Log.
    return { name: s.name, state: 'off' }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Letzter Stand auf Platte: faehrt der Rechner mit den Diensten runter, liefert
// der Serverteil die letzte gute Antwort (mit _offline-Vermerk) statt eines Fehlers.
// Gilt fuer jeden Browser und ueberlebt Neustarts des Dashboards.
// ---------------------------------------------------------------------------

type Gemerkt = { t: number; d: unknown }
const standDatei = (): string => join(dataDir(), 'plugins', PLUGIN_ID, 'letzter-stand.json')
const SCHREIB_PAUSE_MS = 10_000
let stand: Record<string, Gemerkt> | null = null
let schreibTimer: ReturnType<typeof setTimeout> | null = null

function ladeStand(): Record<string, Gemerkt> {
  if (stand) return stand
  try {
    const data = JSON.parse(readFileSync(standDatei(), 'utf8')) as unknown
    stand = data && typeof data === 'object' ? (data as Record<string, Gemerkt>) : {}
  } catch {
    stand = {}
  }
  return stand
}

function speichern(): void {
  schreibTimer = null
  try {
    const file = standDatei()
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(ladeStand()), 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    void logPluginApiFailure(PLUGIN_ID, 'save-last-state', err instanceof Error ? err.message : String(err))
  }
}

function merke(key: string, d: unknown): void {
  ladeStand()[key] = { t: Date.now(), d }
  if (!schreibTimer) schreibTimer = setTimeout(speichern, SCHREIB_PAUSE_MS)
}

/** Gute Antwort merken; bei Fehler die gemerkte mit _offline zurueckgeben (falls vorhanden). */
async function mitLetztemStand(key: string, res: Response): Promise<Response> {
  const text = await res.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // kein JSON: unveraendert weiterreichen
  }
  if (res.ok && body && typeof body === 'object') {
    merke(key, body)
    return json(body)
  }
  const alt = ladeStand()[key]
  if (res.ok || !alt || !alt.d || typeof alt.d !== 'object') return new Response(text, { status: res.status, headers: res.headers })
  const fehler = body && typeof body === 'object' ? (body as Record<string, unknown>) : { error: `HTTP ${res.status}` }
  return json({ ...(alt.d as Record<string, unknown>), _offline: { ...fehler, stand: alt.t } })
}

const rate = (tokens?: number, seconds?: number): number | null =>
  tokens !== undefined && seconds !== undefined && seconds > 0 && tokens > 0 ? tokens / seconds : null

const VERLAUF = 30
const vorherMetrics = new Map<string, Record<string, number>>()

/** Tempo je Server mitrechnen und merken, damit es nach dem Ausschalten stehen bleibt. */
function tempoMerken(s: ServerIn, out: ServerOut): ServerOut {
  const key = `tempo:${s.name}|${s.url}`
  const m = out.metrics
  if (out.state !== 'ok' || !m) {
    vorherMetrics.delete(key)
    const alt = ladeStand()[key]
    return alt ? { ...out, letzte: { ...(alt.d as Tempo), t: alt.t } } : out
  }
  const alt = ladeStand()[key]?.d as Tempo | undefined
  const vorher = vorherMetrics.get(key)
  vorherMetrics.set(key, m)
  let schreibt = alt?.schreibt ?? null
  let verlauf = alt?.verlauf ?? []
  if (vorher && m.tokens_predicted_total > vorher.tokens_predicted_total) {
    const neu = rate(m.tokens_predicted_total - vorher.tokens_predicted_total, m.tokens_predicted_seconds_total - vorher.tokens_predicted_seconds_total)
    if (neu !== null) {
      schreibt = neu
      verlauf = [...verlauf, neu].slice(-VERLAUF)
    }
  }
  const draft = m.spec_decode_num_draft_tokens_total
  const tempo: Tempo = {
    schreibt,
    schnitt: rate(m.tokens_predicted_total, m.tokens_predicted_seconds_total),
    liest: rate(m.prompt_tokens_total, m.prompt_seconds_total),
    mtp: draft ? (m.spec_decode_num_accepted_tokens_total ?? 0) / draft : null,
    verlauf,
  }
  if (tempo.schreibt !== null || tempo.schnitt !== null) merke(key, tempo)
  return out
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: { kind?: unknown; url?: unknown; servers?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const url = typeof body.url === 'string' ? body.url.trim() : ''

  if (body.kind === 'tokens') {
    if (!url) return json({ error: 'missing_url' }, 400)
    return mitLetztemStand(`tokens:${url}`, await fetchJson(url, 'fetch-tokens'))
  }

  if (body.kind === 'status') {
    if (!url) return json({ error: 'missing_url' }, 400)
    return statusCache.respond(url, async () => mitLetztemStand(`status:${url}`, await fetchJson(url, 'fetch-status')), {
      // Offline-Antworten nicht zwischenspeichern, sonst bleibt "offline" nach dem Hochfahren haengen.
      cacheable: (b) => !b.includes('"_offline"'),
    })
  }

  if (body.kind === 'tempo') {
    const servers = Array.isArray(body.servers)
      ? body.servers
          .filter((s): s is ServerIn => !!s && typeof s.name === 'string' && typeof s.url === 'string' && s.url.trim() !== '')
          .slice(0, MAX_SERVERS)
      : []
    if (servers.length === 0) return json({ error: 'missing_servers' }, 400)
    return json({ servers: await Promise.all(servers.map(async (s) => tempoMerken(s, await readServer(s)))) })
  }

  return json({ error: 'unknown_kind' }, 400)
}

export default function llmCockpitServerHandler(ctx: PluginServerContext): Promise<Response> {
  return handle(ctx.request)
}
