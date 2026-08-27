'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

type NetzwachtHost = {
  ip: string
  name: string
  mac: string
  bps: number
  totalBytes: number
  score: number
}

type NetzwachtAlert = {
  ts: string
  sig: string
  cat: string
  sev: number
  src: string
  dst: string
  dpt: number | null
  proto: string
}

type NetzwachtData = {
  ntopng: {
    ok: boolean
    error?: string
    throughputBps?: number
    numLocalHosts?: number
    numHosts?: number
    alertedFlows?: number
    engagedAlerts?: number
    topHosts?: NetzwachtHost[]
  }
  suricata: {
    ok: boolean
    configured: boolean
    error?: string
    h24?: { high: number; medium: number; low: number; total: number }
    latest?: string | null
    alerts?: NetzwachtAlert[]
  }
  error?: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''
}

function num(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v))
  return Number.isFinite(n) ? n : 0
}

function formatBps(bps: number, de: boolean): string {
  const bits = bps * 8
  const fmt = (v: number, unit: string) => {
    const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)
    return `${de ? s.replace('.', ',') : s} ${unit}`
  }
  if (bits >= 1e9) return fmt(bits / 1e9, 'Gbit/s')
  if (bits >= 1e6) return fmt(bits / 1e6, 'Mbit/s')
  if (bits >= 1e3) return fmt(bits / 1e3, 'kbit/s')
  return fmt(bits, 'bit/s')
}

