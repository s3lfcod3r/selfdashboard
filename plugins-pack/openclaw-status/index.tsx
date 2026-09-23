'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

// ---------------------------------------------------------------------------
// Model - so liefert es der Projektstatus-Dienst (GET /status)
// ---------------------------------------------------------------------------

type Aufgabe = { name: string; zustand: string; text: string }
type Projekt = { name: string; geaendert: string; aufgaben: Aufgabe[]; fragen: string[] }
type Updates = { geprueft?: string; meldungen?: string[]; fehler?: string[] } | null
type Status = { erzeugt: string; projekte: Projekt[]; updates: Updates }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)

function art(zustand: string): 'wartet' | 'arbeit' | 'fertig' {
  const z = zustand.toLowerCase()
  if (z.includes('wartet') || z.includes('waiting')) return 'wartet'
  if (z.includes('fertig') || z.includes('done')) return 'fertig'
  return 'arbeit'
}

const FARBE = { wartet: '#f59e0b', arbeit: '#3b82f6', fertig: '#22c55e' } as const
const ZEICHEN = { wartet: '⚠', arbeit: '●', fertig: '✓' } as const

function vor(iso: string, de: boolean): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return de ? `vor ${Math.round(s / 60)} min` : `${Math.round(s / 60)} min ago`
  if (s < 86400) return de ? `vor ${Math.round(s / 3600)} h` : `${Math.round(s / 3600)} h ago`
  return de ? `vor ${Math.round(s / 86400)} Tagen` : `${Math.round(s / 86400)} days ago`
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function Widget({ config }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const statusUrl = str(config.statusUrl)
  const title = config.title === undefined ? (de ? 'Projektstatus' : 'Project status') : str(config.title)
  const showDone = config.showDone === true
  const refreshMs = Math.max(15, num(config.refreshSeconds) || 60) * 1000

  const [data, setData] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const { ref, active } = usePollingActive()

  const load = useCallback(async () => {
    if (!statusUrl) return
    try {
      const res = await fetch('/api/plugins/openclaw-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusUrl }),
      })
      const body = (await res.json()) as Status & { error?: string }
      if (!res.ok || body.error) {
        setError(body.error || `HTTP ${res.status}`)
        return
      }
      setData(body)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [statusUrl])

  useEffect(() => {
    if (!active) return
    void load()
    const t = setInterval(() => void load(), refreshMs)
    return () => clearInterval(t)
  }, [load, refreshMs, active])

  const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'auto', fontSize: 13 }

  if (!statusUrl) {
    return (
      <div style={wrap}>
        {title && <strong>{title}</strong>}
        <span style={{ opacity: 0.7 }}>
          {de ? 'Status-URL in den Einstellungen eintragen.' : 'Set the status URL in the settings.'}
        </span>
      </div>
    )
  }

  const projekte = data?.projekte ?? []
  const offen = projekte.reduce((n, p) => n + p.fragen.length, 0)
  const meldungen = data?.updates?.meldungen ?? []

  return (
    <div ref={ref} style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {title && <strong style={{ flex: 1 }}>{title}</strong>}
        {offen > 0 && (
          <span style={{ background: FARBE.wartet, color: '#111', borderRadius: 10, padding: '1px 8px', fontWeight: 600 }}>
            {offen} {de ? (offen === 1 ? 'Frage' : 'Fragen') : offen === 1 ? 'question' : 'questions'}
          </span>
        )}
      </div>

      {error && <span style={{ color: '#ef4444' }}>{de ? 'Nicht erreichbar' : 'Unreachable'}: {error}</span>}

      {data && projekte.length === 0 && (
        <span style={{ opacity: 0.7 }}>
          {de
            ? 'Noch kein Projekt mit STATUS.md - der Agent legt sie bei der ersten Aufgabe an.'
            : 'No project with STATUS.md yet.'}
        </span>
      )}

      {projekte.map((p) => {
        const aufgaben = p.aufgaben.filter((a) => showDone || art(a.zustand) !== 'fertig')
        return (
          <div key={p.name} style={{ borderLeft: `3px solid ${p.fragen.length ? FARBE.wartet : FARBE.arbeit}`, paddingLeft: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <strong style={{ flex: 1 }}>{p.name}</strong>
              <span style={{ opacity: 0.55, fontSize: 11 }}>{vor(p.geaendert, de)}</span>
            </div>
            {p.fragen.map((f) => (
              <div key={f} style={{ color: FARBE.wartet }}>
                {ZEICHEN.wartet} {f}
              </div>
            ))}
            {aufgaben.map((a) => {
              const k = art(a.zustand)
              return (
                <div key={a.name} style={{ opacity: k === 'fertig' ? 0.6 : 1 }}>
                  <span style={{ color: FARBE[k] }}>{ZEICHEN[k]}</span> {a.name}
                  {a.text && <span style={{ opacity: 0.7 }}> - {a.text}</span>}
                </div>
              )
            })}
          </div>
        )
      })}

      {meldungen.length > 0 && (
        <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(128,128,128,.3)', paddingTop: 6 }}>
          {meldungen.map((m) => (
            <div key={m} style={{ fontSize: 12, opacity: 0.85 }}>
              🔔 {m}
            </div>
          ))}
        </div>
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
          value={config.title === undefined ? (de ? 'Projektstatus' : 'Project status') : str(config.title)}
          onChange={(e) => onChange('title', e.target.value)}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {de ? 'Status-URL des Projektstatus-Dienstes' : 'Project status service URL'}
        </label>
        <input
          style={inp}
          value={str(config.statusUrl)}
          placeholder="http://192.168.1.x:8097/status"
          onChange={(e) => onChange('statusUrl', e.target.value)}
        />
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
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" checked={config.showDone === true} onChange={(e) => onChange('showDone', e.target.checked)} />
        {de ? 'Fertige Aufgaben anzeigen' : 'Show finished tasks'}
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meta + exports
// ---------------------------------------------------------------------------

export const meta: PluginMeta = {
  id: 'openclaw-status',
  name: 'Projektstatus',
  description:
    'Zeigt, wo jedes Projekt steht und wo Fragen an dich warten - gelesen aus den STATUS.md-Dateien, die ein KI-Agent (z.B. OpenClaw) pflegt. Wartendes zuerst, dazu Update-Hinweise. Braucht den kleinen Projektstatus-Dienst.',
  author: 'SelfDashboard',
  category: 'utility',
  icon: '📋',
  version: '1.0.0',
  defaultLayout: { w: 4, h: 5, minW: 3, minH: 3 },
  configSchema: [
    { key: 'title', label: 'Widget-Titel', type: 'text', defaultValue: 'Projektstatus' },
    { key: 'statusUrl', label: 'Status-URL', type: 'text', defaultValue: '' },
    { key: 'refreshSeconds', label: 'Aktualisierung (s)', type: 'number', defaultValue: 60 },
    { key: 'showDone', label: 'Fertige anzeigen', type: 'boolean', defaultValue: false },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
