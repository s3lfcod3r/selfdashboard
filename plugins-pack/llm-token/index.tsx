'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

// ---------------------------------------------------------------------------
// Model - so liefert es der Token-Sammler (GET /tokens)
// ---------------------------------------------------------------------------

type Paar = { ein: number; aus: number }
type Summe = {
  gesamt: { ein: number; aus: number; cache_gelesen: number; cache_geschrieben: number }
  agenten: Record<string, Paar>
  modelle: Record<string, Paar>
}
type Daten = { erzeugt: string; letzte_pruefung?: string; fehler?: string | null; heute: Summe; gestern: Summe; woche: Summe }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)

/** 1234 -> 1,2k | 1234567 -> 1,2M */
function kurz(n: number, de: boolean): string {
  const l = de ? 'de-DE' : 'en-US'
  if (n >= 1e6) return `${(n / 1e6).toLocaleString(l, { maximumFractionDigits: 1 })}M`
  if (n >= 1e3) return `${(n / 1e3).toLocaleString(l, { maximumFractionDigits: 1 })}k`
  return Math.round(n).toLocaleString(l)
}

const NAMEN: Record<string, string> = {
  main: 'Self-Projekte',
  code: 'Programmierer',
  dokumente: 'Dokumente',
  'lan-bonsai-2000e': 'Board',
  'lan-bonsai-4090': '4090',
}
const hübsch = (k: string): string => NAMEN[k] ?? k

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function Widget({ config }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const tokenUrl = str(config.tokenUrl)
  const title = config.title === undefined ? (de ? 'Token-Zähler' : 'Token counter') : str(config.title)
  const zeitraum = str(config.zeitraum) || 'heute'
  const refreshMs = Math.max(15, num(config.refreshSeconds) || 60) * 1000

  const [daten, setDaten] = useState<Daten | null>(null)
  const [error, setError] = useState('')
  const { ref, active } = usePollingActive()

  const load = useCallback(async () => {
    if (!tokenUrl) return
    try {
      const res = await fetch('/api/plugins/llm-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: tokenUrl }),
      })
      const body = (await res.json()) as Daten & { error?: string }
      if (!res.ok || body.error) {
        setError(body.error || `HTTP ${res.status}`)
        return
      }
      setDaten(body)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [tokenUrl])

  useEffect(() => {
    if (!active) return
    void load()
    const t = setInterval(() => void load(), refreshMs)
    return () => clearInterval(t)
  }, [load, refreshMs, active])

  const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'auto', fontSize: 13 }
  const num1: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

  if (!tokenUrl) {
    return (
      <div style={wrap}>
        {title && <strong>{title}</strong>}
        <span style={{ opacity: 0.7 }}>
          {de ? 'Adresse des Token-Sammlers in den Einstellungen eintragen.' : 'Set the collector URL in the settings.'}
        </span>
      </div>
    )
  }

  const s: Summe | undefined = daten ? (zeitraum === 'woche' ? daten.woche : zeitraum === 'gestern' ? daten.gestern : daten.heute) : undefined
  const label = zeitraum === 'woche' ? (de ? '7 Tage' : '7 days') : zeitraum === 'gestern' ? (de ? 'gestern' : 'yesterday') : de ? 'heute' : 'today'
  const zeilen = (o: Record<string, Paar> | undefined) =>
    Object.entries(o ?? {})
      .filter(([, v]) => v.ein + v.aus > 0)
      .sort((a, b) => b[1].ein + b[1].aus - (a[1].ein + a[1].aus))

  return (
    <div ref={ref} style={wrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        {title && <strong style={{ flex: 1 }}>{title}</strong>}
        <span style={{ opacity: 0.6, fontSize: 11 }}>{label}</span>
      </div>

      {error && <span style={{ color: '#ef4444' }}>{de ? 'Nicht erreichbar' : 'Unreachable'}: {error}</span>}
      {daten?.fehler && <span style={{ color: '#f59e0b', fontSize: 12 }}>{daten.fehler}</span>}

      {s && (
        <>
          <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, ...num1 }}>{kurz(s.gesamt.ein, de)}</div>
              <div style={{ opacity: 0.65, fontSize: 11 }}>{de ? 'rein' : 'in'}</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, ...num1 }}>{kurz(s.gesamt.aus, de)}</div>
              <div style={{ opacity: 0.65, fontSize: 11 }}>{de ? 'raus' : 'out'}</div>
            </div>
            {s.gesamt.cache_gelesen > 0 && (
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, ...num1 }}>{kurz(s.gesamt.cache_gelesen, de)}</div>
                <div style={{ opacity: 0.65, fontSize: 11 }}>{de ? 'Cache' : 'cache'}</div>
              </div>
            )}
          </div>

          {zeilen(s.agenten).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 6, ...num1 }}>
              <span style={{ flex: 1, opacity: 0.85 }}>{hübsch(k)}</span>
              <span style={{ opacity: 0.7 }}>{kurz(v.ein, de)} / {kurz(v.aus, de)}</span>
            </div>
          ))}

          {zeilen(s.modelle).length > 0 && (
            <div style={{ borderTop: '1px solid rgba(128,128,128,.3)', paddingTop: 6 }}>
              {zeilen(s.modelle).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 6, fontSize: 12, ...num1 }}>
                  <span style={{ flex: 1, opacity: 0.7 }}>{hübsch(k)}</span>
                  <span style={{ opacity: 0.6 }}>{kurz(v.ein + v.aus, de)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {daten && !error && (
        <span style={{ marginTop: 'auto', opacity: 0.45, fontSize: 11 }}>
          {de ? 'rein / raus je Zeile' : 'in / out per row'}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const inp: CSSProperties = { width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit' }

function Settings({ config, onChange }: PluginSettingsProps) {
  const { de } = usePluginLocale()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {de ? 'Widget-Titel (leer = ausblenden)' : 'Widget title (empty = hidden)'}
        </label>
        <input
          style={inp}
          value={config.title === undefined ? (de ? 'Token-Zähler' : 'Token counter') : str(config.title)}
          onChange={(e) => onChange('title', e.target.value)}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {de ? 'Adresse des Token-Sammlers' : 'Token collector URL'}
        </label>
        <input
          style={inp}
          value={str(config.tokenUrl)}
          placeholder="http://192.168.1.x:8098/tokens"
          onChange={(e) => onChange('tokenUrl', e.target.value)}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{de ? 'Zeitraum' : 'Period'}</label>
        <select style={inp} value={str(config.zeitraum) || 'heute'} onChange={(e) => onChange('zeitraum', e.target.value)}>
          <option value="heute">{de ? 'heute' : 'today'}</option>
          <option value="gestern">{de ? 'gestern' : 'yesterday'}</option>
          <option value="woche">{de ? '7 Tage' : '7 days'}</option>
        </select>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {de ? 'Aktualisieren alle … Sekunden' : 'Refresh every … seconds'}
        </label>
        <input
          style={inp}
          type="number"
          min={15}
          value={num(config.refreshSeconds) || 60}
          onChange={(e) => onChange('refreshSeconds', Number(e.target.value))}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meta + exports
// ---------------------------------------------------------------------------

export const meta: PluginMeta = {
  id: 'llm-token',
  name: 'Token-Zaehler',
  description:
    'Zeigt, wie viele Token dein KI-Agent verbraucht: Eingang und Ausgang, heute und diese Woche, je Agent und je Modell. Liest die Zaehler eines kleinen Sammel-Dienstes, der sie ueber Neustarts hinweg fortschreibt.',
  author: 'SelfDashboard',
  category: 'system',
  icon: '🔢',
  version: '1.0.0',
  defaultLayout: { w: 4, h: 4, minW: 2, minH: 2 },
  configSchema: [
    { key: 'title', label: 'Widget-Titel', type: 'text', defaultValue: 'Token-Zähler' },
    { key: 'tokenUrl', label: 'Sammler-URL', type: 'text', defaultValue: '' },
    { key: 'zeitraum', label: 'Zeitraum', type: 'text', defaultValue: 'heute' },
    { key: 'refreshSeconds', label: 'Aktualisierung (s)', type: 'number', defaultValue: 60 },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
