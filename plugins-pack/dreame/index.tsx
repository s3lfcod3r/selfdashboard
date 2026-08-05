'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

// ---------------------------------------------------------------------------
// Types — mirror server.ts
// ---------------------------------------------------------------------------

type VacStatus = 'cleaning' | 'returning' | 'charging' | 'paused' | 'idle' | 'error' | 'other'

type DeviceResult = {
  did: string
  name: string
  model: string
  online: boolean
  battery?: number | null
  charging?: number | null
  stateCode?: number
  status?: VacStatus
  error?: number | null
  cleaningTime?: number | null
  cleanedArea?: number | null
  consumables?: Consumables
}

type Consumables = {
  mainBrush?: number | null
  sideBrush?: number | null
  filter?: number | null
  sensor?: number | null
  mopPad?: number | null
}

type Cmd = 'start' | 'pause' | 'dock'

// Dreame fault/warning codes → readable text. `warn` = care/emptying reminder
// (amber); otherwise a real error (red). Unknown codes fall back to a number.
type Fault = { de: string; en: string; warn: boolean }
const FAULTS: Record<number, Fault> = {
  1: { de: 'Angehoben', en: 'Lifted', warn: true },
  2: { de: 'Absturzsensor prüfen', en: 'Check cliff sensor', warn: true },
  3: { de: 'Stoßstange klemmt', en: 'Bumper stuck', warn: false },
  8: { de: 'Staubbehälter fehlt', en: 'Dust bin missing', warn: true },
  9: { de: 'Wassertank/Behälter prüfen', en: 'Check tank/bin', warn: true },
  10: { de: 'Frischwassertank leer — auffüllen', en: 'Clean-water tank empty', warn: true },
  11: { de: 'Staubbehälter voll — leeren', en: 'Dust bin full', warn: true },
  12: { de: 'Hauptbürste blockiert — reinigen', en: 'Main brush stuck', warn: true },
  13: { de: 'Seitenbürste blockiert — reinigen', en: 'Side brush stuck', warn: true },
  14: { de: 'Lüfter blockiert', en: 'Fan blocked', warn: false },
  20: { de: 'Akku niedrig', en: 'Battery low', warn: true },
  21: { de: 'Ladefehler', en: 'Charging fault', warn: false },
  47: { de: 'Roboter blockiert', en: 'Robot blocked', warn: true },
  48: { de: 'Laser/LDS-Fehler', en: 'Laser/LDS error', warn: false },
  51: { de: 'Filter reinigen', en: 'Clean filter', warn: true },
  56: { de: 'Laser-Sensor prüfen', en: 'Check laser sensor', warn: false },
  68: { de: 'Wischmopp entfernen', en: 'Remove mop', warn: true },
  75: { de: 'Akku leer — abgeschaltet', en: 'Battery empty — off', warn: true },
  80: { de: 'Roboter steckt fest', en: 'Robot stuck', warn: true },
  85: { de: 'Wischmopp-Sitz prüfen', en: 'Check mop install', warn: true },
  86: { de: 'Schmutzwassertank voll — leeren', en: 'Dirty-water tank full', warn: true },
  90: { de: 'Roboter steckt fest', en: 'Robot stuck', warn: true },
  101: { de: 'Staubbehälter voll — leeren', en: 'Dust bin full', warn: true },
  102: { de: 'Staubbehälter offen', en: 'Dust bin open', warn: true },
  103: { de: 'Staubbehälter offen', en: 'Dust bin open', warn: true },
  104: { de: 'Staubbehälter voll — leeren', en: 'Dust bin full', warn: true },
  105: { de: 'Wassertank prüfen', en: 'Check water tank', warn: true },
  107: { de: 'Frischwassertank leer — auffüllen', en: 'Clean-water tank empty', warn: true },
  111: { de: 'Wischpad prüfen', en: 'Check mop pad', warn: true },
  112: { de: 'Wischpad nass — trocknen', en: 'Mop pad wet — dry it', warn: true },
  114: { de: 'Wischpad reinigen', en: 'Clean mop pad', warn: true },
  116: { de: 'Frischwasser im Dock auffüllen', en: 'Refill dock clean water', warn: true },
  117: { de: 'Station getrennt', en: 'Station disconnected', warn: true },
  118: { de: 'Schmutzwasser im Dock leeren', en: 'Empty dock dirty water', warn: true },
  120: { de: 'Kein Wischmopp in Station', en: 'No mop in station', warn: true },
  121: { de: 'Staubbeutel voll — leeren', en: 'Dust bag full', warn: true },
  123: { de: 'Selbsttest fehlgeschlagen', en: 'Self-test failed', warn: false },
  126: { de: 'Wischmopp nicht erkannt', en: 'Mop not detected', warn: true },
}

