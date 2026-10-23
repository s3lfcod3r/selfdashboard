import 'server-only'

import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { dataDir } from './dataDir'

/**
 * Große eingebettete Bilder (data:-URIs) aus Widget-Konfigurationen auslagern.
 *
 * Beispiel: App Bookmarks speicherte 22 Icons als PNG-data:-URIs (≈ 2,2 MB) direkt
 * im Dashboard-Zustand — bei jedem Seitenaufruf geladen, geparst, in den Store und
 * nach localStorage geschrieben.
 *
 * - Gespeichert wird `sdblob:<sha256>.<ext>`, die Datei liegt unter <data>/blobs/
 *   (inhaltsadressiert, verlustfrei 1:1).
 * - Beim Ausliefern wird daraus eine ABSOLUTE URL
 *   `<origin>/api/dashboard-blob/<sha256>.<ext>` (Widgets wie Bookmarks erkennen
 *   Bilder nur an `data:` oder `http…`).
 * - Beim Speichern werden solche URLs wieder zu `sdblob:`-Platzhaltern.
 *
 * Nur für Plugins in BLOB_PLUGINS — andere könnten data:-URIs erwarten.
 */

export const BLOB_PLUGINS = new Set(['bookmarks'])

const MIN_BASE64_CHARS = 8 * 1024
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}
export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
)

const DATA_URI_RE = /data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})/g
const TOKEN_RE = /sdblob:([a-f0-9]{64})\.(png|jpg|gif|webp|svg)/g
const BLOB_URL_RE = /https?:\/\/[^\s"'\\<>]*?\/api\/dashboard-blob\/([a-f0-9]{64})\.(png|jpg|gif|webp|svg)/g
export const BLOB_FILE_RE = /^([a-f0-9]{64})\.(png|jpg|gif|webp|svg)$/

export function blobDir(): string {
  return path.join(dataDir(), 'blobs')
}

function storeBlob(mime: string, base64: string): string | null {
  const ext = EXT_BY_MIME[mime]
  if (!ext) return null
  const bytes = Buffer.from(base64, 'base64')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const file = path.join(blobDir(), `${hash}.${ext}`)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(blobDir(), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, bytes)
    fs.renameSync(tmp, file)
  }
  return `sdblob:${hash}.${ext}`
}

function mapStrings(value: unknown, fn: (s: string) => string): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const next = fn(value)
    return { value: next, changed: next !== value }
  }
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((v) => {
      const r = mapStrings(v, fn)
      changed ||= r.changed
      return r.value
    })
    return { value: changed ? out : value, changed }
  }
  if (value && typeof value === 'object') {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const r = mapStrings(v, fn)
      changed ||= r.changed
      out[k] = r.value
    }
    return { value: changed ? out : value, changed }
  }
  return { value, changed: false }
}

type StateLike = { dashboards?: Array<{ plugins?: Array<{ pluginId?: string; config?: unknown }> }> }

function mapBlobPluginConfigs<T>(state: T, fn: (s: string) => string): { state: T; changed: boolean } {
  const s = state as StateLike
  if (!s || !Array.isArray(s.dashboards)) return { state, changed: false }
  let changed = false
  const dashboards = s.dashboards.map((d) => {
    if (!d || !Array.isArray(d.plugins)) return d
    let dChanged = false
    const plugins = d.plugins.map((p) => {
      if (!p || !BLOB_PLUGINS.has(String(p.pluginId)) || p.config === undefined) return p
      const r = mapStrings(p.config, fn)
      if (!r.changed) return p
      dChanged = true
      return { ...p, config: r.value }
    })
    if (!dChanged) return d
    changed = true
    return { ...d, plugins }
  })
  return { state: changed ? ({ ...s, dashboards } as T) : state, changed }
}

/** Vor dem Speichern: große data:-URIs → Datei + Platzhalter, absolute Blob-URLs → Platzhalter. */
export function extractDashboardBlobs<T>(state: T): { state: T; changed: boolean } {
  return mapBlobPluginConfigs(state, (str) => {
    if (!str.includes('data:image/') && !str.includes('/api/dashboard-blob/')) return str
    return str
      .replace(BLOB_URL_RE, (_m, hash: string, ext: string) => `sdblob:${hash}.${ext}`)
      .replace(DATA_URI_RE, (m, mime: string, b64: string) => {
        if (b64.length < MIN_BASE64_CHARS) return m
        try {
          return storeBlob(mime, b64) ?? m
        } catch {
          return m // Auslagern fehlgeschlagen → Bild bleibt eingebettet, nichts geht verloren
        }
      })
  })
}

/** Vor dem Ausliefern: Platzhalter → absolute URL für den anfragenden Browser. */
export function expandDashboardBlobs<T>(state: T, origin: string): T {
  return mapBlobPluginConfigs(state, (str) =>
    str.includes('sdblob:')
      ? str.replace(TOKEN_RE, (_m, hash: string, ext: string) => `${origin}/api/dashboard-blob/${hash}.${ext}`)
      : str,
  ).state
}

/** Origin, über die der Browser diese Anfrage gestellt hat (auch hinter Reverse-Proxy). */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || url.host
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '')
  return `${proto}://${host}`
}
