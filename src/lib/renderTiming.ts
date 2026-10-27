/**
 * Render-/Blockade-Messung im Browser — wer hält beim Laden den Haupt-Thread fest?
 *
 * - Pro Widget (Plugin-Id): Render-Zeit (React <Profiler>, braucht `next build --profile`)
 *   und Mount-Effekte (layout + passive; gemessen über einen Marker vor dem Widget).
 * - Long Animation Frames (Chromium/Edge ≥ 123): lange Frames mit Verursacher-Skript und
 *   „forced reflow“. Skript-Positionen im Widget-Bundle werden auf das Widget zurückgerechnet.
 *
 * ~10 s nach dem ersten Plugin-Bootstrap: Textbericht in der Konsole (kopierbar) und
 * window.__sdPerfReport. Danach wird nicht mehr gesammelt.
 */

const SUMMARY_DELAY_MS = 10_000

type WidgetStat = { mounts: number; renderMs: number; updates: number; updateMs: number; layoutMs: number; effectMs: number; maxMs: number }
type FrameScript = { source: string; fn: string; ms: number; forcedMs: number }
type Frame = { start: number; ms: number; blockingMs: number; scripts: FrameScript[] }

type LoafScript = {
  sourceURL?: string
  sourceFunctionName?: string
  sourceCharPosition?: number
  invoker?: string
  invokerType?: string
  duration: number
  forcedStyleAndLayoutDuration?: number
}
type LoafEntry = PerformanceEntry & { blockingDuration?: number; scripts?: LoafScript[] }

const stats = new Map<string, WidgetStat>()
const rawFrames: LoafEntry[] = []
const bundleUrls = new Set<string>()
let started = false
let collecting = true

function stat(id: string): WidgetStat {
  let s = stats.get(id)
  if (!s) {
    s = { mounts: 0, renderMs: 0, updates: 0, updateMs: 0, layoutMs: 0, effectMs: 0, maxMs: 0 }
    stats.set(id, s)
  }
  return s
}

/** React <Profiler onRender> — Render-Phase eines Widgets. */
export function noteWidgetRender(id: string, phase: string, actualDuration: number): void {
  if (!collecting) return
  const s = stat(id)
  if (phase === 'mount') {
    s.mounts += 1
    s.renderMs += actualDuration
  } else {
    s.updates += 1
    s.updateMs += actualDuration
  }
  s.maxMs = Math.max(s.maxMs, actualDuration)
}

/** Dauer der Mount-Effekte eines Widgets (layout = synchron im Commit, passive = useEffect). */
export function noteWidgetEffects(id: string, kind: 'layout' | 'passive', ms: number): void {
  if (!collecting) return
  const s = stat(id)
  if (kind === 'layout') s.layoutMs += ms
  else s.effectMs += ms
  s.maxMs = Math.max(s.maxMs, ms)
}

export function noteWidgetBundleUrl(url: string): void {
  try {
    bundleUrls.add(new URL(url, window.location.href).href)
  } catch {
    /* ignore */
  }
}

export function startRenderTiming(): void {
  if (started || typeof window === 'undefined') return
  started = true
  try {
    new PerformanceObserver((list) => {
      if (collecting) rawFrames.push(...(list.getEntries() as LoafEntry[]))
    }).observe({ type: 'long-animation-frame', buffered: true } as PerformanceObserverInit)
  } catch {
    /* Long Animation Frames nicht unterstützt (Firefox/Safari/alte WebViews) */
  }
  window.setTimeout(() => {
    collecting = false
    void report()
  }, SUMMARY_DELAY_MS)
}

/** Größe jedes Widgets im ausgelieferten (übersetzten/minifizierten) Bundle — bestimmt die Ladekosten. */
const bundleBytes = new Map<string, number>()

/** Widget-Startpositionen im Bundle („/* id *\/\ntry{“), um Skript-Positionen zuzuordnen. */
async function bundleMarkers(): Promise<Map<string, Array<{ pos: number; id: string }>>> {
  const out = new Map<string, Array<{ pos: number; id: string }>>()
  for (const url of bundleUrls) {
    try {
      const text = await (await fetch(url, { cache: 'force-cache' })).text()
      const markers: Array<{ pos: number; id: string }> = []
      const re = /\n\/\* ([a-z0-9][a-z0-9-]*) \*\/\n(?:var __sdT0=[^;]*;)?try\{/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) markers.push({ pos: m.index, id: m[1] })
      markers.forEach((mk, i) => {
        const bytes = (markers[i + 1]?.pos ?? text.length) - mk.pos
        bundleBytes.set(mk.id, Math.max(bundleBytes.get(mk.id) ?? 0, bytes))
      })
      out.set(url, markers)
    } catch {
      /* ignore */
    }
  }
  return out
}

function attribute(s: LoafScript, markers: Map<string, Array<{ pos: number; id: string }>>): string {
  const url = s.sourceURL ?? ''
  const list = markers.get(url)
  if (list) {
    const pos = s.sourceCharPosition ?? -1
    let id = 'bundle'
    for (const mk of list) {
      if (mk.pos <= pos) id = mk.id
      else break
    }
    return `widget:${id}`
  }
  if (url.includes('/custom-assets/')) {
    const m = /\/custom-assets\/([a-z0-9-]+)\//.exec(url)
    return `widget:${m?.[1] ?? '?'}`
  }
  if (/^(chrome|moz|ms-browser|edge)-extension:/.test(url)) return 'Browser-Erweiterung'
  if (url.includes('/_next/')) return `host:${url.split('/').pop()?.split('?')[0] ?? ''}`
  if (!url) return `(ohne Quelle: ${s.invokerType ?? s.invoker ?? '?'})`
  return url.replace(window.location.origin, '').slice(0, 50)
}

