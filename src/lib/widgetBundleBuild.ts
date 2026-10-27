import 'server-only'

import fs from 'fs'
import vm from 'node:vm'
import { prepareWidgetJs } from './pluginWidgetJs'

/** Eine widget.js / widget.css auf dem Volume. */
export type WidgetBundleAsset = { id: string; abs: string; mtimeMs: number; size: number }

/** Fertige Bundle-Abschnitte pro Widget-Datei (Pfad + mtime + Größe) — neue Plugin-Kombinationen bauen nichts neu. */
const SECTION_CACHE_MAX = 200
const sectionCache = new Map<string, string>()

function cacheSection(key: string, section: string): string {
  sectionCache.delete(key)
  while (sectionCache.size >= SECTION_CACHE_MAX) {
    const first = sectionCache.keys().next().value
    if (first === undefined) break
    sectionCache.delete(first)
  }
  sectionCache.set(key, section)
  return section
}

async function buildSection(id: string, asset: WidgetBundleAsset): Promise<string> {
  const cacheKey = `${asset.abs}|${asset.mtimeMs}|${asset.size}`
  const cached = sectionCache.get(cacheKey)
  if (cached !== undefined) return cached

  const key = JSON.stringify(id)
  const code = await prepareWidgetJs(fs.readFileSync(asset.abs, 'utf8'))
  const wrapped = `(function(){\n${code}\n}).call(window);`
  try {
    new vm.Script(wrapped, { filename: `${id}/widget.js` })
  } catch (e) {
    return cacheSection(cacheKey, `__sdBundle[${key}]=${JSON.stringify(`syntax_error: ${e instanceof Error ? e.message : String(e)}`)};`)
  }
  return cacheSection(
    cacheKey,
    `/* ${id} */\ntry{${wrapped}__sdBundle[${key}]=true}catch(e){__sdBundle[${key}]=String(e&&e.message||e);console.error("[SelfDashboard] widget.js im Bundle fehlgeschlagen: "+${key},e)}`,
  )
}

/**
 * JS-Bundle: jedes Widget gekapselt in eigener Funktion + try/catch (ein kaputtes
 * Widget reißt die anderen nicht mit). Ergebnis pro Id in
 * window.__sdWidgetBundleResults[id] (true | Fehlertext). Syntaxfehler werden vorab
 * per vm.Script erkannt und nicht eingebunden. Abschnittsmarker `/* id *\/` nutzt der
 * Perf-Bericht für die Größe pro Widget. `.call(window)` und der Funktions-Prolog erhalten `this` und
 * ein eventuelles "use strict" des Originals.
 */
export async function buildWidgetJsBundle(ids: string[], assets: Map<string, WidgetBundleAsset>): Promise<string> {
  const parts = [
    '/* SelfDashboard widget bundle */',
    'var __sdBundle=(window.__sdWidgetBundleResults=window.__sdWidgetBundleResults||{});',
  ]
  for (const id of ids) {
    const asset = assets.get(id)
    parts.push(asset ? await buildSection(id, asset) : `__sdBundle[${JSON.stringify(id)}]="missing";`)
  }
  return parts.join('\n') + '\n'
}

export function buildWidgetCssBundle(ids: string[], assets: Map<string, WidgetBundleAsset>): string {
  return ids
    .map((id) => assets.get(id))
    .filter((a): a is WidgetBundleAsset => Boolean(a))
    .map((a) => `/* ${a.id} */\n${fs.readFileSync(a.abs, 'utf8')}`)
    .join('\n')
}
