'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Metrics = Record<string, number>
type ServerState = { name: string; state: 'ok' | 'off' | 'no_metrics' | 'error'; metrics?: Metrics }
type Zeile = {
  name: string
  state: ServerState['state']
  busy: boolean
  schreibt: number | null // t/s, zuletzt gemessen
  schnitt: number | null // t/s, Schnitt seit Serverstart
  liest: number | null
  mtp: number | null // Anteil angenommener Vorschlaege, 0..1
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)

/** "Name=URL" je Zeile; ohne Namen wird die Adresse als Name benutzt. */
function parseServers(text: string): { name: string; url: string }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      if (i > 0 && !l.slice(0, i).includes('://')) return { name: l.slice(0, i).trim(), url: l.slice(i + 1).trim() }
      return { name: l, url: l }
    })
}

const rate = (tokens?: number, seconds?: number): number | null =>
  tokens !== undefined && seconds !== undefined && seconds > 0 && tokens > 0 ? tokens / seconds : null

const zahlen: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function Widget({ config }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const serversText = str(config.servers)
  const title = config.title === undefined ? (de ? 'LLM-Tempo' : 'LLM speed') : str(config.title)
  const refreshMs = Math.max(3, num(config.refreshSeconds) || 5) * 1000

  const [zeilen, setZeilen] = useState<Zeile[]>([])
  const [error, setError] = useState('')
  const vorher = useRef<Record<string, Metrics>>({})
  const zuletzt = useRef<Record<string, number>>({})
  const { ref, active } = usePollingActive()

  const load = useCallback(async () => {
    const servers = parseServers(serversText)
    if (servers.length === 0) return
    try {
      const res = await fetch('/api/plugins/llm-tempo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers }),
      })
      const body = (await res.json()) as { servers?: ServerState[]; error?: string }
      if (!res.ok || !body.servers) {
        setError(body.error || `HTTP ${res.status}`)
        return
      }
      setError('')
      setZeilen(
        body.servers.map((s) => {
          const m = s.metrics
          if (s.state !== 'ok' || !m) {
            delete vorher.current[s.name]
            delete zuletzt.current[s.name]
            return { name: s.name, state: s.state, busy: false, schreibt: null, schnitt: null, liest: null, mtp: null }
          }
          const alt = vorher.current[s.name]
          if (alt && m.tokens_predicted_total >= alt.tokens_predicted_total) {
            const neu = rate(
              m.tokens_predicted_total - alt.tokens_predicted_total,
              m.tokens_predicted_seconds_total - alt.tokens_predicted_seconds_total,
            )
            if (neu !== null) zuletzt.current[s.name] = neu
          }
          vorher.current[s.name] = m
          const draft = m.spec_decode_num_draft_tokens_total
          return {
            name: s.name,
            state: 'ok',
            busy: (m.requests_processing ?? 0) > 0,
            schreibt: zuletzt.current[s.name] ?? null,
            schnitt: rate(m.tokens_predicted_total, m.tokens_predicted_seconds_total),
            liest: rate(m.prompt_tokens_total, m.prompt_seconds_total),
            mtp: draft ? (m.spec_decode_num_accepted_tokens_total ?? 0) / draft : null,
          }
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [serversText])

  useEffect(() => {
    if (!active) return
    void load()
    const t = setInterval(() => void load(), refreshMs)
    return () => clearInterval(t)
  }, [load, refreshMs, active])

  const fmt = (n: number | null, d = 1) =>
    n === null ? '–' : n.toLocaleString(de ? 'de-DE' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

  const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, height: '100%', overflow: 'auto', fontSize: 13 }

  if (!serversText.trim()) {
    return (
      <div style={wrap}>
        {title && <strong>{title}</strong>}
        <span style={{ opacity: 0.7 }}>
          {de ? 'Server in den Einstellungen eintragen (Name=URL je Zeile).' : 'Add servers in the settings (Name=URL per line).'}
        </span>
      </div>
    )
  }

  return (
    <div ref={ref} style={wrap}>
      {title && <strong>{title}</strong>}
      {error && <span style={{ color: '#ef4444' }}>{error}</span>}
      {zeilen.map((z) => {
        const an = z.state === 'ok'
        const farbe = !an ? '#6b7280' : z.busy ? '#34d399' : '#60a5fa'
        const zustand =
          z.state === 'off'
            ? de ? 'aus' : 'off'
            : z.state === 'no_metrics'
              ? de ? 'ohne --metrics' : 'no --metrics'
              : z.state === 'error'
                ? de ? 'Fehler' : 'error'
                : z.busy
                  ? de ? 'arbeitet' : 'busy'
                  : de ? 'bereit' : 'idle'
        const haupt = z.schreibt ?? z.schnitt
        const neben = [
          z.liest !== null ? `${de ? 'lesen' : 'in'} ${fmt(z.liest, 0)}` : '',
          z.schreibt !== null && z.schnitt !== null ? `Ø ${fmt(z.schnitt)}` : '',
          z.mtp !== null ? `MTP ${fmt(z.mtp * 100, 0)} %` : '',
        ].filter(Boolean)
        return (
          <div key={z.name} style={{ opacity: an ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span
                style={{
                  width: 7, height: 7, borderRadius: 4, background: farbe, flexShrink: 0, alignSelf: 'center',
                  boxShadow: z.busy ? `0 0 0 3px ${farbe}33` : 'none',
                }}
              />
              <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.name}</strong>
              {an && haupt !== null ? (
                <span style={{ whiteSpace: 'nowrap', ...zahlen }} title={zustand}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: z.busy ? farbe : undefined }}>{fmt(haupt)}</span>
                  <span style={{ fontSize: 11, opacity: 0.6 }}> t/s</span>
                </span>
              ) : (
                <span style={{ color: z.state === 'error' ? '#ef4444' : farbe, fontSize: 11 }}>
                  {an ? (de ? 'noch keine Antwort' : 'no reply yet') : zustand}
                </span>
              )}
            </div>
            {an && haupt !== null && neben.length > 0 && (
              <div style={{ paddingLeft: 14, fontSize: 11, opacity: 0.6, ...zahlen }}>
                {neben.join(' · ')}
                {z.schreibt === null && (de ? ' · Schnitt' : ' · avg')}
              </div>
            )}
          </div>
        )
      })}
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
          value={config.title === undefined ? (de ? 'LLM-Tempo' : 'LLM speed') : str(config.title)}
          onChange={(e) => onChange('title', e.target.value)}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {de ? 'llama.cpp-Server, je Zeile Name=URL' : 'llama.cpp servers, one Name=URL per line'}
        </label>
        <textarea
          style={{ ...inp, minHeight: 80, fontFamily: 'monospace' }}
          value={str(config.servers)}
          placeholder={'GPU-Server=http://192.168.1.x:8080'}
          onChange={(e) => onChange('servers', e.target.value)}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {de ? 'Aktualisieren alle … Sekunden' : 'Refresh every … seconds'}
        </label>
        <input
          style={inp}
          type="number"
          min={3}
          value={num(config.refreshSeconds) || 5}
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
  id: 'llm-tempo',
  name: 'LLM-Tempo',
  description:
    'Zeigt, wie schnell deine lokalen Sprachmodelle schreiben und lesen (Token pro Sekunde) - gemessen vom llama.cpp-Server selbst, dazu die Trefferquote der MTP-/Spekulativ-Vorhersage. Braucht llama-server mit --metrics.',
  author: 'SelfDashboard',
  category: 'system',
  icon: '⚡',
  version: '1.2.0',
  defaultLayout: { w: 4, h: 3, minW: 2, minH: 2 },
  configSchema: [
    { key: 'title', label: 'Widget-Titel', type: 'text', defaultValue: 'LLM-Tempo' },
    { key: 'servers', label: 'Server (Name=URL je Zeile)', type: 'text', defaultValue: '' },
    { key: 'refreshSeconds', label: 'Aktualisierung (s)', type: 'number', defaultValue: 5 },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
