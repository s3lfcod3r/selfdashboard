import fs from 'fs'
import os from 'os'
import path from 'path'
import vm from 'node:vm'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildWidgetCssBundle, buildWidgetJsBundle, type WidgetBundleAsset } from './widgetBundleBuild'
import { widgetBundleVersionKey } from './widgetBundleKey'

let dir = ''
const assets = new Map<string, WidgetBundleAsset>()

function addAsset(id: string, file: string, content: string): void {
  const abs = path.join(dir, `${id}-${file}`)
  fs.writeFileSync(abs, content)
  assets.set(`${id}:${file}`, { id, abs, mtimeMs: 0, size: content.length })
}

function pick(file: string, ids: string[]): Map<string, WidgetBundleAsset> {
  const out = new Map<string, WidgetBundleAsset>()
  for (const id of ids) {
    const a = assets.get(`${id}:${file}`)
    if (a) out.set(id, a)
  }
  return out
}

function runBundle(code: string): { window: Record<string, unknown>; errors: unknown[] } {
  const errors: unknown[] = []
  const window: Record<string, unknown> = { registered: [] as string[] }
  const context = vm.createContext({ window, console: { error: (...a: unknown[]) => errors.push(a) } })
  window.window = window
  vm.runInContext(code, context)
  return { window, errors }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-bundle-'))
  addAsset('ok-a', 'widget.js', 'this.registered.push("ok-a")')
  addAsset('strict', 'widget.js', '"use strict";(function(){ window.registered.push(typeof this) })()')
  addAsset('throws', 'widget.js', 'window.registered.push("throws-start"); throw new Error("kaputt")')
  addAsset('syntax', 'widget.js', 'function (')
  addAsset('ok-b', 'widget.js', 'window.registered.push("ok-b")')
  addAsset('ok-a', 'widget.css', '.a{color:red}')
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('buildWidgetJsBundle', () => {
  it('lädt gute Widgets, isoliert Laufzeit- und Syntaxfehler, meldet fehlende', async () => {
    const ids = ['ok-a', 'strict', 'throws', 'syntax', 'missing', 'ok-b']
    const code = await buildWidgetJsBundle(ids, pick('widget.js', ids))
    const { window, errors } = runBundle(code)
    const results = window.__sdWidgetBundleResults as Record<string, unknown>

    expect(results['ok-a']).toBe(true)
    expect(results['ok-b']).toBe(true)
    expect(results.strict).toBe(true)
    expect(results.throws).toBe('kaputt')
    expect(String(results.syntax)).toMatch(/^syntax_error:/)
    expect(results.missing).toBe('missing')
    // ok-b läuft trotz Fehler davor; "use strict" bleibt erhalten (this in IIFE = undefined).
    expect(window.registered).toEqual(['ok-a', 'undefined', 'throws-start', 'ok-b'])
    expect(errors).toHaveLength(1)
  })
})

describe('buildWidgetCssBundle', () => {
  it('fügt nur vorhandene widget.css zusammen', () => {
    const css = buildWidgetCssBundle(['ok-a', 'ok-b'], pick('widget.css', ['ok-a', 'ok-b']))
    expect(css).toContain('/* ok-a */')
    expect(css).toContain('.a{color:red}')
    expect(css).not.toContain('ok-b')
  })
})

describe('widgetBundleVersionKey', () => {
  it('ist stabil und ändert sich mit Version oder Id-Liste', () => {
    const k = widgetBundleVersionKey(['a', 'b'], { a: '1.0.0', b: '2.0.0' })
    expect(k).toMatch(/^[0-9a-f]{8}$/)
    expect(widgetBundleVersionKey(['a', 'b'], { a: '1.0.0', b: '2.0.0' })).toBe(k)
    expect(widgetBundleVersionKey(['a', 'b'], { a: '1.0.1', b: '2.0.0' })).not.toBe(k)
    expect(widgetBundleVersionKey(['a'], { a: '1.0.0' })).not.toBe(k)
  })
})
