'use client'

import { installPluginExternalBridge } from '@/lib/pluginExternalBridge'
import { kioskAwareFetch } from '@/lib/kiosk/kioskClientFetch'
import { logPluginBootstrapTiming, noteWidgetTiming, scheduleLoadTimingSummary } from '@/lib/loadTiming'
import { setPluginVolumeLoadPhase } from '@/lib/pluginVolumeLoad'
import { noteWidgetBundleUrl, startRenderTiming } from '@/lib/renderTiming'
import { chunkWidgetIds, widgetBundleVersionKey } from '@/lib/widgetBundleKey'

export type PluginVolumeClientInfo = {
  customRoot: string
  volumeOnly: boolean
  installedIds: string[]
  widgetOverrideIds: string[]
  customWidgetIds: string[]
  /** Plugins mit widget.css (fehlt bei älteren Servern). */
  widgetCssIds?: string[]
  customServerIds: string[]
  /** plugin.json version per id — used as cache key for widget.js / widget.css */
  pluginVersions?: Record<string, string>
  /** Bytes je widget.js — zum Aufteilen des Bundles (fehlt bei älteren Servern). */
  widgetSizes?: Record<string, number>
  missingWidgetJs?: string[]
  hint?: string
}

type BootstrapVolumePluginsOptions = {
  /** Only load widget assets for these plugin IDs (faster first paint). */
  pluginIds?: string[]
  /** Loaded first; volume phase flips to ready before the rest finishes. */
  priorityPluginIds?: string[]
}

/** Loaded even when not on the dashboard (navbar slots, global UI). */
const ALWAYS_BOOTSTRAP_PLUGIN_IDS = ['mail'] as const

let bootstrapRun = 0

