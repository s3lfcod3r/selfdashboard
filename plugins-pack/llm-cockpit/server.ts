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
type ServerOut = { name: string; state: 'ok' | 'off' | 'no_metrics' | 'error'; metrics?: Record<string, number> }

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
    return fetchJson(url, 'fetch-tokens')
  }

  if (body.kind === 'status') {
    if (!url) return json({ error: 'missing_url' }, 400)
    return statusCache.respond(url, () => fetchJson(url, 'fetch-status'))
  }

  if (body.kind === 'tempo') {
    const servers = Array.isArray(body.servers)
      ? body.servers
          .filter((s): s is ServerIn => !!s && typeof s.name === 'string' && typeof s.url === 'string' && s.url.trim() !== '')
          .slice(0, MAX_SERVERS)
      : []
    if (servers.length === 0) return json({ error: 'missing_servers' }, 400)
    return json({ servers: await Promise.all(servers.map(readServer)) })
  }

  return json({ error: 'unknown_kind' }, 400)
}

export default function llmCockpitServerHandler(ctx: PluginServerContext): Promise<Response> {
  return handle(ctx.request)
}
