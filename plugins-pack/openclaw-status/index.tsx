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
  if (z.includes('fertig') || z.includes('done') || z.includes('✅')) return 'fertig'
  return 'arbeit'
}

const FARBE = { wartet: '#f59e0b', arbeit: '#60a5fa', fertig: '#34d399' } as const

function vor(iso: string, de: boolean): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return de ? `vor ${Math.round(s / 60)} min` : `${Math.round(s / 60)} min ago`
  if (s < 86400) return de ? `vor ${Math.round(s / 3600)} h` : `${Math.round(s / 3600)} h ago`
  const t = Math.round(s / 86400)
  return de ? `vor ${t} ${t === 1 ? 'Tag' : 'Tagen'}` : `${t} d ago`
}

/** Markdown-Reste aus STATUS.md entfernen: **fett**, `code`, fuehrende Haken. */
const sauber = (t: string): string =>
  t.replace(/\*\*/g, '').replace(/`/g, '').replace(/^[\s✅☑✔️⚠️-]+/u, '').replace(/\s+/g, ' ').trim()

/** Platzhalter, die der Agent statt "keine Fragen" in die Liste schreibt. */
const LEER = new Set(['keine', 'keine fragen', 'none', 'offen', 'nichts', '-', '–', '—', 'n/a'])

/** Echte Fragen: ohne Platzhalter und ohne Zeilen, die nur den Grund einer Aufgabe wiederholen. */
function echteFragen(p: Projekt): string[] {
  const gruende = new Set(p.aufgaben.map((a) => sauber(a.text).toLowerCase()))
  return p.fragen
    .map(sauber)
    .filter((f) => f && !LEER.has(f.toLowerCase()) && !gruende.has(f.toLowerCase()))
}

/** "Code · viergewinnt" -> Praefix + Name, damit der Name vorne steht. */
function teileName(n: string): { vor: string; name: string } {
  const i = n.indexOf(' · ')
  return i > 0 ? { vor: n.slice(0, i), name: n.slice(i + 3) } : { vor: '', name: n }
}

const zweiZeilen: CSSProperties = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
const eineZeile: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

function ProjektKarte({ p, showDone, de }: { p: Projekt; showDone: boolean; de: boolean }) {
  const [auf, setAuf] = useState(false)
  const fragen = echteFragen(p)
  const alle = p.aufgaben.map((a) => ({ ...a, k: art(a.zustand), name: sauber(a.name), text: sauber(a.text) }))
  const offen = alle.filter((a) => a.k !== 'fertig')
  const fertig = alle.length - offen.length
  const sichtbar = showDone ? alle : offen
  const farbe = fragen.length ? FARBE.wartet : offen.length ? FARBE.arbeit : FARBE.fertig
  const { vor: praefix, name } = teileName(p.name)
  const ruhig = fragen.length === 0 && sichtbar.length === 0

  return (
    <button
      type="button"
      onClick={() => setAuf((v) => !v)}
      title={de ? 'Klicken für den ganzen Text' : 'Click for full text'}
      style={{
        display: 'flex', flexDirection: 'column', gap: 5, textAlign: 'left', width: '100%',
        background: 'rgba(128,128,128,.08)', border: 'none', borderRadius: 8, padding: '7px 9px',
        color: 'inherit', font: 'inherit', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%' }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: farbe, flexShrink: 0 }} />
        <strong style={{ flex: 1, minWidth: 0, ...eineZeile }}>
          {name}
          {praefix && <span style={{ fontWeight: 400, opacity: 0.45, fontSize: 11 }}> · {praefix}</span>}
        </strong>
        <span style={{ opacity: 0.5, fontSize: 11, flexShrink: 0 }}>{vor(p.geaendert, de)}</span>
      </div>

      {fragen.map((f) => (
        <div key={f} style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.35 }}>
          <span style={{ color: FARBE.wartet, fontWeight: 700, flexShrink: 0 }}>?</span>
          <span style={auf ? undefined : zweiZeilen}>{f}</span>
        </div>
      ))}

      {sichtbar.map((a) => (
        <div key={a.name} style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.35, opacity: a.k === 'fertig' ? 0.55 : 0.9 }}>
          <span style={{ color: FARBE[a.k], flexShrink: 0 }}>{a.k === 'fertig' ? '✓' : a.k === 'wartet' ? '◷' : '●'}</span>
          <span style={auf ? undefined : eineZeile}>
            {a.name}
            {a.text && <span style={{ opacity: 0.6 }}> – {a.text}</span>}
          </span>
        </div>
      ))}

      {(ruhig || (!showDone && fertig > 0)) && (
        <span style={{ fontSize: 11, opacity: 0.5 }}>
          {ruhig && (de ? 'nichts offen' : 'nothing open')}
          {ruhig && fertig > 0 && ' · '}
          {fertig > 0 && `${fertig} ${de ? 'erledigt' : 'done'}`}
        </span>
      )}
    </button>
  )
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

  const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, height: '100%', overflow: 'auto', fontSize: 13 }

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

  const projekte = [...(data?.projekte ?? [])].sort((a, b) => {
    const fa = echteFragen(a).length > 0 ? 1 : 0
    const fb = echteFragen(b).length > 0 ? 1 : 0
    return fb - fa || (a.geaendert < b.geaendert ? 1 : -1)
  })
  const offen = projekte.reduce((n, p) => n + echteFragen(p).length, 0)
  const meldungen = data?.updates?.meldungen ?? []

  return (
    <div ref={ref} style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {title && <strong style={{ flex: 1 }}>{title}</strong>}
        {offen > 0 && (
          <span style={{ background: FARBE.wartet, color: '#111', borderRadius: 10, padding: '1px 8px', fontWeight: 600, fontSize: 12 }}>
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

      {projekte.map((p) => (
        <ProjektKarte key={p.name} p={p} showDone={showDone} de={de} />
      ))}

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
  version: '1.1.0',
  defaultLayout: { w: 4, h: 5, minW: 2, minH: 2 },
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
