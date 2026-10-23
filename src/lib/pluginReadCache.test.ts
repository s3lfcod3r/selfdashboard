import { describe, it, expect } from 'vitest'
import { hasPluginReadRule, isCacheablePluginRead, parseReadCacheRule, pluginReadCacheKey } from './pluginReadCache'

const post = (body: unknown) => JSON.stringify(body)

describe('isCacheablePluginRead', () => {
  it('unbekannte Plugins werden nie gecacht', () => {
    expect(hasPluginReadRule('neues-plugin')).toBe(false)
    expect(isCacheablePluginRead('neues-plugin', 'POST', post({}))).toBe(false)
    expect(isCacheablePluginRead('zoraxy', 'POST', post({}))).toBe(false)
    expect(isCacheablePluginRead('llm-tempo', 'POST', post({ servers: [] }))).toBe(false)
  })

  it('Lese-Aktionen ja, schaltende Aktionen nein', () => {
    expect(isCacheablePluginRead('shelly-plug', 'POST', post({ devices: [] }))).toBe(true)
    expect(isCacheablePluginRead('shelly-plug', 'POST', post({ action: 'status' }))).toBe(true)
    expect(isCacheablePluginRead('shelly-plug', 'POST', post({ action: 'history' }))).toBe(true)
    expect(isCacheablePluginRead('shelly-plug', 'POST', post({ action: 'switch', on: true }))).toBe(false)
    expect(isCacheablePluginRead('hue', 'POST', post({ action: 'set' }))).toBe(false)
    expect(isCacheablePluginRead('hue', 'POST', post({ action: 'pair' }))).toBe(false)
    expect(isCacheablePluginRead('dreame', 'POST', post({ action: 'command' }))).toBe(false)
    expect(isCacheablePluginRead('selfmailer-calendar', 'POST', post({ action: 'delete' }))).toBe(false)
    expect(isCacheablePluginRead('selfmailer-calendar', 'POST', post({ action: 'summary' }))).toBe(true)
  })

  it('unbekannte oder seltsame Bodies werden nicht gecacht', () => {
    expect(isCacheablePluginRead('hue', 'POST', post({ action: 'neu-erfunden' }))).toBe(false)
    expect(isCacheablePluginRead('hue', 'POST', post({ action: 42 }))).toBe(false)
    expect(isCacheablePluginRead('hue', 'POST', 'kein json')).toBe(false)
    expect(isCacheablePluginRead('hue', 'POST', post([1, 2]))).toBe(false)
  })

  it('Methode muss passen', () => {
    expect(isCacheablePluginRead('weather', 'GET', '')).toBe(true)
    expect(isCacheablePluginRead('weather', 'POST', post({}))).toBe(false)
    expect(isCacheablePluginRead('wireguard', 'POST', post({ url: 'x' }))).toBe(true)
    expect(isCacheablePluginRead('wireguard', 'DELETE', '')).toBe(false)
  })

  it('plugin.json-Regel (readCache) gilt für neue Plugins und hat Vorrang', () => {
    const rule = parseReadCacheRule({ methods: ['POST'], readActions: [null, 'status'] })
    expect(hasPluginReadRule('neues-plugin', rule)).toBe(true)
    expect(isCacheablePluginRead('neues-plugin', 'POST', post({ action: 'status' }), rule)).toBe(true)
    expect(isCacheablePluginRead('neues-plugin', 'POST', post({ action: 'switch' }), rule)).toBe(false)
    // Vorrang vor der Fallback-Tabelle: hier wird 'history' nicht mehr freigegeben.
    expect(isCacheablePluginRead('shelly-plug', 'POST', post({ action: 'history' }), rule)).toBe(false)
  })

  it('readCache: false schaltet ab, ungültige Angaben fallen auf die Tabelle zurück', () => {
    expect(parseReadCacheRule(false)).toBe(false)
    expect(hasPluginReadRule('weather', false)).toBe(false)
    expect(isCacheablePluginRead('weather', 'GET', '', false)).toBe(false)
    for (const bad of [{}, { methods: [] }, { methods: ['PUT'] }, { methods: ['POST'], readActions: 'status' }, 'ja', 1]) {
      expect(parseReadCacheRule(bad)).toBeUndefined()
    }
    expect(isCacheablePluginRead('weather', 'GET', '', parseReadCacheRule({ methods: ['PUT'] }))).toBe(true)
  })

  it('Schlüssel trennt Nutzer, Pfad, Query und Body', () => {
    const k = pluginReadCacheKey('u1', 'POST', 'http://x/api/plugins/hue/?a=1', '{"x":1}')
    expect(pluginReadCacheKey('u1', 'POST', 'http://x/api/plugins/hue/?a=1', '{"x":1}')).toBe(k)
    expect(pluginReadCacheKey('u2', 'POST', 'http://x/api/plugins/hue/?a=1', '{"x":1}')).not.toBe(k)
    expect(pluginReadCacheKey('u1', 'POST', 'http://x/api/plugins/hue/?a=2', '{"x":1}')).not.toBe(k)
    expect(pluginReadCacheKey('u1', 'POST', 'http://x/api/plugins/hue/?a=1', '{"x":2}')).not.toBe(k)
  })
})
