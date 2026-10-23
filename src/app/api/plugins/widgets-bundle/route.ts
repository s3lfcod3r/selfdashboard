import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { requirePluginAccess } from '@/lib/auth/guard'
import { customPluginDir, readInstalledPluginVersion } from '@/lib/pluginVolumeInfo'
import { buildWidgetCssBundle, buildWidgetJsBundle, type WidgetBundleAsset } from '@/lib/widgetBundleBuild'
import { createServerTiming } from '@/lib/serverTiming'
import { WIDGET_BUNDLE_MAX_IDS, widgetBundleVersionKey } from '@/lib/widgetBundleKey'

export const dynamic = 'force-dynamic'

/**
 * Alle widget.js (type=js) bzw. widget.css (type=css) mehrerer Volume-Plugins in
 * EINER Antwort — statt je Plugin eigener Requests (Browser: max. 6 parallel bei HTTP/1.1).
 *
 * JS: jedes Widget läuft gekapselt in eigener Funktion + try/catch, ein kaputtes
 * Widget reißt die anderen nicht mit. Ergebnis pro Id in
 * window.__sdWidgetBundleResults[id] (true | Fehlertext); der Client lädt
 * fehlgeschlagene/fehlende Ids einzeln nach. Syntaxfehler werden serverseitig
 * erkannt (vm.Script) und gar nicht erst eingebunden.
 */

const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const BODY_CACHE_MAX = 16
const bodyCache = new Map<string, string>()

type Asset = WidgetBundleAsset

function cacheBody(key: string, body: string): void {
  bodyCache.delete(key)
  while (bodyCache.size >= BODY_CACHE_MAX) {
    const first = bodyCache.keys().next().value
    if (first === undefined) break
    bodyCache.delete(first)
  }
  bodyCache.set(key, body)
}

function statAsset(id: string, file: string): Asset | null {
  const dir = customPluginDir(id)
  const abs = path.join(dir, file)
  if (!path.resolve(abs).startsWith(path.resolve(dir))) return null
  try {
    const st = fs.statSync(abs)
    return st.isFile() ? { id, abs, mtimeMs: st.mtimeMs, size: st.size } : null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const timing = createServerTiming('GET /api/plugins/widgets-bundle')
  const url = new URL(req.url)
  const type = url.searchParams.get('type') === 'css' ? 'css' : 'js'
  const ids = [
    ...new Set(
      (url.searchParams.get('ids') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => ID_RE.test(s)),
    ),
  ].slice(0, WIDGET_BUNDLE_MAX_IDS)
  if (ids.length === 0) {
    return timing.apply(NextResponse.json({ error: 'missing_ids' }, { status: 400 }))
  }

  const allowed = timing.measure('auth', () =>
    ids.filter((id) => !(requirePluginAccess(req, id) instanceof NextResponse)),
  )
  if (allowed.length === 0) {
    return timing.apply(NextResponse.json({ error: 'plugin_forbidden' }, { status: 403 }))
  }

  const file = type === 'css' ? 'widget.css' : 'widget.js'
  const { assets, versions } = timing.measure('stat', () => {
    const assets = new Map<string, Asset>()
    const versions: Record<string, string> = {}
    for (const id of allowed) {
      const a = statAsset(id, file)
      if (a) assets.set(id, a)
      versions[id] = readInstalledPluginVersion(id) ?? '0'
    }
    return { assets, versions }
  })

  // Nicht erlaubte Ids tauchen im Bundle als "missing" auf (Client lädt sie einzeln → 403 wie bisher).
  const fingerprint = [type, ...ids.map((id) => {
    const a = assets.get(id)
    return `${id}:${allowed.includes(id) ? 1 : 0}:${a ? `${a.mtimeMs}:${a.size}` : '-'}`
  })].join('|')
  let body = bodyCache.get(fingerprint)
  if (body === undefined) {
    const forBuild = new Map([...assets].filter(([id]) => allowed.includes(id)))
    body = type === 'css'
      ? timing.measure('build', () => buildWidgetCssBundle(ids, forBuild))
      : await timing.measure('build', () => buildWidgetJsBundle(ids, forBuild))
    cacheBody(fingerprint, body)
  } else {
    timing.add('build', 0, 'cache')
  }
  timing.add('size', 0, `${Math.round(body.length / 1024)}KB/${assets.size}`)

  const expected = widgetBundleVersionKey(ids, versions)
  const versionMatches = url.searchParams.get('v') === expected
  return timing.apply(
    new NextResponse(body, {
      headers: {
        'Content-Type': type === 'css' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
        'Cache-Control': versionMatches ? 'private, max-age=31536000, immutable' : 'no-store',
        // Manually-built NextResponse does not inherit next.config.js headers().
        'X-Content-Type-Options': 'nosniff',
      },
    }),
  )
}
