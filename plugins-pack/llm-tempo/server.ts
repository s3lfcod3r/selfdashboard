import { logPluginApiFailure } from '../_shared/log'
import { fetchWithSsrfGuard, UnsafeOutboundUrlError } from '../_shared/ssrf'
import type { PluginServerContext } from '../_shared/plugin-server-types'

// Liest die Prometheus-Messwerte (/metrics) von llama.cpp-Servern und gibt die
// Summenzaehler als JSON zurueck. Die Kachel rechnet daraus Token pro Sekunde.
// Der llama-server muss mit --metrics laufen, sonst antwortet er mit 501.

const PLUGIN_ID = 'llm-tempo'
const TIMEOUT_MS = 5000
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

type ServerIn = { name: string; url: string }
type ServerOut = { name: string; state: 'ok' | 'off' | 'no_metrics' | 'error'; metrics?: Record<string, number> }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
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
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
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

  let servers: ServerIn[] = []
  try {
    const body = (await request.json()) as { servers?: unknown }
    if (Array.isArray(body.servers)) {
      servers = body.servers
        .filter((s): s is ServerIn => !!s && typeof s.name === 'string' && typeof s.url === 'string' && s.url.trim() !== '')
        .slice(0, MAX_SERVERS)
    }
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (servers.length === 0) return json({ error: 'missing_servers' }, 400)

  try {
    return json({ servers: await Promise.all(servers.map(readServer)) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logPluginApiFailure(PLUGIN_ID, 'read-metrics', message)
    return json({ error: 'failed' }, 500)
  }
}

export default function llmTempoServerHandler(ctx: PluginServerContext): Promise<Response> {
  return handle(ctx.request)
}
