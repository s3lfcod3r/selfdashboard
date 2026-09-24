import { logPluginApiFailure } from '../_shared/log'
import { fetchWithSsrfGuard, UnsafeOutboundUrlError } from '../_shared/ssrf'
import type { PluginServerContext } from '../_shared/plugin-server-types'

// Holt die Tages- und Wochensummen vom Token-Sammler (der fragt OpenClaw ab und
// schreibt die Zaehler fort). Der Browser ruft nur diesen Serverteil auf - so
// bleibt der Gateway-Schluessel beim Sammler und nicht im Browser.

const PLUGIN_ID = 'llm-token'
const TIMEOUT_MS = 8000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let url = ''
  try {
    const body = (await request.json()) as { url?: unknown }
    url = typeof body.url === 'string' ? body.url.trim() : ''
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (!url) return json({ error: 'missing_url' }, 400)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetchWithSsrfGuard(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) return json({ error: 'upstream_status', status: res.status }, 502)
    return json((await res.json()) as unknown)
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) return json({ error: 'unsafe_url', detail: err.message }, 400)
    const message = err instanceof Error ? err.message : String(err)
    await logPluginApiFailure(PLUGIN_ID, 'fetch-tokens', message)
    return json({ error: 'unreachable' }, 502)
  } finally {
    clearTimeout(timer)
  }
}

export default function llmTokenServerHandler(ctx: PluginServerContext): Promise<Response> {
  return handle(ctx.request)
}
