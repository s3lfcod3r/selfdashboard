/**
 * Stale-while-revalidate für Plugin-Server-Antworten.
 *
 * - fresh (jünger als freshMs): direkt aus dem Cache
 * - stale (jünger als staleMs): sofort die alte Antwort, Neuladen im Hintergrund
 *   (mit maxWaitMs: erst bis zu maxWaitMs auf frische Daten warten)
 * - miss: laden und warten (parallele Anfragen teilen sich einen Ladevorgang)
 *
 * Gespeichert werden nur 2xx-Antworten (plus optional `cacheable`-Prüfung);
 * Fehler gehen unverändert an den Client. Nur für LESENDE Endpunkte verwenden.
 * Antwort-Header: X-SD-Cache (hit|stale|miss|refresh), X-SD-Data-Age (Sekunden).
 *
 * Env: SELFDASHBOARD_STALE_MAX_MS überschreibt staleMs global (0 = nur fresh-Cache).
 *
 * Keep in sync: plugins-pack/_shared/plugin-stale-cache.ts ↔ src/lib/pluginStaleCache.ts
 */
import { createHash } from 'node:crypto'

type Snapshot = { status: number; headers: [string, string][]; body: string }
type Entry = { snap: Snapshot; at: number }

export type PluginStaleCache = {
  respond: (
    key: string,
    load: () => Promise<Response>,
    opts?: { cacheable?: (body: string) => boolean },
  ) => Promise<Response>
  clear: () => void
}

/** Kurzer, stabiler Cache-Schlüssel aus beliebigen JSON-fähigen Teilen. */
export function staleCacheKey(...parts: unknown[]): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex')
}

async function snapshot(res: Response): Promise<Snapshot> {
  const headers: [string, string][] = []
  res.headers.forEach((value, name) => {
    if (name !== 'set-cookie' && name !== 'content-length') headers.push([name, value])
  })
  return { status: res.status, headers, body: await res.text() }
}

function toResponse(snap: Snapshot, cache: 'hit' | 'stale' | 'miss' | 'refresh', ageMs: number): Response {
  const headers = new Headers(snap.headers)
  headers.set('X-SD-Cache', cache)
  headers.set('X-SD-Data-Age', String(Math.round(ageMs / 1000)))
  return new Response(snap.body, { status: snap.status, headers })
}

function staleOverride(): number | null {
  const raw = process.env.SELFDASHBOARD_STALE_MAX_MS
  const n = raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function createPluginStaleCache(options: {
  freshMs: number
  staleMs: number
  maxEntries?: number
  label?: string
  /**
   * > 0: bei veraltetem Eintrag frisch laden und bis zu maxWaitMs auf das Ergebnis
   * warten (X-SD-Cache: refresh); erst danach die alte Antwort liefern (stale).
   * 0 (Default): alte Antwort sofort, Neuladen im Hintergrund.
   */
  maxWaitMs?: number
}): PluginStaleCache {
  const freshMs = Math.max(0, options.freshMs)
  const staleMs = Math.max(freshMs, staleOverride() ?? options.staleMs)
  const maxEntries = Math.max(1, options.maxEntries ?? 32)
  const label = options.label ?? 'plugin'
  const maxWaitMs = Math.max(0, options.maxWaitMs ?? 0)
  const entries = new Map<string, Entry>()
  const inflight = new Map<string, Promise<Snapshot>>()
  const scheduled = new Map<string, ReturnType<typeof setTimeout>>()
  // clear() verwirft auch Ergebnisse von Ladevorgängen, die davor gestartet wurden.
  let generation = 0

  function store(key: string, snap: Snapshot, cacheable?: (body: string) => boolean): void {
    if (snap.status < 200 || snap.status >= 300) return
    if (cacheable) {
      try {
        if (!cacheable(snap.body)) return
      } catch {
        return
      }
    }
    entries.delete(key)
    while (entries.size >= maxEntries) {
      const first = entries.keys().next().value
      if (first === undefined) break
      entries.delete(first)
    }
    entries.set(key, { snap, at: Date.now() })
  }

  function load(
    key: string,
    loader: () => Promise<Response>,
    cacheable?: (body: string) => boolean,
  ): Promise<Snapshot> {
    const running = inflight.get(key)
    if (running) return running
    const gen = generation
    const p: Promise<Snapshot> = Promise.resolve()
      .then(loader)
      .then(snapshot)
      .then((snap) => {
        if (gen === generation) store(key, snap, cacheable)
        return snap
      })
      .finally(() => {
        if (inflight.get(key) === p) inflight.delete(key)
      })
    inflight.set(key, p)
    return p
  }

  return {
    async respond(key, loader, opts) {
      const cached = entries.get(key)
      if (cached) {
        const age = Date.now() - cached.at
        if (age < freshMs) return toResponse(cached.snap, 'hit', age)
        if (age < staleMs && maxWaitMs > 0) {
          // Frisch laden, aber höchstens maxWaitMs warten — danach alte Antwort,
          // der Ladevorgang läuft weiter und füllt den Cache für den nächsten Abruf.
          const pending = load(key, loader, opts?.cacheable).catch((e: unknown) => {
            console.warn(
              `[SelfDashboard][stale-cache] ${label}: Refresh fehlgeschlagen`,
              e instanceof Error ? e.message : e,
            )
            return null
          })
          let timer: ReturnType<typeof setTimeout> | undefined
          const fresh = await Promise.race([
            pending,
            new Promise<null>((resolve) => {
              timer = setTimeout(() => resolve(null), maxWaitMs)
            }),
          ])
          clearTimeout(timer)
          if (fresh) return toResponse(fresh, 'refresh', 0)
          return toResponse(cached.snap, 'stale', age)
        }
        if (age < staleMs) {
          // Erst NACH dieser Antwort starten: Loader mit synchronem Anteil (z. B. better-sqlite3)
          // würden sonst die Stale-Antwort um ihre volle Laufzeit verzögern.
          if (!scheduled.has(key)) {
            scheduled.set(
              key,
              setTimeout(() => {
                scheduled.delete(key)
                void load(key, loader, opts?.cacheable).catch((e) => {
                  console.warn(
                    `[SelfDashboard][stale-cache] ${label}: Hintergrund-Refresh fehlgeschlagen`,
                    e instanceof Error ? e.message : e,
                  )
                })
              }, 0),
            )
          }
          return toResponse(cached.snap, 'stale', age)
        }
        entries.delete(key)
      }
      const snap = await load(key, loader, opts?.cacheable)
      return toResponse(snap, 'miss', 0)
    },
    clear() {
      for (const timer of scheduled.values()) clearTimeout(timer)
      scheduled.clear()
      entries.clear()
      inflight.clear()
      generation += 1
    },
  }
}
