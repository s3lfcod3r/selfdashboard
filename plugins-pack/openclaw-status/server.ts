import { logPluginApiFailure } from '../_shared/log'
import { fetchWithSsrfGuard, UnsafeOutboundUrlError } from '../_shared/ssrf'
import type { PluginServerContext } from '../_shared/plugin-server-types'

// Holt die Statusliste vom Projektstatus-Dienst (liest die STATUS.md-Dateien
// der Projekte). Der Browser ruft nur diesen Serverteil auf - so gibt es
// keine Probleme mit gemischten Inhalten oder CORS, und die Adresse wird mit
// dem gemeinsamen SSRF-Schutz geprueft.

const PLUGIN_ID = 'openclaw-status'
const TIMEOUT_MS = 8000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let statusUrl = ''
  try {
    const body = (await request.json()) as { statusUrl?: unknown }
    statusUrl = typeof body.statusUrl === 'string' ? body.statusUrl.trim() : ''
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (!statusUrl) return json({ error: 'missing_url' }, 400)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetchWithSsrfGuard(statusUrl, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) return json({ error: 'upstream_status', status: res.status }, 502)
    const data: unknown = await res.json()
    return json(data)
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) return json({ error: 'unsafe_url', detail: err.message }, 400)
    const message = err instanceof Error ? err.message : String(err)
    await logPluginApiFailure(PLUGIN_ID, 'fetch-status', message)
    return json({ error: 'unreachable' }, 502)
  } finally {
    clearTimeout(timer)
  }
}

export default function openclawStatusServerHandler(ctx: PluginServerContext): Promise<Response> {
  return handle(ctx.request)
}
