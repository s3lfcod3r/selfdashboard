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
  server: Record<string, Paar>
  spitze: Record<string, number>
}
type Daten = {
  erzeugt: string
  letzte_pruefung?: string
  fehler?: string | null
  heute: Summe
  gestern: Summe
  woche: Summe
  monate: Record<string, Summe>
  tage: Record<string, Summe['gesamt']>
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)

/** 1234 -> 1,2k | 1234567 -> 1,2M */
function kurz(n: number, de: boolean): string {
  const l = de ? 'de-DE' : 'en-US'
  if (n >= 1e6) return `${(n / 1e6).toLocaleString(l, { maximumFractionDigits: 1 })}M`
  if (n >= 1e3) return `${(n / 1e3).toLocaleString(l, { maximumFractionDigits: 1 })}k`
  return Math.round(n).toLocaleString(l)
}

const NAMEN: Record<string, string> = { main: 'Self-Projekte', code: 'Programmierer', dokumente: 'Dokumente' }
const hübsch = (k: string): string => NAMEN[k] ?? k

const MONATE_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
function monatName(m: string, de: boolean): string {
  const [j, mm] = m.split('-')
  const i = Number(mm) - 1
  if (!de) return new Date(`${m}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return `${MONATE_DE[i] ?? m} ${j}`
}

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
  const [offen, setOffen] = useState(false)
  const [monat, setMonat] = useState('')
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
  const tab: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

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

  const monate = Object.keys(daten?.monate ?? {}).sort()
  const gewählt = monat && daten?.monate[monat] ? monat : monate[monate.length - 1] ?? ''
  const s: Summe | undefined = !daten
    ? undefined
    : offen && gewählt
      ? daten.monate[gewählt]
      : zeitraum === 'woche'
        ? daten.woche
        : zeitraum === 'gestern'
          ? daten.gestern
          : daten.heute

  const label = offen
    ? monatName(gewählt, de)
    : zeitraum === 'woche'
      ? (de ? '7 Tage' : '7 days')
      : zeitraum === 'gestern'
        ? (de ? 'gestern' : 'yesterday')
        : de ? 'heute' : 'today'

  const zeilen = (o: Record<string, Paar> | undefined) =>
    Object.entries(o ?? {})
      .filter(([, v]) => v.ein + v.aus > 0)
      .sort((a, b) => b[1].ein + b[1].aus - (a[1].ein + a[1].aus))

  const spitze = Math.max(0, ...Object.values(s?.spitze ?? {}))
  const tageDesMonats = Object.entries(daten?.tage ?? {})
    .filter(([t]) => t.startsWith(gewählt))
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))

  return (
    <div ref={ref} style={wrap}>
      <button
        type="button"
        onClick={() => setOffen((v) => !v)}
        title={de ? 'Statistik ein- und ausklappen' : 'Toggle statistics'}
        style={{ display: 'flex', alignItems: 'baseline', gap: 8, background: 'none', border: 'none', color: 'inherit', font: 'inherit', padding: 0, cursor: 'pointer', textAlign: 'left' }}
      >
        {title && <strong style={{ flex: 1 }}>{title}</strong>}
        <span style={{ opacity: 0.6, fontSize: 11 }}>{label}</span>
        <span style={{ opacity: 0.5, fontSize: 11 }}>{offen ? '▲' : '▼'}</span>
      </button>

      {error && <span style={{ color: '#ef4444' }}>{de ? 'Nicht erreichbar' : 'Unreachable'}: {error}</span>}
      {daten?.fehler && <span style={{ color: '#f59e0b', fontSize: 12 }}>{daten.fehler}</span>}

      {s && (
        <>
          <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, ...tab }}>{kurz(s.gesamt.ein, de)}</div>
              <div style={{ opacity: 0.65, fontSize: 11 }}>{de ? 'rein' : 'in'}</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, ...tab }}>{kurz(s.gesamt.aus, de)}</div>
              <div style={{ opacity: 0.65, fontSize: 11 }}>{de ? 'raus' : 'out'}</div>
            </div>
            {spitze > 0 && (
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, ...tab }}>{kurz(spitze, de)}</div>
                <div style={{ opacity: 0.65, fontSize: 11 }}>{de ? 'max. am Stück' : 'peak context'}</div>
              </div>
            )}
          </div>

          {zeilen(s.agenten).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 6, ...tab }}>
              <span style={{ flex: 1, opacity: 0.85 }}>{hübsch(k)}</span>
              <span style={{ opacity: 0.7 }}>{kurz(v.ein, de)} / {kurz(v.aus, de)}</span>
            </div>
          ))}

          {zeilen(s.server).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 6, fontSize: 12, ...tab }}>
              <span style={{ flex: 1, opacity: 0.7 }}>{k}</span>
              <span style={{ opacity: 0.6 }}>{kurz(v.ein, de)} / {kurz(v.aus, de)}</span>
            </div>
          ))}
        </>
      )}

      {offen && daten && (
        <div style={{ borderTop: '1px solid rgba(128,128,128,.3)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {monate.length > 1 && (
            <select
              value={gewählt}
              onChange={(e) => setMonat(e.target.value)}
              style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', fontSize: 12 }}
            >
              {monate
                .slice()
                .reverse()
                .map((m) => (
                  <option key={m} value={m}>
                    {monatName(m, de)}
                  </option>
                ))}
            </select>
          )}
          {tageDesMonats.length === 0 && <span style={{ opacity: 0.6, fontSize: 12 }}>{de ? 'Keine Tage erfasst.' : 'No days recorded.'}</span>}
          {tageDesMonats.map(([t, g]) => (
            <div key={t} style={{ display: 'flex', gap: 6, fontSize: 12, ...tab }}>
              <span style={{ flex: 1, opacity: 0.7 }}>{de ? t.slice(8) + '.' + t.slice(5, 7) + '.' : t.slice(5)}</span>
              <span style={{ opacity: 0.65 }}>{kurz(g.ein, de)} / {kurz(g.aus, de)}</span>
            </div>
          ))}
        </div>
      )}

      {daten && !error && (
        <span style={{ marginTop: 'auto', opacity: 0.45, fontSize: 11 }}>{de ? 'rein / raus je Zeile' : 'in / out per row'}</span>
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
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{de ? 'Adresse des Token-Sammlers' : 'Token collector URL'}</label>
        <input
          style={inp}
          value={str(config.tokenUrl)}
          placeholder="http://192.168.1.x:8098/tokens"
          onChange={(e) => onChange('tokenUrl', e.target.value)}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{de ? 'Zeitraum (zugeklappt)' : 'Period (collapsed)'}</label>
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
    'Zeigt, wie viele Token dein KI-Agent verbraucht: rein, raus und der groesste Kontext am Stueck. Ein Klick auf den Titel klappt die Statistik auf - Monatsauswahl und Tagesliste. Liest einen kleinen Sammel-Dienst, der die Zaehler ueber Neustarts hinweg fortschreibt.',
  author: 'SelfDashboard',
  category: 'system',
  icon: '🔢',
  version: '1.1.0',
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
