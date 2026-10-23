import 'server-only'

/**
 * Server-Timing pro Request: misst Phasen (auth, scan, transpile, handler …),
 * setzt den `Server-Timing`-Header (DevTools → Network → Timing) und loggt
 * langsame Requests nach stdout (`docker logs`).
 *
 * Env:
 *   SELFDASHBOARD_TIMING_LOG=1        → jeden gemessenen Request loggen
 *   SELFDASHBOARD_TIMING_SLOW_MS=500  → ab dieser Dauer immer loggen (Default 500)
 */

const LOG_ALL = process.env.SELFDASHBOARD_TIMING_LOG === '1'
const SLOW_MS = Number(process.env.SELFDASHBOARD_TIMING_SLOW_MS) > 0 ? Number(process.env.SELFDASHBOARD_TIMING_SLOW_MS) : 500

type TimingEntry = { name: string; dur: number; desc?: string }

export type ServerTiming = {
  /** Misst `fn` (sync oder async) unter `name`. */
  measure: <T>(name: string, fn: () => T, desc?: string) => T
  add: (name: string, dur: number, desc?: string) => void
  /** Hängt `Server-Timing` an die Antwort und loggt bei Bedarf. */
  apply: (res: Response) => Response
}

function tokenName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_') || 'phase'
}

function formatEntry(e: TimingEntry): string {
  const desc = e.desc ? `;desc="${e.desc.replace(/["\\]/g, '')}"` : ''
  return `${tokenName(e.name)};dur=${e.dur.toFixed(1)}${desc}`
}

export function logServerTiming(message: string, slow = false): void {
  if (slow) console.warn(`[SelfDashboard][timing] ${message}`)
  else console.info(`[SelfDashboard][timing] ${message}`)
}

export function createServerTiming(label: string): ServerTiming {
  const start = performance.now()
  const entries: TimingEntry[] = []

  const add = (name: string, dur: number, desc?: string) => {
    entries.push({ name, dur, desc })
  }

  const measure = <T,>(name: string, fn: () => T, desc?: string): T => {
    const t0 = performance.now()
    const done = () => add(name, performance.now() - t0, desc)
    let out: T
    try {
      out = fn()
    } catch (e) {
      done()
      throw e
    }
    if (out instanceof Promise) {
      return out.finally(done) as T
    }
    done()
    return out
  }

  const apply = (res: Response): Response => {
    const total = performance.now() - start
    const value = [...entries, { name: 'total', dur: total }].map(formatEntry).join(', ')
    let out = res
    try {
      out.headers.set('Server-Timing', value)
    } catch {
      // Unveränderliche Header (z. B. durchgereichte fetch-Response) → neu verpacken.
      out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) })
      out.headers.set('Server-Timing', value)
    }
    const slow = total >= SLOW_MS
    if (LOG_ALL || slow) {
      const parts = entries.map((e) => `${e.name}=${e.dur.toFixed(0)}${e.desc ? `(${e.desc})` : ''}`).join(' ')
      const cache = res.headers.get('x-sd-cache')
      logServerTiming(`${label} ${res.status} ${total.toFixed(0)}ms ${parts}${cache ? ` cache=${cache}` : ''}`.trim(), slow)
    }
    return out
  }

  return { measure, add, apply }
}
