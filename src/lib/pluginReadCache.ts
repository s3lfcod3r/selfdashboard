import 'server-only'

import { createPluginStaleCache, staleCacheKey, type PluginStaleCache } from './pluginStaleCache'

/**
 * Zentraler Lese-Cache für Plugin-APIs (/api/plugins/<id>/…), ohne die Plugins zu ändern.
 *
 * Ziel: Kein Plugin hält eine der (bei HTTP/1.1) nur 6 Browser-Verbindungen lange
 * fest. Ein veralteter Eintrag wird frisch geladen; dauert das länger als
 * MAX_WAIT_MS, kommt die letzte Antwort und das Laden läuft im Hintergrund weiter.
 *
 * NUR freigegebene Plugins/Aktionen werden gecacht: per `readCache` in der plugin.json
 * des Plugins (Vorrang) oder per Fallback-Tabelle RULES. Alles andere (neue Plugins
 * ohne Angabe, Aktionen wie Licht schalten) läuft unverändert durch. Jede nicht gecachte
 * Anfrage an ein Plugin (also auch jede Aktion) leert dessen Cache, damit ein
 * neuer Zustand sofort sichtbar ist.
 *
 * Ausgenommen sind Plugins mit eigenem Cache (docker, adguard, crowdsec,
 * netzwacht, openclaw-status), mit Raten aus Differenzen zweier Abfragen
 * (llm-tempo, zoraxy), mit Live-Bildern (bambu-cam) und mail/calendar.
 *
 * Env: SELFDASHBOARD_PLUGIN_READ_CACHE=0 schaltet den Cache ab.
 */

export type ReadRule = {
  methods: ReadonlyArray<'GET' | 'POST'>
  /** POST: erlaubte Werte von body.action (null = Feld fehlt). Undefined = jeder POST liest nur. */
  readActions?: ReadonlyArray<string | null>
}

/** Aus plugin.json `readCache`: Regel, `false` (Opt-out) oder undefined (keine/ungültige Angabe). */
export type ReadRuleOverride = ReadRule | false | undefined

/**
 * `readCache` aus plugin.json prüfen, z. B.
 *   "readCache": { "methods": ["POST"], "readActions": [null, "status"] }
 *   "readCache": false
 * Ungültige Angaben werden ignoriert (→ Fallback auf RULES).
 */
export function parseReadCacheRule(raw: unknown): ReadRuleOverride {
  if (raw === false) return false
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.methods) || o.methods.length === 0) return undefined
  if (!o.methods.every((m) => m === 'GET' || m === 'POST')) return undefined
  const rule: ReadRule = { methods: o.methods as Array<'GET' | 'POST'> }
  if (o.readActions !== undefined) {
    if (!Array.isArray(o.readActions)) return undefined
    if (!o.readActions.every((a) => a === null || (typeof a === 'string' && a.length > 0))) return undefined
    return { ...rule, readActions: o.readActions as Array<string | null> }
  }
  return rule
}

/**
 * Fallback für installierte Plugins, deren plugin.json noch kein `readCache` hat.
 * Neue Plugins: Regel in ihre plugin.json schreiben statt hier eintragen.
 */
const RULES: Record<string, ReadRule> = {
  'shelly-plug': { methods: ['POST'], readActions: [null, 'status', 'history'] },
  homematic: { methods: ['POST'], readActions: [null, 'state', 'list'] },
  hue: { methods: ['POST'], readActions: [null, 'state'] },
  dreame: { methods: ['POST'], readActions: [null, 'status'] },
  'selfmailer-calendar': { methods: ['POST'], readActions: [null, 'summary', 'targets', 'calendars'] },
  'selfstream-emby': { methods: ['POST'] },
  'llm-token': { methods: ['POST'] },
  'uptime-kuma': { methods: ['POST'] },
  wireguard: { methods: ['POST'] },
  weather: { methods: ['GET'] },
  parcel: { methods: ['GET'] },
}

const FRESH_MS = 2_000
const STALE_MS = 10 * 60_000
const MAX_WAIT_MS = 300

const caches = new Map<string, PluginStaleCache>()

function enabled(): boolean {
  return process.env.SELFDASHBOARD_PLUGIN_READ_CACHE !== '0'
}

/** Wirksame Regel: plugin.json (`override`) vor RULES; `false` = Plugin hat abgewählt. */
function ruleFor(pluginId: string, override: ReadRuleOverride): ReadRule | null {
  if (override === false) return null
  return override ?? RULES[pluginId] ?? null
}

/** true, wenn Plugin + Methode (+ body.action) laut Regel nur lesen. */
export function isCacheablePluginRead(
  pluginId: string,
  method: string,
  bodyText: string,
  override?: ReadRuleOverride,
): boolean {
  if (!enabled()) return false
  const rule = ruleFor(pluginId, override)
  if (!rule || !rule.methods.includes(method as 'GET' | 'POST')) return false
  if (method !== 'POST' || !rule.readActions) return true
  let action: string | null = null
  if (bodyText) {
    try {
      const body = JSON.parse(bodyText) as unknown
      if (!body || typeof body !== 'object' || Array.isArray(body)) return false
      const raw = (body as Record<string, unknown>).action
      if (raw !== undefined && typeof raw !== 'string') return false
      action = typeof raw === 'string' ? raw : null
    } catch {
      return false
    }
  }
  return rule.readActions.includes(action)
}

export function pluginReadCacheKey(userId: string, method: string, url: string, bodyText: string): string {
  const u = new URL(url)
  return staleCacheKey(userId, method, u.pathname, u.search, bodyText)
}

export function pluginReadCache(pluginId: string): PluginStaleCache {
  let cache = caches.get(pluginId)
  if (!cache) {
    cache = createPluginStaleCache({
      freshMs: FRESH_MS,
      staleMs: STALE_MS,
      maxWaitMs: MAX_WAIT_MS,
      maxEntries: 64,
      label: `read-cache/${pluginId}`,
    })
    caches.set(pluginId, cache)
  }
  return cache
}

/** Nach einer nicht gecachten Anfrage (z. B. Aktion) aufrufen. */
export function invalidatePluginReadCache(pluginId: string): void {
  caches.get(pluginId)?.clear()
}

export function hasPluginReadRule(pluginId: string, override?: ReadRuleOverride): boolean {
  return enabled() && ruleFor(pluginId, override) !== null
}
