import 'server-only'

import fs from 'fs'
import path from 'path'
import { parseReadCacheRule, type ReadRuleOverride } from '@/lib/pluginReadCache'
import { customPluginDir } from '@/lib/pluginVolumeInfo'

/** `readCache` aus der installierten plugin.json (kurz gecacht, damit nicht jeder Request liest). */

const TTL_MS = 30_000
const cache = new Map<string, { at: number; rule: ReadRuleOverride }>()

export function manifestReadRule(pluginId: string): ReadRuleOverride {
  const hit = cache.get(pluginId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rule
  let rule: ReadRuleOverride
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(customPluginDir(pluginId), 'plugin.json'), 'utf8')) as {
      readCache?: unknown
    }
    rule = parseReadCacheRule(raw.readCache)
  } catch {
    rule = undefined
  }
  cache.set(pluginId, { at: Date.now(), rule })
  return rule
}
