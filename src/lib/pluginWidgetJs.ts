import 'server-only'

import type { ServerTiming } from '@/lib/serverTiming'

/**
 * Aufbereitung von Volume-widget.js beim Ausliefern (Einzel-Asset und Widget-Bundle).
 *
 * Aeltere WebViews (z.B. Chromium 74 auf Billig-Tablets/TV-Boxen) verstehen
 * kein Optional Chaining (?.) o.ae. Plugin-JS wird daher auf ein aelteres Ziel
 * heruntertranspiliert, damit Widgets ueberall laden. Faellt bei Fehlern auf den
 * Originalinhalt zurueck.
 */
export async function prepareWidgetJs(code: string, timing?: ServerTiming): Promise<string> {
  const measure = <T,>(name: string, fn: () => T, desc?: string): T =>
    timing ? timing.measure(name, fn, desc) : fn()
  try {
    let out = code
    try {
      const esbuild = await measure('esbuild-import', () => import('esbuild'))
      const transform = (esbuild as { transformSync?: typeof import('esbuild').transformSync }).transformSync
        ?? (esbuild as { default?: typeof import('esbuild') }).default?.transformSync
      if (transform) {
        out = measure('transpile', () => transform(out, { loader: 'js', target: ['es2017'] }).code, 'esbuild es2017')
      } else {
        timing?.add('transpile', 0, 'esbuild ohne transformSync')
      }
    } catch {
      /* esbuild optional — ohne Transpile weiter mit Originalcode. */
      timing?.add('transpile', 0, 'esbuild fehlt')
    }
    // React-Inline-Styles wie {position:"fixed",inset:0,...}: `inset` (erst
    // Chrome 87) versteht Chromium 74 nicht -> Overlay fuellt den Screen nicht,
    // Dialoge zentrieren nicht. Auf top/right/bottom/left umschreiben.
    return out.replace(
      /([{,])\s*inset\s*:\s*(0|(["'])0(?:px)?\3)\s*([,}])/g,
      (_m, pre, val, _q, post) => `${pre}top:${val},right:${val},bottom:${val},left:${val}${post}`,
    )
  } catch {
    /* Original ausliefern, wenn Nachbearbeitung nicht moeglich ist. */
    return code
  }
}
