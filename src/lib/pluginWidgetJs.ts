import 'server-only'

import { createHash } from 'crypto'
import type { ServerTiming } from '@/lib/serverTiming'

/**
 * Aufbereitung von Volume-widget.js beim Ausliefern (Einzel-Asset und Widget-Bundle).
 *
 * - Aeltere WebViews (z.B. Chromium 74 auf Billig-Tablets/TV-Boxen) verstehen
 *   kein Optional Chaining (?.) o.ae. Plugin-JS wird daher auf ein aelteres Ziel
 *   heruntertranspiliert, damit Widgets ueberall laden.
 * - Unminifizierter Code (z. B. alte Plugin-Builds mit 50+ KB) wird automatisch
 *   minifiziert — weniger Bytes, schnelleres Parsen im Browser.
 *
 * esbuild laeuft asynchron (eigener Prozess, blockiert den Server nicht); das
 * Ergebnis wird pro Inhalt gecacht, jedes Widget also nur einmal bearbeitet.
 * Faellt bei Fehlern (oder ohne esbuild) auf den Originalinhalt zurueck.
 */

const CACHE_MAX = 200
const cache = new Map<string, string>()

/** Grob: viele Zeilen bzw. kurze Zeilen → nicht minifiziert. */
export function looksUnminified(code: string): boolean {
  const lines = code.split('\n').length
  return lines > 40 && code.length / lines < 200
}

function remember(key: string, value: string): string {
  cache.delete(key)
  while (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value
    if (first === undefined) break
    cache.delete(first)
  }
  cache.set(key, value)
  return value
}

// React-Inline-Styles wie {position:"fixed",inset:0,...}: `inset` (erst
// Chrome 87) versteht Chromium 74 nicht -> Overlay fuellt den Screen nicht,
// Dialoge zentrieren nicht. Auf top/right/bottom/left umschreiben.
function fixInset(code: string): string {
  return code.replace(
    /([{,])\s*inset\s*:\s*(0|(["'])0(?:px)?\3)\s*([,}])/g,
    (_m, pre, val, _q, post) => `${pre}top:${val},right:${val},bottom:${val},left:${val}${post}`,
  )
}

export async function prepareWidgetJs(code: string, timing?: ServerTiming): Promise<string> {
  const key = createHash('sha1').update(code).digest('hex')
  const hit = cache.get(key)
  if (hit !== undefined) {
    timing?.add('transpile', 0, 'cache')
    return hit
  }
  const minify = looksUnminified(code)
  let out = code
  try {
    const esbuild = await import('esbuild')
    const transform =
      (esbuild as { transform?: typeof import('esbuild').transform }).transform ??
      (esbuild as { default?: typeof import('esbuild') }).default?.transform
    if (transform) {
      const t0 = performance.now()
      out = (await transform(code, { loader: 'js', target: ['es2017'], minify })).code
      timing?.add('transpile', performance.now() - t0, minify ? 'esbuild es2017+minify' : 'esbuild es2017')
    } else {
      timing?.add('transpile', 0, 'esbuild ohne transform')
    }
  } catch {
    /* esbuild fehlt oder Code nicht parsebar — Originalcode weiterverwenden. */
    out = code
    timing?.add('transpile', 0, 'esbuild fehlt/Fehler')
  }
  try {
    return remember(key, fixInset(out))
  } catch {
    return code
  }
}