const r = (n: number) => Math.round(n)
const pad = (v: string | number, n: number) => String(v).padEnd(n)
const padL = (v: string | number, n: number) => String(v).padStart(n)

async function report(): Promise<void> {
  const markers = await bundleMarkers()
  const frames: Frame[] = rawFrames
    .filter((f) => f.startTime < SUMMARY_DELAY_MS + 2_000)
    .map((f) => ({
      start: f.startTime,
      ms: f.duration,
      blockingMs: f.blockingDuration ?? 0,
      scripts: (f.scripts ?? []).map((s) => ({
        source: attribute(s, markers),
        fn: s.sourceFunctionName || s.invoker || '',
        ms: s.duration,
        forcedMs: s.forcedStyleAndLayoutDuration ?? 0,
      })),
    }))

  const bySource = new Map<string, { ms: number; forcedMs: number; count: number }>()
  for (const f of frames) {
    for (const s of f.scripts) {
      const e = bySource.get(s.source) ?? { ms: 0, forcedMs: 0, count: 0 }
      e.ms += s.ms
      e.forcedMs += s.forcedMs
      e.count += 1
      bySource.set(s.source, e)
    }
  }

  // Auch nicht eingehängte Plugins (außerhalb des Sichtfelds) mit ihrer Bundle-Größe zeigen.
  for (const id of bundleBytes.keys()) stat(id)
  const widgets = [...stats.entries()]
    .map(([id, s]) => ({
      id,
      ...s,
      kb: (bundleBytes.get(id) ?? 0) / 1024,
      total: s.renderMs + s.updateMs + s.layoutMs + s.effectMs,
    }))
    .sort((a, b) => b.total - a.total || b.kb - a.kb)
  const bundleKb = [...bundleBytes.values()].reduce((sum, b) => sum + b, 0) / 1024
  const profilerActive = widgets.some((w) => w.mounts > 0)

  const lines: string[] = []
  const totalBlocking = frames.reduce((sum, f) => sum + f.blockingMs, 0)
  lines.push(
    `[SelfDashboard][perf] Erste ${SUMMARY_DELAY_MS / 1000}s: ${frames.length} lange Frames, blockiert gesamt ${r(totalBlocking)}ms` +
      (frames.length ? `, längster ${r(Math.max(...frames.map((f) => f.ms)))}ms` : '') +
      (rawFrames.length === 0 ? ' (Long-Animation-Frames vom Browser nicht unterstützt)' : ''),
  )
  lines.push('')
  lines.push(
    `WIDGETS (ms; KB = Größe im Bundle, gesamt ${r(bundleKb)} KB)${profilerActive ? '' : ' — Render-Zeit fehlt: Build ohne --profile'}`,
  )
  lines.push(`${pad('plugin', 22)}${padL('gesamt', 7)}${padL('KB', 6)}${padL('render', 8)}${padL('layout', 8)}${padL('effekte', 9)}${padL('updates', 9)}${padL('upd-ms', 8)}${padL('max', 6)}`)
  for (const w of widgets.slice(0, 30)) {
    lines.push(
      `${pad(w.id, 22)}${padL(r(w.total), 7)}${padL(w.kb ? r(w.kb) : '-', 6)}${padL(r(w.renderMs), 8)}${padL(r(w.layoutMs), 8)}${padL(r(w.effectMs), 9)}${padL(w.updates, 9)}${padL(r(w.updateMs), 8)}${padL(r(w.maxMs), 6)}`,
    )
  }
  lines.push('')
  lines.push('BLOCKADE NACH VERURSACHER (Skriptzeit in langen Frames, ms)')
  lines.push(`${pad('quelle', 36)}${padL('ms', 7)}${padL('reflow', 8)}${padL('anzahl', 8)}`)
  for (const [src, e] of [...bySource.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 15)) {
    lines.push(`${pad(src.slice(0, 35), 36)}${padL(r(e.ms), 7)}${padL(r(e.forcedMs), 8)}${padL(e.count, 8)}`)
  }
  lines.push('')
  lines.push('LÄNGSTE FRAMES')
  for (const f of [...frames].sort((a, b) => b.ms - a.ms).slice(0, 6)) {
    const top = [...f.scripts]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3)
      .map((s) => `${s.source}${s.fn ? `(${s.fn.slice(0, 30)})` : ''} ${r(s.ms)}ms${s.forcedMs > 5 ? ` reflow ${r(s.forcedMs)}` : ''}`)
      .join(' | ')
    lines.push(`@${padL(r(f.start), 6)}ms  ${padL(r(f.ms), 5)}ms  ${top}`)
  }

  const text = lines.join('\n')
  ;(window as unknown as { __sdPerfReport?: unknown }).__sdPerfReport = { text, widgets, bySource: Object.fromEntries(bySource), frames }
  console.info(text)
}
