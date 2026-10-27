'use client'

import { memo, Profiler, useEffect, useLayoutEffect, useRef, type ComponentType, type ProfilerOnRenderCallback } from 'react'
import type { PluginMeta, PluginComponent, PluginWidgetProps } from '@/types'
import { WidgetErrorBoundary } from '@/components/plugins/WidgetErrorBoundary'
import { noteWidgetEffects, noteWidgetRender } from '@/lib/renderTiming'

// ── Plugin Registry ──────────────────────────────────────────
// Each plugin registers itself here with metadata + component.
// External plugin developers import { registerPlugin } and call it.

interface RegisteredPlugin {
  meta: PluginMeta
  component: PluginComponent
}

const onWidgetRender: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
  noteWidgetRender(id, phase, actualDuration)
}

type EffectMarks = { layout?: number; passive?: number }

/**
 * Steht VOR dem Widget: React führt Effekte in Baum-Reihenfolge aus (Marker → Widget →
 * SafeWidget), die Differenz bis zu den Effekten in SafeWidget = Effekte des Widgets.
 */
function EffectMarker({ marks }: { marks: { current: EffectMarks } }) {
  useLayoutEffect(() => {
    marks.current.layout = performance.now()
  })
  useEffect(() => {
    marks.current.passive = performance.now()
  })
  return null
}

function wrapWidgetWithLogging(meta: PluginMeta, Widget: ComponentType<PluginWidgetProps>) {
  function SafeWidget(props: PluginWidgetProps) {
    const marks = useRef<EffectMarks>({})
    useLayoutEffect(() => {
      if (marks.current.layout !== undefined) noteWidgetEffects(meta.id, 'layout', performance.now() - marks.current.layout)
      marks.current.layout = undefined
    })
    useEffect(() => {
      if (marks.current.passive !== undefined) noteWidgetEffects(meta.id, 'passive', performance.now() - marks.current.passive)
      marks.current.passive = undefined
    })
    return (
      <Profiler id={meta.id} onRender={onWidgetRender}>
        <WidgetErrorBoundary pluginId={meta.id} instanceId={props.instanceId}>
          <EffectMarker marks={marks} />
          <Widget {...props} />
        </WidgetErrorBoundary>
      </Profiler>
    )
  }
  SafeWidget.displayName = `Widget(${meta.id})`
  // memo: Das Raster rendert bei jeder Registry-Änderung (z. B. pro Bundle-Teil) neu —
  // ohne memo liefen dabei ALLE Widgets mit, obwohl sich ihre Props nicht ändern.
  // Eigene Zustände/Store-Abos der Widgets lösen weiterhin normal Renders aus.
  const MemoWidget = memo(SafeWidget)
  MemoWidget.displayName = `Widget(${meta.id})`
  return MemoWidget
}

let registryVersion = 0
const registryListeners = new Set<() => void>()
let notifyQueued = false

/**
 * Gebündelt per Microtask: useSyncExternalStore rendert bei jeder Benachrichtigung
 * SYNCHRON neu — ein Widget-Bundle mit 19 registerPlugin-Aufrufen löste sonst 19
 * komplette Dashboard-Renders hintereinander aus. Die Registry selbst ist sofort
 * aktuell; nur die Listener laufen einmal nach dem aktuellen Skript.
 */
function notifyPluginRegistry() {
  registryVersion += 1
  if (notifyQueued) return
  notifyQueued = true
  queueMicrotask(() => {
    notifyQueued = false
    for (const fn of registryListeners) fn()
  })
}

export function subscribePluginRegistry(onStoreChange: () => void): () => void {
  registryListeners.add(onStoreChange)
  return () => registryListeners.delete(onStoreChange)
}

export function getPluginRegistryVersion(): number {
  return registryVersion
}

class PluginRegistry {
  private plugins: Map<string, RegisteredPlugin> = new Map()

  register(meta: PluginMeta, component: PluginComponent, opts?: { replace?: boolean }) {
    if (this.plugins.has(meta.id) && !opts?.replace) {
      console.warn(`[SelfDashboard] Plugin "${meta.id}" is already registered. Skipping.`)
      return
    }
    const wrapped: PluginComponent = {
      ...component,
      Widget: wrapWidgetWithLogging(meta, component.Widget),
    }
    this.plugins.set(meta.id, { meta, component: wrapped })
    console.info(
      `[SelfDashboard] Plugin registered: ${meta.name} v${meta.version} (id=${meta.id}, errors → Protokoll)`,
    )
    notifyPluginRegistry()
  }

  get(id: string): RegisteredPlugin | undefined {
    return this.plugins.get(id)
  }

  getAll(): RegisteredPlugin[] {
    return Array.from(this.plugins.values())
  }

  getByCategory(category: string): RegisteredPlugin[] {
    return this.getAll().filter((p) => p.meta.category === category)
  }

  isRegistered(id: string): boolean {
    return this.plugins.has(id)
  }

  unregister(id: string): void {
    if (this.plugins.delete(id)) notifyPluginRegistry()
  }
}

// Singleton – one registry for the whole app
export const pluginRegistry = new PluginRegistry()

/** Register a plugin — Widget is wrapped for automatic error logging (see docs/LOGGING.md). */
export const registerPlugin = (
  meta: PluginMeta,
  component: PluginComponent,
  opts?: { replace?: boolean },
) => {
  pluginRegistry.register(meta, component, opts)
}
