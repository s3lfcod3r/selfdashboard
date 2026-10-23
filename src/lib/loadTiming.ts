/**
 * Ladezeit-Messung im Browser (Konsole, langsame Ladevorgänge zusätzlich → Protokoll).
 *
 * - Plugin-Bootstrap: eine Zusammenfassung pro Lauf (volume, widget.js, Zeit ab Seitenstart).
 * - /api/*-Requests: Dauer bis Header + Server-Timing des Servers; langsame immer als Warnung.
 * - ~10 s nach dem Laden: Tabelle der langsamsten API-Aufrufe.
 *
 * Jeden Request einzeln loggen: `localStorage.setItem('sd:timing', '1')` oder `?sdTiming=1`.
 */

import { reportClientLog } from '@/lib/reportLog'

const SLOW_API_MS = 1500
const SLOW_LOAD_MS = 3000
const SUMMARY_DELAY_MS = 10_000
const MAX_ENTRIES = 500

type ApiTiming = { url: string; ms: number; status: number; endAt: number; server?: string }

const apiTimings: ApiTiming[] = []
const widgetTimings = new Map<string, { ms: number; server: string }>()
let verbose: boolean | undefined
let summaryScheduled = false

export function isLoadTimingVerbose(): boolean {
  if (verbose !== undefined) return verbose
  verbose = false
  if (typeof window === 'undefined') return verbose
  try {
    verbose =
      new URLSearchParams(window.location.search).has('sdTiming') || window.localStorage.getItem('sd:timing') === '1'
  } catch {
    /* localStorage gesperrt */
  }
  return verbose
}

function ms(n: number): string {
  return `${Math.round(n)}ms`
}

/** Server-Timing einer per <script>/<link> geladenen Ressource (Resource Timing API). */
function resourceServerTiming(url: string): string {
  try {
    const abs = new URL(url, window.location.href).href
    const entries = performance.getEntriesByName(abs) as PerformanceResourceTiming[]
    const last = entries[entries.length - 1]
    if (!last) return ''
    const st = (last.serverTiming ?? []).filter((t) => t.duration > 0 || t.description)
    if (st.length === 0) return last.transferSize === 0 ? 'cache' : ''
    return st.map((t) => `${t.name}=${Math.round(t.duration)}${t.description ? `(${t.description})` : ''}`).join(' ')
  } catch {
    return ''
  }
}

export function noteApiTiming(url: string, durationMs: number, status: number, serverTiming: string | null): void {
  if (url.includes('/api/logs')) return
  if (apiTimings.length < MAX_ENTRIES) {
    apiTimings.push({ url, ms: durationMs, status, endAt: performance.now(), server: serverTiming ?? undefined })
  }
  const line = `[SelfDashboard][timing] ${status} ${url} ${ms(durationMs)}${serverTiming ? ` | server: ${serverTiming}` : ''}`
  if (durationMs >= SLOW_API_MS) console.warn(line)
  else if (isLoadTimingVerbose()) console.info(line)
}

export function noteWidgetTiming(pluginId: string, durationMs: number, jsUrl: string): void {
  widgetTimings.set(pluginId, { ms: durationMs, server: resourceServerTiming(jsUrl) })
  if (isLoadTimingVerbose()) {
    console.info(`[SelfDashboard][timing] widget.js ${pluginId} ${ms(durationMs)} ${widgetTimings.get(pluginId)?.server ?? ''}`)
  }
}

/** Einmal pro Seitenaufruf: Tabelle der langsamsten API-Aufrufe nach ~10 s. */
export function scheduleLoadTimingSummary(): void {
  if (summaryScheduled || typeof window === 'undefined') return
  summaryScheduled = true
  window.setTimeout(() => {
    if (apiTimings.length === 0) return
    const rows = [...apiTimings]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 15)
      .map((t) => ({
        url: t.url,
        dauer: Math.round(t.ms),
        status: t.status,
        start_ab_seite: Math.round(t.endAt - t.ms),
        server: t.server ?? '',
      }))
    console.info(`[SelfDashboard][timing] Langsamste API-Aufrufe (erste ${SUMMARY_DELAY_MS / 1000}s, ms):`)
    console.table(rows)
  }, SUMMARY_DELAY_MS)
}

export type PluginBootstrapTiming = {
  run: number
  startedAt: number
  volumeMs: number
  priorityIds: string[]
  priorityReadyAt: number
  deferredIds: string[]
  allDoneAt: number
  failed?: boolean
}

export function logPluginBootstrapTiming(t: PluginBootstrapTiming): void {
  const ids = [...t.priorityIds, ...t.deferredIds]
  const slowest = ids
    .map((id) => [id, widgetTimings.get(id)] as const)
    .filter((e): e is readonly [string, { ms: number; server: string }] => Boolean(e[1]))
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 5)
    .map(([id, w]) => `${id} ${ms(w.ms)}${w.server ? ` [${w.server}]` : ''}`)
    .join(', ')
  const bundles = [...widgetTimings]
    .filter(([key]) => key.startsWith('bundle:'))
    .map(([key, w]) => `${key.slice('bundle:'.length)} ${ms(w.ms)}${w.server ? ` [${w.server}]` : ''}`)
    .join(', ')
  const message =
    `Plugins geladen (Lauf ${t.run}${t.failed ? ', mit Fehlern' : ''}): ` +
    `Seitenstart→Bootstrap ${ms(t.startedAt)} | volume ${ms(t.volumeMs)} | ` +
    `Priorität ${t.priorityIds.length} bereit bei ${ms(t.priorityReadyAt)} | ` +
    `alle ${ids.length} bei ${ms(t.allDoneAt)} (ab Seitenstart)` +
    (bundles ? ` | Bundles: ${bundles}` : '') +
    (slowest ? ` | einzeln geladene widget.js: ${slowest}` : '')
  console.info(`[SelfDashboard][timing] ${message}`)
  if (t.priorityReadyAt >= SLOW_LOAD_MS) {
    reportClientLog({ level: 'warn', source: 'app', category: 'timing', message })
  }
}
