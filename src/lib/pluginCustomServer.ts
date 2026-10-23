import 'server-only'

import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { requireAdmin, requireAuth, requireFullAdmin } from '@/lib/auth/guard'
import {
  registerPluginServerHandler,
  unregisterPluginServerHandler,
  type PluginServerContext,
  type PluginServerHandler,
} from '@/lib/pluginServerRegistry'
import { customPluginDir, getCustomServerPluginIds } from '@/lib/pluginVolumeInfo'
import { logServerTiming } from '@/lib/serverTiming'

const loadedCustomServerIds = new Set<string>()

/**
 * Volume-server.mjs können `@/lib/auth/guard` nicht importieren — sie greifen über
 * plugins-pack/_shared/host-guard.ts auf diese Brücke zu (fehlt sie, lehnt das Plugin ab).
 */
function installServerHostBridge(): void {
  ;(globalThis as Record<string, unknown>).__selfDashboardServerHost = {
    requireAuth,
    requireAdmin,
    requireFullAdmin,
  }
}

function resolveServerModulePath(id: string): string | null {
  const dir = customPluginDir(id)
  const candidates = ['server.mjs', 'server.js']
  for (const file of candidates) {
    const p = path.join(dir, file)
    if (path.resolve(p).startsWith(path.resolve(dir)) && path.basename(p) === file && fs.existsSync(p)) {
      return p
    }
  }
  return null
}

function wrapVolumeHandler(id: string, fn: (ctx: PluginServerContext) => Promise<Response>): PluginServerHandler {
  return (ctx) => fn(ctx)
}

type ServerModule = Record<string, unknown> & {
  default?: PluginServerHandler
  handler?: PluginServerHandler
}

async function loadVolumeServerModule(id: string): Promise<ServerModule | null> {
  const modulePath = resolveServerModulePath(id)
  if (!modulePath) return null

  try {
    const url = `${pathToFileURL(modulePath).href}?t=${Date.now()}`
    return (await import(/* webpackIgnore: true */ url)) as ServerModule
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[SelfDashboard] custom/${id}/server.* failed to load (${msg}). Reinstall plugin from store.`)
    return null
  }
}

async function importVolumeServer(id: string): Promise<PluginServerHandler | null> {
  const mod = await loadVolumeServerModule(id)
  if (!mod) return null

  const raw = mod.default ?? mod.handler
  if (typeof raw !== 'function') {
    console.warn(`[SelfDashboard] custom/${id}/server.*: no default export handler`)
    return null
  }
  return wrapVolumeHandler(id, raw as PluginServerHandler)
}

export async function loadCustomPluginServers(): Promise<string[]> {
  return reloadCustomPluginServers()
}

export async function reloadCustomPluginServers(): Promise<string[]> {
  installServerHostBridge()
  for (const id of loadedCustomServerIds) {
    unregisterPluginServerHandler(id)
  }
  loadedCustomServerIds.clear()

  const loaded: string[] = []
  const durations: Array<[string, number]> = []
  const t0 = performance.now()
  for (const id of getCustomServerPluginIds()) {
    const t = performance.now()
    const handler = await importVolumeServer(id)
    durations.push([id, performance.now() - t])
    if (!handler) continue
    registerPluginServerHandler(id, handler, { source: 'custom', replace: true })
    loadedCustomServerIds.add(id)
    loaded.push(id)
  }
  const total = performance.now() - t0
  const slowest = [...durations]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, ms]) => `${id} ${ms.toFixed(0)}ms`)
    .join(', ')
  logServerTiming(
    `server.mjs geladen: ${loaded.length}/${durations.length} in ${total.toFixed(0)}ms (pid ${process.pid}) — langsamste: ${slowest || '-'}`,
    total >= 2000,
  )
  return loaded
}