function relTime(ts: string, de: boolean): string {
  const t = Date.parse(ts.replace(/(\.\d+)?\+0000$/, 'Z'))
  if (!Number.isFinite(t)) return ''
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 60) return de ? 'gerade eben' : 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return de ? `vor ${min} min` : `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return de ? `vor ${h} h` : `${h}h ago`
  const d = Math.round(h / 24)
  return de ? `vor ${d} Tagen` : `${d}d ago`
}

function sevColor(sev: number): string {
  if (sev <= 1) return '#ef4444'
  if (sev === 2) return '#f59e0b'
  return '#60a5fa'
}

function hostLabel(h: NetzwachtHost): string {
  const name = h.name && h.name !== h.ip ? h.name : ''
  // mDNS liefert manchmal UUIDs als Namen — dann lieber die IP zeigen.
  if (name && !/^[0-9a-f-]{30,}$/i.test(name)) return name
  return h.ip
}

function errorText(code: string, de: boolean): string {
  const map: Record<string, [string, string]> = {
    auth_failed: ['ntopng-Login abgelehnt — Benutzer/Passwort prüfen.', 'ntopng login rejected — check user/password.'],
    missing_credentials: ['ntopng-Zugangsdaten fehlen.', 'ntopng credentials missing.'],
    missing_url: ['ntopng-URL fehlt.', 'ntopng URL missing.'],
    invalid_url: ['Ungültige URL.', 'Invalid URL.'],
    blocked_url: ['URL blockiert (SSRF-Schutz).', 'URL blocked (SSRF guard).'],
    timeout: ['Zeitüberschreitung.', 'Timeout.'],
    network_error: ['Nicht erreichbar.', 'Unreachable.'],
    upstream_error: ['ntopng-Fehler.', 'ntopng error.'],
    alerts_auth_failed: ['Alarm-API: Token abgelehnt.', 'Alert API: token rejected.'],
    alerts_upstream_error: ['Alarm-API nicht erreichbar.', 'Alert API unreachable.'],
  }
  const pair = map[code]
  return pair ? pair[de ? 0 : 1] : code
}

function KpiTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <span
        style={{
          fontSize: 'clamp(8px, 2cqmin, 9px)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 'clamp(12px, 4cqmin, 17px)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: accent || 'var(--text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function Widget({ config }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const { active } = usePollingActive()
  const [data, setData] = useState<NetzwachtData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const ntopngUrl = str(config.ntopngUrl)
  const username = str(config.username)
  const password = str(config.password)
  const ifid = num(config.ifid)
  const alertsUrl = str(config.alertsUrl)
  const alertsToken = str(config.alertsToken)
  const maxAlerts = Math.min(25, Math.max(1, num(config.maxAlerts) || 6))
  const refreshMs = Math.max(10, num(config.refreshSeconds) || 30) * 1000
  const title = config.title === undefined ? 'NetzWacht' : str(config.title)
  const configured = Boolean(ntopngUrl && username && password)

  const refresh = useCallback(async () => {
    if (!configured) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/plugins/netzwacht', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ntopngUrl, username, password, ifid, alertsUrl, alertsToken, maxAlerts }),
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as NetzwachtData
      if (!res.ok || json.error) {
        setError(errorText(json.error || `HTTP ${res.status}`, de))
        return
      }
      setData(json)
      setError(null)
    } catch {
      setError(errorText('network_error', de))
    } finally {
      setLoading(false)
    }
  }, [alertsToken, alertsUrl, configured, de, ifid, maxAlerts, ntopngUrl, password, username])

  useEffect(() => {
    setLoading(true)
    void refresh()
    if (!active) return
    const t = setInterval(() => void refresh(), refreshMs)
    return () => clearInterval(t)
  }, [refresh, refreshMs, active])

  const shell: CSSProperties = {
    height: '100%',
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    boxSizing: 'border-box',
    padding: '10px 12px',
    containerType: 'size',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  }

  if (!configured) {
    return (
      <div style={{ ...shell, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <span style={{ fontSize: 24 }}>🛡️</span>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.45 }}>
          {de
            ? 'ntopng-URL, Benutzer und Passwort in den Einstellungen eintragen. Optional: Alarm-API-URL + Token für Suricata-Meldungen.'
            : 'Enter ntopng URL, user and password in settings. Optional: alert API URL + token for Suricata alerts.'}
        </p>
      </div>
    )
  }

  if (loading && !data && !error) {
    return (
      <div style={shell}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 38, flex: 1, borderRadius: 8 }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[70, 55, 62].map((w, i) => (
            <div key={i} className="skeleton" style={{ height: 11, width: `${w}%`, borderRadius: 3 }} />
          ))}
        </div>
      </div>
    )
  }

  const nt = data?.ntopng
  const su = data?.suricata
  const alertCount = su?.h24 ? su.h24.high + su.h24.medium : 0
  const alertAccent = su?.h24 && su.h24.high > 0 ? '#ef4444' : su?.h24 && su.h24.medium > 0 ? '#f59e0b' : '#34d399'

  return (
    <div style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {title ? (
          <p
            style={{
              margin: 0,
              flex: 1,
              minWidth: 0,
              fontSize: 'clamp(9px, 2.4cqmin, 10px)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </p>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        <span
          title={nt?.ok ? (de ? 'Verbunden' : 'Connected') : de ? 'Störung' : 'Degraded'}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            background: nt?.ok ? '#34d399' : '#ef4444',
          }}
        />
      </div>

      {nt?.ok ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <KpiTile label={de ? 'Durchsatz' : 'Throughput'} value={formatBps(num(nt.throughputBps), de)} />
          <KpiTile label={de ? 'Geräte' : 'Devices'} value={String(num(nt.numLocalHosts))} />
          <KpiTile
            label={de ? 'Alarme 24h' : 'Alerts 24h'}
            value={su?.ok ? String(alertCount) : '—'}
            accent={su?.ok ? alertAccent : undefined}
          />
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 11, color: '#ef4444' }}>{errorText(nt?.error || 'network_error', de)}</p>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {nt?.ok && (nt.topHosts?.length ?? 0) > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontSize: 'clamp(8px, 2cqmin, 9px)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
              }}
            >
              {de ? 'Top-Geräte (Verbrauch)' : 'Top devices (traffic)'}
            </span>
            {nt.topHosts!.slice(0, 3).map((h) => (
              <div key={h.ip} style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 'clamp(10px, 2.8cqmin, 12px)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={`${h.ip}${h.mac ? ` · ${h.mac}` : ''}`}
                >
                  {hostLabel(h)}
                </span>
                <span
                  style={{
                    fontSize: 'clamp(9px, 2.4cqmin, 11px)',
                    color: 'var(--text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatBps(h.bps, de)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {su?.configured ? (
          su.ok ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                style={{
                  fontSize: 'clamp(8px, 2cqmin, 9px)',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                }}
              >
                {de ? 'Letzte Meldungen' : 'Recent alerts'}
              </span>
              {(su.alerts?.length ?? 0) === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {de ? 'Keine Meldungen — alles ruhig.' : 'No alerts — all quiet.'}
                </span>
              ) : (
                su.alerts!.map((a, i) => (
                  <div key={`${a.ts}-${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        flexShrink: 0,
                        alignSelf: 'center',
                        background: sevColor(a.sev),
                      }}
                      title={`Severity ${a.sev}`}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 'clamp(9px, 2.6cqmin, 11px)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={`${a.sig}\n${a.src} → ${a.dst}${a.dpt ? `:${a.dpt}` : ''} (${a.proto})`}
                    >
                      {a.sig}
                    </span>
                    <span
                      style={{
                        fontSize: 'clamp(8px, 2.2cqmin, 10px)',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {relTime(a.ts, de)}
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 10, color: '#f59e0b' }}>
              {errorText(su.error || 'alerts_upstream_error', de)}
            </p>
          )
        ) : (
          <p style={{ margin: 0, fontSize: 10, color: 'var(--text-muted)' }}>
            {de
              ? 'Suricata-Alarme: Alarm-API-URL + Token in den Einstellungen eintragen.'
              : 'Suricata alerts: enter alert API URL + token in settings.'}
          </p>
        )}
      </div>

      {error ? (
        <p style={{ margin: 0, fontSize: 10, color: '#ef4444', lineHeight: 1.4, wordBreak: 'break-word' }}>{error}</p>
      ) : null}
    </div>
  )
}