export async function fetchPluginVolumeInfo(): Promise<PluginVolumeClientInfo> {
  const res = await kioskAwareFetch('/api/plugins/volume', { cache: 'no-store' })
  if (!res.ok) throw new Error('volume_info_failed')
  return res.json() as Promise<PluginVolumeClientInfo>
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-sd-plugin="${src}"]`)
    if (existing) existing.remove()
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.dataset.sdPlugin = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`script_load_failed:${src}`))
    document.head.appendChild(s)
  })
}

function loadStylesheet(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`link[data-sd-plugin-css="${href}"]`)
    if (existing) {
      resolve()
      return
    }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.sdPluginCss = href
    link.onload = () => resolve()
    link.onerror = () => reject(new Error(`stylesheet_load_failed:${href}`))
    document.head.appendChild(link)
  })
}

/** @param hasCss false = kein widget.css laut Volume-Info (spart den 404-Request); undefined = versuchen. */
async function loadPluginWidgetAssets(pluginId: string, version: string, hasCss?: boolean): Promise<void> {
  const v = encodeURIComponent(version || '0')
  const base = `/api/plugins/custom-assets/${encodeURIComponent(pluginId)}`
  const cssUrl = `${base}/widget.css?v=${v}`
  const jsUrl = `${base}/widget.js?v=${v}`
  const t0 = performance.now()
  await Promise.all([
    hasCss === false
      ? null
      : loadStylesheet(cssUrl).catch(() => {
          /* widget.css is optional for plugins without separate styles */
        }),
    loadScript(jsUrl),
  ])
  noteWidgetTiming(pluginId, performance.now() - t0, jsUrl)
}

type WidgetBundleResults = Record<string, true | string>

declare global {
  interface Window {
    __sdWidgetBundleResults?: WidgetBundleResults
  }
}

function widgetBundleDisabled(): boolean {
  try {
    return window.localStorage.getItem('sd:noBundle') === '1'
  } catch {
    return false
  }
}

/**
 * Lädt widget.js (und widget.css) mehrerer Plugins in je EINEM Request über
 * /api/plugins/widgets-bundle. Was im Bundle fehlt oder scheitert, wird einzeln
 * nachgeladen (gleiches Verhalten/Fehler-Logging wie vorher).
 * Große Mengen werden in mehrere Bundles (~300 KB) aufgeteilt (chunkWidgetIds).
 * Abschalten zum Debuggen: localStorage.setItem('sd:noBundle', '1').
 */
async function loadVolumeWidgetBundle(
  pluginIds: string[],
  versions: Record<string, string>,
  cssIds: Set<string> | null,
  label: string,
  sizes: Record<string, number> = {},
): Promise<void> {
  installPluginExternalBridge()
  if (pluginIds.length === 0) return
  if (widgetBundleDisabled() || pluginIds.length === 1) {
    return loadVolumeWidgetScripts(pluginIds, versions, cssIds)
  }

  const ids = [...pluginIds].sort()
  const cssList = cssIds ? ids.filter((id) => cssIds.has(id)) : ids
  const cssUrl = cssList.length > 0
    ? `/api/plugins/widgets-bundle?type=css&ids=${cssList.map(encodeURIComponent).join(',')}&v=${widgetBundleVersionKey(cssList, versions)}`
    : null

  const results = (window.__sdWidgetBundleResults ??= {})
  for (const id of ids) delete results[id]

  // In mehrere Bundles aufteilen: jedes Skript läuft als eigene Aufgabe, der Browser
  // kann dazwischen zeichnen und reagieren (statt z. B. 1,6 MB am Stück auszuführen).
  const chunks = chunkWidgetIds(ids, sizes)
  const t0 = performance.now()
  const outcomes = await Promise.allSettled([
    cssUrl
      ? loadStylesheet(cssUrl).catch(() => {
          /* CSS optional */
        })
      : Promise.resolve(),
    ...chunks.map(async (chunk, i) => {
      const jsUrl = `/api/plugins/widgets-bundle?type=js&ids=${chunk.map(encodeURIComponent).join(',')}&v=${widgetBundleVersionKey(chunk, versions)}`
      const c0 = performance.now()
      await loadScript(jsUrl)
      noteWidgetTiming(`bundle:${label}${chunks.length > 1 ? `#${i + 1}` : ''}`, performance.now() - c0, jsUrl)
      noteWidgetBundleUrl(jsUrl)
    }),
  ])
  const chunkErrors = outcomes.slice(1).filter((o) => o.status === 'rejected')
  if (chunkErrors.length > 0) {
    console.warn(`[SelfDashboard] ${chunkErrors.length}/${chunks.length} Widget-Bundle(s) fehlgeschlagen — lade einzeln`)
  }
  if (chunks.length > 1) noteWidgetTiming(`bundle:${label}`, performance.now() - t0, '')

  const loaded = ids.filter((id) => results[id] === true)
  const failed = ids.filter((id) => results[id] !== true)
  console.info(
    `[SelfDashboard] Widget-Bundle (${label}): ${loaded.length}/${ids.length} geladen${chunks.length > 1 ? ` in ${chunks.length} Teilen` : ''}`,
  )
  if (failed.length > 0) {
    console.warn(
      '[SelfDashboard] Im Bundle nicht geladen — einzeln nachladen:',
      failed.map((id) => `${id} (${results[id] ?? 'fehlt'})`).join(', '),
    )
    await loadVolumeWidgetScripts(failed, versions, cssIds)
  }
}

/** Remove loaded widget.js / widget.css for one plugin (after uninstall). */
export function unloadPluginWidgetAssets(pluginId: string): void {
  const needle = `/custom-assets/${encodeURIComponent(pluginId)}/`
  for (const el of document.querySelectorAll('script[data-sd-plugin]')) {
    const src = el.getAttribute('data-sd-plugin') ?? ''
    if (src.includes(needle)) el.remove()
  }
  for (const el of document.querySelectorAll('link[data-sd-plugin-css]')) {
    const href = el.getAttribute('data-sd-plugin-css') ?? ''
    if (href.includes(needle)) el.remove()
  }
}

export async function loadVolumeWidgetScripts(
  pluginIds: string[],
  versions: Record<string, string> = {},
  cssIds: Set<string> | null = null,
): Promise<void> {
  installPluginExternalBridge()
  if (pluginIds.length === 0) return

  const results = await Promise.allSettled(
    pluginIds.map(async (id) => {
      await loadPluginWidgetAssets(id, versions[id] ?? '0', cssIds ? cssIds.has(id) : undefined)
      console.info(`[SelfDashboard] Volume widget loaded: ${id}`)
    }),
  )
  const failed = pluginIds.filter((_, i) => results[i].status === 'rejected')
  if (failed.length > 0) {
    for (const id of failed) {
      console.error(`[SelfDashboard] Volume widget failed: ${id}`, (results[pluginIds.indexOf(id)] as PromiseRejectedResult).reason)
    }
    throw new Error(`volume_widgets_failed:${failed.join(',')}`)
  }
}

export async function loadVolumeWidgetScriptsResolved(pluginIds: string[]): Promise<void> {
  if (pluginIds.length === 0) return
  const info = await fetchPluginVolumeInfo()
  await loadVolumeWidgetScripts(pluginIds, info.pluginVersions ?? {})
}

/** Fetch volume info and load custom widget.js (sets global load phase for UI). */
export async function bootstrapVolumePlugins(options?: BootstrapVolumePluginsOptions): Promise<void> {
  setPluginVolumeLoadPhase('loading')
  installPluginExternalBridge()
  scheduleLoadTimingSummary()
  startRenderTiming()
  const run = ++bootstrapRun
  const startedAt = performance.now()
  try {
    const info = await fetchPluginVolumeInfo()
    const volumeMs = performance.now() - startedAt
    const versions = info.pluginVersions ?? {}
    const requested = new Set(
      [...ALWAYS_BOOTSTRAP_PLUGIN_IDS, ...(options?.pluginIds ?? [])]
        .map((id) => String(id).trim())
        .filter(Boolean),
    )
    const customWidgets =
      requested.size > 0
        ? info.customWidgetIds.filter((id) => requested.has(id))
        : info.customWidgetIds
    if (info.missingWidgetJs?.length) {
      console.warn(
        '[SelfDashboard] plugin.json ohne widget.js — nur Metadaten auf dem Volume:',
        info.missingWidgetJs.join(', '),
      )
    }

    const prioritySet = new Set([
      ...ALWAYS_BOOTSTRAP_PLUGIN_IDS,
      ...(options?.priorityPluginIds ?? []).map((id) => String(id).trim()).filter(Boolean),
    ])
    const priority = customWidgets.filter((id) => prioritySet.has(id))
    const deferred = customWidgets.filter((id) => !prioritySet.has(id))
    // Ältere Server ohne widgetCssIds: CSS wie bisher für alle versuchen.
    const cssIds = info.widgetCssIds ? new Set(info.widgetCssIds) : null

    if (priority.length > 0) {
      await loadVolumeWidgetBundle(priority, versions, cssIds, 'priority', info.widgetSizes)
    }
    const priorityReadyAt = performance.now()
    setPluginVolumeLoadPhase('ready')

    const timing = { run, startedAt, volumeMs, priorityIds: priority, priorityReadyAt, deferredIds: deferred }
    if (deferred.length > 0) {
      void loadVolumeWidgetBundle(deferred, versions, cssIds, 'deferred', info.widgetSizes)
        .then(() => logPluginBootstrapTiming({ ...timing, allDoneAt: performance.now() }))
        .catch((e) => {
          console.warn('[SelfDashboard] Deferred plugin volume load failed', e)
          logPluginBootstrapTiming({ ...timing, allDoneAt: performance.now(), failed: true })
        })
    } else {
      logPluginBootstrapTiming({ ...timing, allDoneAt: priorityReadyAt })
    }
  } catch (e) {
    console.warn('[SelfDashboard] Plugin volume load failed', e)
    setPluginVolumeLoadPhase('error')
    throw e
  }
}
