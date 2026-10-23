import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPluginStaleCache, staleCacheKey } from './pluginStaleCache'

function jsonLoader(values: unknown[], status = 200) {
  let i = 0
  return vi.fn(async () => Response.json(values[Math.min(i++, values.length - 1)], { status }))
}

describe('createPluginStaleCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('miss → hit innerhalb freshMs, ohne erneutes Laden', async () => {
    const cache = createPluginStaleCache({ freshMs: 5_000, staleMs: 60_000 })
    const load = jsonLoader([{ n: 1 }])
    const a = await cache.respond('k', load)
    expect(a.headers.get('X-SD-Cache')).toBe('miss')
    expect(await a.json()).toEqual({ n: 1 })
    vi.advanceTimersByTime(1_000)
    const b = await cache.respond('k', load)
    expect(b.headers.get('X-SD-Cache')).toBe('hit')
    expect(await b.json()).toEqual({ n: 1 })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('stale: liefert sofort alte Daten und lädt im Hintergrund neu', async () => {
    const cache = createPluginStaleCache({ freshMs: 5_000, staleMs: 60_000 })
    const load = jsonLoader([{ n: 1 }, { n: 2 }])
    await cache.respond('k', load)
    vi.advanceTimersByTime(10_000)
    const stale = await cache.respond('k', load)
    expect(stale.headers.get('X-SD-Cache')).toBe('stale')
    expect(stale.headers.get('X-SD-Data-Age')).toBe('10')
    expect(await stale.json()).toEqual({ n: 1 })
    // Refresh startet erst nach der Antwort (synchrone Loader dürfen sie nicht verzögern).
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)
    const fresh = await cache.respond('k', load)
    expect(fresh.headers.get('X-SD-Cache')).toBe('hit')
    expect(await fresh.json()).toEqual({ n: 2 })
  })

  it('nach staleMs wird wieder gewartet (miss)', async () => {
    const cache = createPluginStaleCache({ freshMs: 1_000, staleMs: 5_000 })
    const load = jsonLoader([{ n: 1 }, { n: 2 }])
    await cache.respond('k', load)
    vi.advanceTimersByTime(6_000)
    const r = await cache.respond('k', load)
    expect(r.headers.get('X-SD-Cache')).toBe('miss')
    expect(await r.json()).toEqual({ n: 2 })
  })

  it('Fehlerantworten werden nicht gespeichert', async () => {
    const cache = createPluginStaleCache({ freshMs: 5_000, staleMs: 60_000 })
    const load = jsonLoader([{ error: 'x' }], 502)
    const a = await cache.respond('k', load)
    expect(a.status).toBe(502)
    await cache.respond('k', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('cacheable=false verhindert das Speichern', async () => {
    const cache = createPluginStaleCache({ freshMs: 5_000, staleMs: 60_000 })
    const load = jsonLoader([{ ok: false }])
    const opts = { cacheable: (body: string) => (JSON.parse(body) as { ok: boolean }).ok }
    await cache.respond('k', load, opts)
    await cache.respond('k', load, opts)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('parallele Misses teilen sich einen Ladevorgang', async () => {
    const cache = createPluginStaleCache({ freshMs: 5_000, staleMs: 60_000 })
    const load = jsonLoader([{ n: 1 }])
    const [a, b] = await Promise.all([cache.respond('k', load), cache.respond('k', load)])
    expect(await a.json()).toEqual({ n: 1 })
    expect(await b.json()).toEqual({ n: 1 })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('mehrere Stale-Anfragen planen nur einen Refresh; clear() bricht ihn ab', async () => {
    const cache = createPluginStaleCache({ freshMs: 1_000, staleMs: 60_000 })
    const load = jsonLoader([{ n: 1 }, { n: 2 }])
    await cache.respond('k', load)
    vi.advanceTimersByTime(2_000)
    await cache.respond('k', load)
    await cache.respond('k', load)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(2_000)
    await cache.respond('k', load)
    cache.clear()
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('maxWaitMs: schneller Refresh liefert frische Daten (refresh)', async () => {
    const cache = createPluginStaleCache({ freshMs: 1_000, staleMs: 60_000, maxWaitMs: 300 })
    const load = jsonLoader([{ n: 1 }, { n: 2 }])
    await cache.respond('k', load)
    vi.advanceTimersByTime(2_000)
    const r = await cache.respond('k', load)
    expect(r.headers.get('X-SD-Cache')).toBe('refresh')
    expect(await r.json()).toEqual({ n: 2 })
  })

  it('maxWaitMs: langsamer Refresh → nach Limit alte Daten, Ergebnis landet danach im Cache', async () => {
    const cache = createPluginStaleCache({ freshMs: 1_000, staleMs: 60_000, maxWaitMs: 300 })
    let n = 0
    const slow = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          n += 1
          const value = n
          setTimeout(() => resolve(Response.json({ n: value })), value === 1 ? 0 : 2_000)
        }),
    )
    const first = cache.respond('k', slow)
    await vi.advanceTimersByTimeAsync(0)
    expect(await (await first).json()).toEqual({ n: 1 })
    vi.advanceTimersByTime(2_000)
    const pending = cache.respond('k', slow)
    await vi.advanceTimersByTimeAsync(300)
    const r = await pending
    expect(r.headers.get('X-SD-Cache')).toBe('stale')
    expect(await r.json()).toEqual({ n: 1 })
    await vi.advanceTimersByTimeAsync(2_000)
    const after = await cache.respond('k', slow)
    expect(after.headers.get('X-SD-Cache')).toBe('hit')
    expect(await after.json()).toEqual({ n: 2 })
  })

  it('maxWaitMs: Refresh mit Fehler → alte Daten statt Fehler', async () => {
    const cache = createPluginStaleCache({ freshMs: 1_000, staleMs: 60_000, maxWaitMs: 300 })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    const load = vi.fn(async () => {
      calls += 1
      if (calls > 1) throw new Error('weg')
      return Response.json({ n: 1 })
    })
    await cache.respond('k', load)
    vi.advanceTimersByTime(2_000)
    const r = await cache.respond('k', load)
    expect(r.headers.get('X-SD-Cache')).toBe('stale')
    expect(await r.json()).toEqual({ n: 1 })
  })

  it('clear() leert den Cache', async () => {
    const cache = createPluginStaleCache({ freshMs: 5_000, staleMs: 60_000 })
    const load = jsonLoader([{ n: 1 }, { n: 2 }])
    await cache.respond('k', load)
    cache.clear()
    const r = await cache.respond('k', load)
    expect(r.headers.get('X-SD-Cache')).toBe('miss')
    expect(await r.json()).toEqual({ n: 2 })
  })

  it('staleCacheKey ist stabil und unterscheidet Eingaben', () => {
    expect(staleCacheKey('a', 1)).toBe(staleCacheKey('a', 1))
    expect(staleCacheKey('a', 1)).not.toBe(staleCacheKey('a', 2))
  })
})