const inp: CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 13,
  boxSizing: 'border-box',
}

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
          value={config.title === undefined ? 'NetzWacht' : str(config.title)}
          placeholder="NetzWacht"
          onChange={(e) => onChange('title', e.target.value)}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ntopng-URL</label>
        <input
          style={inp}
          value={str(config.ntopngUrl)}
          placeholder="http://192.168.1.103:3000"
          onChange={(e) => onChange('ntopngUrl', e.target.value)}
        />
        <label style={{ display: 'block', fontSize: 12, margin: '10px 0 4px' }}>
          {de ? 'ntopng-Benutzer' : 'ntopng user'}
        </label>
        <input
          style={inp}
          value={str(config.username)}
          autoComplete="off"
          placeholder="admin"
          onChange={(e) => onChange('username', e.target.value)}
        />
        <label style={{ display: 'block', fontSize: 12, margin: '10px 0 4px' }}>
          {de ? 'ntopng-Passwort' : 'ntopng password'}
        </label>
        <input
          style={inp}
          type="password"
          value={str(config.password)}
          autoComplete="new-password"
          onChange={(e) => onChange('password', e.target.value)}
        />
        <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {de
            ? 'Abfrage läuft serverseitig über /api/plugins/netzwacht — die Zugangsdaten verlassen das Dashboard nicht.'
            : 'Requests go server-side via /api/plugins/netzwacht — credentials never leave the dashboard.'}
        </p>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {de ? 'Alarm-API-URL (Suricata, optional)' : 'Alert API URL (Suricata, optional)'}
        </label>
        <input
          style={inp}
          value={str(config.alertsUrl)}
          placeholder="http://192.168.1.103:3001"
          onChange={(e) => onChange('alertsUrl', e.target.value)}
        />
        <label style={{ display: 'block', fontSize: 12, margin: '10px 0 4px' }}>
          {de ? 'Alarm-API-Token' : 'Alert API token'}
        </label>
        <input
          style={inp}
          type="password"
          value={str(config.alertsToken)}
          autoComplete="new-password"
          onChange={(e) => onChange('alertsToken', e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            {de ? 'Aktualisieren (Sek.)' : 'Refresh (seconds)'}
          </label>
          <input
            style={inp}
            type="number"
            min={10}
            max={3600}
            value={num(config.refreshSeconds) || 30}
            onChange={(e) => onChange('refreshSeconds', Math.max(10, num(e.target.value) || 30))}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            {de ? 'Max. Meldungen' : 'Max alerts'}
          </label>
          <input
            style={inp}
            type="number"
            min={1}
            max={25}
            value={num(config.maxAlerts) || 6}
            onChange={(e) => onChange('maxAlerts', Math.min(25, Math.max(1, num(e.target.value) || 6)))}
          />
        </div>
      </div>
    </div>
  )
}

export const meta: PluginMeta = {
  id: 'netzwacht',
  name: 'NetzWacht',
  description:
    'Netzwerk-Wächter: Live-Durchsatz, Top-Geräte und Suricata-Sicherheitsalarme vom ntopng-Stack. (Beta)',
  version: '0.1.0',
  author: 'SelfDashboard',
  category: 'security',
  icon: '🛡️',
  defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
  configSchema: [
    { key: 'title', label: 'Widget-Titel', type: 'text', defaultValue: 'NetzWacht' },
    { key: 'ntopngUrl', label: 'ntopng-URL', type: 'text', placeholder: 'http://192.168.1.103:3000', defaultValue: '' },
    { key: 'username', label: 'ntopng-Benutzer', type: 'text', defaultValue: '' },
    { key: 'password', label: 'ntopng-Passwort', type: 'password', defaultValue: '' },
    { key: 'alertsUrl', label: 'Alarm-API-URL', type: 'text', placeholder: 'http://192.168.1.103:3001', defaultValue: '' },
    { key: 'alertsToken', label: 'Alarm-API-Token', type: 'password', defaultValue: '' },
    { key: 'refreshSeconds', label: 'Aktualisieren (Sek.)', type: 'number', defaultValue: 30 },
    { key: 'maxAlerts', label: 'Max. Meldungen', type: 'number', defaultValue: 6 },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
