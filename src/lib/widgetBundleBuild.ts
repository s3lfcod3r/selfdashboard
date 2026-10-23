import 'server-only'

import fs from 'fs'
import vm from 'node:vm'
import { prepareWidgetJs } from './pluginWidgetJs'

/** Eine widget.js / widget.css auf dem Volume. */
export type WidgetBundleAsset = { id: string; abs: string; mtimeMs: number; size: number }

/**
 * JS-Bundle: jedes Widget gekapselt in eigener Funktion + try/catch (ein kaputtes
 * Widget reißt die anderen nicht mit). Ergebnis pro Id in
 * window.__sdWidgetBundleResults[id] (true | Fehlertext). Syntaxfehler werden
 * vorab per vm.Script erkannt und nicht eingebunden. `.call(window)` und der
 * Funktions-Prolog erhalten `this` und ein eventuelles "use strict" des Originals.
 */
export async function buildWidgetJsBundle(ids: string[], assets: Map<string, WidgetBundleAsset>): Promise<string> {
  const parts = [
    '/* SelfDashboard widget bundle */',
    'var __sdBundle=(window.__sdWidgetBundleResults=window.__sdWidgetBundleResults||{});',
  ]
  for (const id of ids) {
    const key = JSON.stringify(id)
    const asset = assets.get(id)
    if (!asset) {
      parts.push(`__sdBundle[${key}]="missing";`)
      continue
    }
    const code = await prepareWidgetJs(fs.readFileSync(asset.abs, 'utf8'))
    const wrapped = `(function(){\n${code}\n}).call(window);`
    try {
      new vm.Script(wrapped, { filename: `${id}/widget.js` })
    } catch (e) {
      parts.push(`__sdBundle[${key}]=${JSON.stringify(`syntax_error: ${e instanceof Error ? e.message : String(e)}`)};`)
      continue
    }
    parts.push(
      `/* ${id} */\ntry{${wrapped}__sdBundle[${key}]=true}catch(e){__sdBundle[${key}]=String(e&&e.message||e);console.error("[SelfDashboard] widget.js im Bundle fehlgeschlagen: "+${key},e)}`,
    )
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