function faultInfo(code: number, de: boolean): { text: string; warn: boolean } {
  const f = FAULTS[code]
  if (f) return { text: de ? f.de : f.en, warn: f.warn }
  return { text: de ? `Meldung ${code}` : `Notice ${code}`, warn: true }
}

const CONSUMABLE_LABELS: { key: keyof Consumables; de: string; en: string }[] = [
  { key: 'mainBrush', de: 'Hauptbürste', en: 'Main brush' },
  { key: 'sideBrush', de: 'Seitenbürste', en: 'Side brush' },
  { key: 'filter', de: 'Filter', en: 'Filter' },
  { key: 'mopPad', de: 'Wischpad', en: 'Mop pad' },
  { key: 'sensor', de: 'Sensoren', en: 'Sensors' },
]

function lifeColor(pct: number): string {
  if (pct <= 10) return '#ef4444'
  if (pct <= 25) return '#f59e0b'
  return '#22c55e'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''
}
function num(v: unknown, d: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(String(v))
  return Number.isFinite(n) ? n : d
}
function clampRefresh(v: unknown): number {
  return Math.min(300, Math.max(15, Math.round(num(v, 30))))
}

const STATUS_COLOR: Record<VacStatus, string> = {
  cleaning: '#22c55e',
  returning: '#3b82f6',
  charging: 'var(--accent)',
  paused: '#f59e0b',
  idle: 'var(--text-muted)',
  error: '#ef4444',
  other: 'var(--text-muted)',
}

function statusLabel(s: VacStatus | undefined, de: boolean): string {
  switch (s) {
    case 'cleaning':
      return de ? 'Reinigt' : 'Cleaning'
    case 'returning':
      return de ? 'Fährt zur Basis' : 'Returning'
    case 'charging':
      return de ? 'Lädt' : 'Charging'
    case 'paused':
      return de ? 'Pausiert' : 'Paused'
    case 'idle':
      return de ? 'Bereit' : 'Ready'
    case 'error':
      return de ? 'Fehler' : 'Error'
    default:
      return de ? 'Unbekannt' : 'Unknown'
  }
}

function errorText(code: string | undefined, de: boolean): string {
  switch (code) {
    case 'auth_failed':
    case 'missing_credentials':
      return de ? 'Login fehlgeschlagen — Zugangsdaten/Region prüfen' : 'Login failed — check credentials/region'
    case 'timeout':
      return de ? 'Zeitüberschreitung (Cloud)' : 'Cloud timed out'
    default:
      return de ? 'Cloud nicht erreichbar' : 'Cloud unreachable'
  }
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

type IconProps = { size?: number; color?: string }

function IconRobot({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2" />
    </svg>
  )
}
function IconPlay({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" aria-hidden>
      <path d="M6 4.5v15l13-7.5z" />
    </svg>
  )
}
function IconPause({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}
function IconHome({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  )
}
function IconBoltSmall({ size = 12, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" aria-hidden>
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type Creds = { email: string; password: string; country: string }

async function fetchStatus(c: Creds, signal: AbortSignal): Promise<{ devices: DeviceResult[] } | { error: string } | null> {
  try {
    const res = await fetch('/api/plugins/dreame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', ...c }),
      cache: 'no-store',
      signal,
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { error: str(json.error) || 'unreachable' }
    return { devices: Array.isArray(json.devices) ? (json.devices as DeviceResult[]) : [] }
  } catch {
    return null
  }
}

async function sendCommand(c: Creds, did: string, cmd: Cmd): Promise<boolean> {
  try {
    const res = await fetch('/api/plugins/dreame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'command', cmd, did, ...c }),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function Widget({ config }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const cfg = config as Record<string, unknown>
  const email = str(cfg.email)
  const password = str(cfg.password)
  const country = str(cfg.country) || 'eu'
  const creds = useMemo(() => ({ email, password, country }), [email, password, country])
  const configured = Boolean(email && password)
  const allowControl = cfg.allowControl !== false
  const refreshSec = clampRefresh(cfg.refreshSeconds)
  const showTitle = cfg.showTitle !== false
  const title = cfg.title === undefined ? 'Dreame' : str(cfg.title)

  // Show the last-known devices immediately on (re)load, then refresh in the
  // background — the cloud call is slow, so this makes the tile feel instant.
  // sessionStorage survives a page reload (cleared only when the tab closes).
  const cacheKey = `sd:dreame:${country}:${email}`
  const [devices, setDevices] = useState<DeviceResult[] | null>(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(cacheKey)
        if (raw) {
          const parsed = JSON.parse(raw) as { devices?: unknown }
          if (Array.isArray(parsed.devices)) return parsed.devices as DeviceResult[]
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
    return null
  })
  const [errCode, setErrCode] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const busyRef = useRef(false)
  const cmdTimerRef = useRef<number | null>(null)
  const { ref: shellRef, active } = usePollingActive<HTMLDivElement>()

  const refresh = useCallback(
    async (signal: AbortSignal) => {
      if (!configured) return
      if (busyRef.current) return
      busyRef.current = true
      try {
        const res = await fetchStatus(creds, signal)
        if (signal.aborted || res == null) return
        if ('error' in res) {
          setErrCode(res.error)
        } else {
          setErrCode(null)
          setDevices(res.devices)
          try {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem(cacheKey, JSON.stringify({ devices: res.devices }))
            }
          } catch {
            /* storage full / disabled — ignore */
          }
        }
      } finally {
        busyRef.current = false
      }
    },
    [creds, configured],
  )

  useEffect(() => {
    if (!active || !configured) return
    const ac = new AbortController()
    void refresh(ac.signal)
    const t = window.setInterval(() => void refresh(ac.signal), refreshSec * 1000)
    return () => {
      ac.abort()
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds.email, creds.password, creds.country, refreshSec, active, configured])

  // Clear a pending post-command refresh if the widget unmounts.
  useEffect(() => () => {
    if (cmdTimerRef.current) window.clearTimeout(cmdTimerRef.current)
  }, [])

  const runCmd = useCallback(
    async (did: string, cmd: Cmd) => {
      setPending((p) => ({ ...p, [did]: true }))
      await sendCommand(creds, did, cmd)
      setPending((p) => ({ ...p, [did]: false }))
      // Give the cloud a moment to reflect the new state, then refresh.
      if (cmdTimerRef.current) window.clearTimeout(cmdTimerRef.current)
      const ac = new AbortController()
      cmdTimerRef.current = window.setTimeout(() => void refresh(ac.signal), 1500)
    },
    [creds, refresh],
  )

  const shell: CSSProperties = {
    height: '100%',
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    boxSizing: 'border-box',
    padding: '12px 14px',
    containerType: 'size',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  }

  if (!configured) {
    return (
      <div ref={shellRef} style={{ ...shell, alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
        <IconRobot size={30} color="var(--text-muted)" />
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
          {de ? 'Dreame-Konto (E-Mail + Passwort) in den Einstellungen eintragen.' : 'Enter your Dreame account (email + password) in settings.'}
        </p>
      </div>
    )
  }

  return (
    <div ref={shellRef} style={shell}>
      {showTitle && title ? (
        <p style={{ margin: 0, fontSize: 'clamp(9px, 2.4cqmin, 10px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', flexShrink: 0 }}>
          {title} <span style={{ opacity: 0.6 }}>· Beta</span>
        </p>
      ) : null}

      {errCode && devices == null ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{errorText(errCode, de)}</p>
        </div>
      ) : devices == null ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{de ? 'Wird geladen…' : 'Loading…'}</p>
        </div>
      ) : devices.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            {de ? 'Kein Roboter im Konto gefunden (Region richtig?).' : 'No robot found in the account (correct region?).'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {errCode ? (
            <span style={{ fontSize: 'clamp(9px, 2.2cqmin, 10.5px)', color: '#f59e0b', fontWeight: 600 }}>
              {de ? '⚠ Aktualisierung fehlgeschlagen — zeige letzten Stand' : '⚠ Update failed — showing last state'}
            </span>
          ) : null}
          {devices.map((d) => (
            <RobotCard key={d.did} device={d} de={de} allowControl={allowControl} pending={Boolean(pending[d.did])} onCmd={runCmd} />
          ))}
        </div>
      )}
    </div>
  )
}

function RobotCard({
  device,
  de,
  allowControl,
  pending,
  onCmd,
}: {
  device: DeviceResult
  de: boolean
  allowControl: boolean
  pending: boolean
  onCmd: (did: string, cmd: Cmd) => void
}) {
  const status = device.status ?? 'other'
  const color = device.online ? STATUS_COLOR[status] : 'var(--text-muted)'
  const battery = device.battery
  const charging = device.charging === 1 || device.charging === 5
  const fault = device.online && typeof device.error === 'number' && device.error > 0 ? faultInfo(device.error, de) : null
  const care = CONSUMABLE_LABELS.map((c) => ({ ...c, pct: device.consumables?.[c.key] })).filter(
    (c) => typeof c.pct === 'number',
  ) as { key: keyof Consumables; de: string; en: string; pct: number }[]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <IconRobot size={18} color={color} />
        <span style={{ fontSize: 'clamp(11px, 3cqmin, 13px)', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }} title={device.name}>
          {device.name}
        </span>
        {battery != null ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'clamp(10px, 2.7cqmin, 12px)', fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
            {charging ? <IconBoltSmall size={11} color="var(--accent)" /> : null}
            {Math.round(battery)}%
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'clamp(13px, 4cqmin, 16px)', fontWeight: 800, color }}>
          {device.online ? statusLabel(status, de) : de ? 'Offline' : 'Offline'}
        </span>
        {fault ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 'clamp(9px, 2.3cqmin, 10.5px)',
              fontWeight: 700,
              color: fault.warn ? '#f59e0b' : '#ef4444',
              background: fault.warn ? 'rgba(245,158,11,0.14)' : 'rgba(239,68,68,0.14)',
            }}
          >
            {fault.warn ? '⚠' : '✕'} {fault.text}
          </span>
        ) : null}
      </div>

      {device.online && (device.cleaningTime != null || device.cleanedArea != null) ? (
        <div style={{ display: 'flex', gap: 14 }}>
          {device.cleanedArea != null ? (
            <Stat label={de ? 'Fläche' : 'Area'} value={`${Math.round(device.cleanedArea)} m²`} />
          ) : null}
          {device.cleaningTime != null ? (
            <Stat label={de ? 'Dauer' : 'Time'} value={de ? `${Math.round(device.cleaningTime)} Min` : `${Math.round(device.cleaningTime)} min`} />
          ) : null}
        </div>
      ) : null}

      {care.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
          <span style={{ fontSize: 'clamp(8px, 2cqmin, 9.5px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            {de ? 'Pflege' : 'Care'}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
            {care.map((c) => (
              <span key={c.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'clamp(9px, 2.2cqmin, 10.5px)', color: 'var(--text-muted)' }}>
                {de ? c.de : c.en}
                <span style={{ fontWeight: 700, color: lifeColor(c.pct) }}>{Math.round(c.pct)}%</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {allowControl && device.online ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 1 }}>
          <CtrlButton label={de ? 'Start' : 'Start'} icon={<IconPlay size={14} />} disabled={pending} onClick={() => onCmd(device.did, 'start')} />
          <CtrlButton label={de ? 'Pause' : 'Pause'} icon={<IconPause size={14} />} disabled={pending} onClick={() => onCmd(device.did, 'pause')} />
          <CtrlButton label={de ? 'Basis' : 'Dock'} icon={<IconHome size={14} />} disabled={pending} onClick={() => onCmd(device.did, 'dock')} />
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 'clamp(8px, 2cqmin, 9.5px)', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 'clamp(10px, 2.6cqmin, 12px)', fontWeight: 700, color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function CtrlButton({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: '6px 4px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--section, var(--bg))',
        color: 'var(--text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: 'clamp(10px, 2.6cqmin, 12px)',
        fontWeight: 600,
      }}
    >
      {icon}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

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
  const cfg = config as Record<string, unknown>
  const showTitle = cfg.showTitle !== false
  const allowControl = cfg.allowControl !== false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={showTitle} onChange={(e) => onChange('showTitle', e.target.checked)} />
          {de ? 'Titel oben anzeigen' : 'Show title at top'}
        </label>
        <input style={{ ...inp, opacity: showTitle ? 1 : 0.5 }} disabled={!showTitle} value={cfg.title === undefined ? 'Dreame' : str(cfg.title)} placeholder="Dreame" onChange={(e) => onChange('title', e.target.value)} />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Dreamehome-Konto' : 'Dreamehome account'}</label>
        <input style={{ ...inp, marginBottom: 6 }} type="email" autoComplete="off" value={str(cfg.email)} placeholder={de ? 'E-Mail' : 'Email'} onChange={(e) => onChange('email', e.target.value)} />
        <input style={{ ...inp, marginBottom: 6 }} type="password" autoComplete="new-password" value={str(cfg.password)} placeholder={de ? 'Passwort' : 'Password'} onChange={(e) => onChange('password', e.target.value)} />
        <input style={inp} value={cfg.country === undefined ? 'eu' : str(cfg.country)} placeholder={de ? 'Region (z. B. eu)' : 'Region (e.g. eu)'} onChange={(e) => onChange('country', e.target.value)} />
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
          {de
            ? 'Login mit E-Mail+Passwort aus der Dreamehome-App (nicht Google/Apple). Passwort wird verschlüsselt gespeichert; danach nutzt das Plugin einen Refresh-Token. Region für Deutschland/Europa: eu.'
            : 'Log in with the email+password from the Dreamehome app (not Google/Apple). The password is stored encrypted; afterwards the plugin uses a refresh token. Region for Germany/Europe: eu.'}
        </p>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={allowControl} onChange={(e) => onChange('allowControl', e.target.checked)} />
        {de ? 'Steuern erlauben (Start/Pause/Basis)' : 'Allow control (start/pause/dock)'}
      </label>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Aktualisieren (Sek.)' : 'Refresh (sec.)'}</label>
        <input style={inp} type="number" min={15} max={300} value={clampRefresh(cfg.refreshSeconds)} onChange={(e) => onChange('refreshSeconds', clampRefresh(e.target.value))} />
      </div>

      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {de
          ? '⚠️ Beta: nutzt die inoffizielle Dreame-Cloud. Funktioniert nur über die Cloud (kein lokaler Zugriff) und kann bei Dreame-App-Updates vorübergehend ausfallen.'
          : '⚠️ Beta: uses the unofficial Dreame cloud. Cloud-only (no local access) and may break temporarily when the Dreame app updates.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meta + exports
// ---------------------------------------------------------------------------

export const meta: PluginMeta = {
  id: 'dreame',
  name: 'Dreame',
  description:
    'Dreame Saugroboter (Dreamehome-Cloud): Akku, Zustand, Fehler und Reinigungs-Statistik anzeigen und Start / Pause / zur Basis schalten. Login mit E-Mail+Passwort (verschlüsselt, danach Refresh-Token). Cloud-basiert (Beta).',
  author: 'SelfDashboard',
  category: 'utility',
  icon: '🤖',
  iconUrl: 'https://cdn.jsdelivr.net/gh/s3lfcod3r/selfdashboard@main/plugins-pack/dreame/logo-d.svg',
  version: '1.1.2',
  defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 },
  configSchema: [
    { key: 'email', label: 'E-Mail', type: 'text', defaultValue: '' },
    { key: 'password', label: 'Passwort', type: 'password', defaultValue: '' },
    { key: 'country', label: 'Region', type: 'text', defaultValue: 'eu' },
    { key: 'allowControl', label: 'Steuern erlauben', type: 'boolean', defaultValue: true },
    { key: 'showTitle', label: 'Titel anzeigen', type: 'boolean', defaultValue: true },
    { key: 'title', label: 'Widget-Titel', type: 'text', defaultValue: 'Dreame' },
    { key: 'refreshSeconds', label: 'Aktualisieren (Sek.)', type: 'number', defaultValue: 30 },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
