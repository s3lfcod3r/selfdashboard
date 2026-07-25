'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import { useDashboardStore } from '@/lib/store'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

// ---------------------------------------------------------------------------
// Types — mirror the normalized shape from server.ts.
// ---------------------------------------------------------------------------

type Device = { id: string; name: string; ip: string }

type PhaseReading = { v: number | null; i: number | null; p: number | null }

type EnergyReading = {
  importToday: number
  importWeek: number
  importMonth: number
  exportToday: number
  exportWeek: number
  exportMonth: number
}

type DeviceResult = {
  id: string
  name: string
  online: boolean
  totalPower: number | null
  totalCurrent: number | null
  phases: PhaseReading[]
  energy?: EnergyReading
  error?: string
}

const MAX_DEVICES = 8
const PHASE_LABELS = ['L1', 'L2', 'L3']

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
  return Math.min(300, Math.max(10, Math.round(num(v, 10))))
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `d_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

function parseDevices(raw: unknown): Device[] {
  let arr: unknown = raw
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw || '[]')
    } catch {
      return []
    }
  }
  if (!Array.isArray(arr)) return []
  return arr
    .slice(0, MAX_DEVICES)
    .map((d): Device | null => {
      if (typeof d !== 'object' || d === null) return null
      const o = d as Record<string, unknown>
      return { id: str(o.id) || newId(), name: str(o.name), ip: str(o.ip) }
    })
    .filter((d): d is Device => d !== null)
}

/** Watts → "820 W" / "1,24 kW". Sign is handled by the caller. */
function fmtPower(w: number, de: boolean): string {
  const abs = Math.abs(w)
  if (abs >= 1000) {
    const kw = abs / 1000
    return `${kw.toLocaleString(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: 2 })} kW`
  }
  return `${Math.round(abs).toLocaleString(de ? 'de-DE' : 'en-GB')} W`
}

function fmtKwh(kwh: number, de: boolean): string {
  return `${kwh.toLocaleString(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: kwh < 10 ? 2 : 1 })} kWh`
}

function errorText(code: string | undefined, de: boolean): string {
  switch (code) {
    case 'auth_failed':
      return de ? 'Passwort nötig/falsch' : 'Password needed/wrong'
    case 'blocked_url':
      return de ? 'LAN blockiert (SSRF)' : 'LAN blocked (SSRF)'
    case 'timeout':
      return de ? 'Zeitüberschreitung' : 'Timed out'
    default:
      return de ? 'Nicht erreichbar' : 'Unreachable'
  }
}

// ---------------------------------------------------------------------------
// Inline SVG icons — never depend on the host's curated lucide set.
// ---------------------------------------------------------------------------

type IconProps = { size?: number; color?: string }

function IconBolt({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  )
}

function IconArrowDown({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  )
}

function IconArrowUp({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  )
}

function IconPlus({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}

function IconTrash({ size = 15, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Colours: drawing from grid = warm/red, feeding in = green, idle = muted.
// ---------------------------------------------------------------------------

const COLOR_IMPORT = '#ef4444'
const COLOR_EXPORT = '#22c55e'

function flowColor(power: number | null): string {
  if (power == null) return 'var(--text-muted)'
  if (power < -5) return COLOR_EXPORT
  if (power > 5) return COLOR_IMPORT
  return 'var(--text-muted)'
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchStatus(
  devices: Device[],
  password: string,
  track: boolean,
  signal: AbortSignal,
): Promise<DeviceResult[] | null> {
  try {
    const res = await fetch('/api/plugins/shelly-3em', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices, password, track }),
      cache: 'no-store',
      signal,
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || !Array.isArray(json.devices)) return null
    return json.devices as DeviceResult[]
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function Widget({ config, instanceId }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const cfg = config as Record<string, unknown>
  const updatePluginConfig = useDashboardStore((s) => s.updatePluginConfig)

  const allDevices = useMemo(() => parseDevices(cfg.devices), [cfg.devices])
  const devices = useMemo(() => allDevices.filter((d) => d.ip), [allDevices])
  const password = str(cfg.password)
  const track = cfg.trackHistory !== false
  const refreshSec = clampRefresh(cfg.refreshSeconds)
  const showTitle = cfg.showTitle !== false
  const title = cfg.title === undefined ? 'Shelly 3EM' : str(cfg.title)
  const canEdit = Boolean(instanceId)

  const [results, setResults] = useState<DeviceResult[] | null>(null)
  const busyRef = useRef(false)
  const { ref: shellRef, active } = usePollingActive<HTMLDivElement>()

  const addDevice = useCallback(
    (name: string, ip: string) => {
      // Build from the unfiltered list so a half-finished (blank-IP) entry from
      // Settings is not silently dropped when quick-adding here.
      if (!instanceId || !ip.trim() || allDevices.length >= MAX_DEVICES) return
      const next = [...allDevices, { id: newId(), name: name.trim(), ip: ip.trim() }]
      updatePluginConfig(instanceId, { devices: JSON.stringify(next) })
    },
    [instanceId, allDevices, updatePluginConfig],
  )

  const sig = useMemo(() => devices.map((d) => `${d.id}|${d.ip}`).join(','), [devices])

  const refresh = useCallback(
    async (signal: AbortSignal) => {
      if (devices.length === 0) {
        setResults([])
        return
      }
      // Skip if a previous poll is still in flight (slow/offline device).
      if (busyRef.current) return
      busyRef.current = true
      try {
        const data = await fetchStatus(devices, password, track, signal)
        if (signal.aborted || data == null) return
        setResults(data)
      } finally {
        busyRef.current = false
      }
    },
    [devices, password, track],
  )

  useEffect(() => {
    if (!active) return
    const ac = new AbortController()
    void refresh(ac.signal)
    const t = window.setInterval(() => void refresh(ac.signal), refreshSec * 1000)
    return () => {
      ac.abort()
      window.clearInterval(t)
    }
    // sig proxies devices; password/track/refreshSec are captured explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, password, track, refreshSec, active])

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

  if (devices.length === 0) {
    return (
      <div ref={shellRef} style={{ ...shell, alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
        <IconBolt size={30} color="var(--text-muted)" />
        {canEdit ? (
          <div style={{ width: '100%', maxWidth: 320 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.45 }}>
              {de ? 'Shelly 3EM hinzufügen (Name + IP):' : 'Add a Shelly 3EM (name + IP):'}
            </p>
            <AddForm onAdd={addDevice} de={de} />
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
            {de ? 'Noch kein Gerät. In den Einstellungen hinzufügen.' : 'No device yet. Add one in settings.'}
          </p>
        )}
      </div>
    )
  }

  const byId = new Map((results ?? []).map((r) => [r.id, r]))

  return (
    <div ref={shellRef} style={shell}>
      {showTitle && title ? (
        <p style={{ margin: 0, fontSize: 'clamp(9px, 2.4cqmin, 10px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', flexShrink: 0 }}>
          {title}
        </p>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {devices.map((d) => (
          <DeviceCard key={d.id} device={d} result={byId.get(d.id)} de={de} showHistory={track} />
        ))}
      </div>

      {canEdit && devices.length < MAX_DEVICES ? (
        <div style={{ flexShrink: 0 }}>
          <AddForm onAdd={addDevice} de={de} compact />
        </div>
      ) : null}
    </div>
  )
}

function DeviceCard({
  device,
  result,
  de,
  showHistory,
}: {
  device: Device
  result: DeviceResult | undefined
  de: boolean
  showHistory: boolean
}) {
  const loading = result === undefined
  const offline = result != null && !result.online
  const total = result?.totalPower ?? null
  const color = offline ? 'var(--text-muted)' : flowColor(total)
  const importing = total != null && total > 5
  const exporting = total != null && total < -5

  const name = device.name || device.ip

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 11px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${color}` }}>
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: offline ? 'var(--text-muted)' : '#22c55e' }} />
        <span style={{ fontSize: 'clamp(11px, 3cqmin, 13px)', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={name}>
          {name}
        </span>
      </div>

      {loading ? (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{de ? 'Wird geladen…' : 'Loading…'}</span>
      ) : offline ? (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{errorText(result?.error, de)}</span>
      ) : (
        <>
          {/* total power with flow direction */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', color }}>
              {importing ? <IconArrowDown size={16} /> : exporting ? <IconArrowUp size={16} /> : <IconBolt size={15} />}
            </span>
            <span style={{ fontSize: 'clamp(18px, 6cqmin, 26px)', fontWeight: 800, color, lineHeight: 1 }}>
              {total != null ? fmtPower(total, de) : '—'}
            </span>
            <span style={{ fontSize: 'clamp(9px, 2.4cqmin, 11px)', fontWeight: 600, color: 'var(--text-muted)' }}>
              {importing ? (de ? 'Bezug' : 'Import') : exporting ? (de ? 'Einspeisung' : 'Export') : de ? 'Ruhe' : 'Idle'}
            </span>
          </div>

          {/* per-phase */}
          <div style={{ display: 'flex', gap: 6 }}>
            {result?.phases.map((ph, idx) => (
              <div key={idx} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, padding: '4px 6px', borderRadius: 8, background: 'var(--section, var(--bg))' }}>
                <span style={{ fontSize: 'clamp(8px, 2cqmin, 9.5px)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                  {PHASE_LABELS[idx]}
                </span>
                <span style={{ fontSize: 'clamp(10px, 2.7cqmin, 12px)', fontWeight: 700, color: flowColor(ph.p) }}>
                  {ph.p != null ? fmtPower(ph.p, de) : '—'}
                </span>
                <span style={{ fontSize: 'clamp(8px, 2cqmin, 9.5px)', color: 'var(--text-muted)' }}>
                  {ph.v != null ? `${Math.round(ph.v)} V` : ''}
                  {ph.i != null ? ` · ${ph.i.toLocaleString(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: 1 })} A` : ''}
                </span>
              </div>
            ))}
          </div>

          {/* energy history */}
          {showHistory && result?.energy ? (
            <div style={{ display: 'flex', gap: 10, marginTop: 1, flexWrap: 'wrap' }}>
              <EnergyStat label={de ? 'Bezug heute' : 'Import today'} value={result.energy.importToday} color={COLOR_IMPORT} de={de} />
              <EnergyStat label={de ? 'Einsp. heute' : 'Export today'} value={result.energy.exportToday} color={COLOR_EXPORT} de={de} />
              <EnergyStat label={de ? 'Bezug 30 T' : 'Import 30d'} value={result.energy.importMonth} color={COLOR_IMPORT} de={de} />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function EnergyStat({ label, value, color, de }: { label: string; value: number; color: string; de: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <span style={{ fontSize: 'clamp(8px, 2cqmin, 9.5px)', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{label}</span>
      <span style={{ fontSize: 'clamp(10px, 2.6cqmin, 12px)', fontWeight: 700, color }}>{fmtKwh(value, de)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared inputs / add form
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

function AddForm({ onAdd, de, compact }: { onAdd: (name: string, ip: string) => void; de: boolean; compact?: boolean }) {
  const [name, setName] = useState('')
  const [ip, setIp] = useState('')
  const ready = ip.trim().length > 0
  const submit = () => {
    if (!ready) return
    onAdd(name, ip)
    setName('')
    setIp('')
  }
  const field: CSSProperties = { ...inp, fontSize: compact ? 12 : 13, padding: compact ? '5px 8px' : '6px 10px' }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input style={{ ...field, flex: 1, minWidth: 0 }} value={name} placeholder={de ? 'Name' : 'Name'} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <input style={{ ...field, flex: 1, minWidth: 0 }} value={ip} placeholder={de ? 'IP / Host' : 'IP / host'} onChange={(e) => setIp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <button type="button" onClick={submit} disabled={!ready} title={de ? 'Hinzufügen' : 'Add'} aria-label={de ? 'Hinzufügen' : 'Add'} style={{ ...field, width: 'auto', cursor: ready ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', opacity: ready ? 1 : 0.5, color: 'var(--accent)' }}>
        <IconPlus size={16} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function Settings({ config, onChange }: PluginSettingsProps) {
  const { de } = usePluginLocale()
  const cfg = config as Record<string, unknown>
  const devices = useMemo(() => parseDevices(cfg.devices), [cfg.devices])
  const showTitle = cfg.showTitle !== false
  const track = cfg.trackHistory !== false

  const persist = useCallback((list: Device[]) => onChange('devices', JSON.stringify(list)), [onChange])
  const update = useCallback(
    (id: string, patch: Partial<Device>) => persist(devices.map((d) => (d.id === id ? { ...d, ...patch } : d))),
    [devices, persist],
  )
  const remove = useCallback((id: string) => persist(devices.filter((d) => d.id !== id)), [devices, persist])
  const add = useCallback(() => {
    if (devices.length >= MAX_DEVICES) return
    persist([...devices, { id: newId(), name: '', ip: '' }])
  }, [devices, persist])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={showTitle} onChange={(e) => onChange('showTitle', e.target.checked)} />
          {de ? 'Titel oben anzeigen' : 'Show title at top'}
        </label>
        <input style={{ ...inp, opacity: showTitle ? 1 : 0.5 }} disabled={!showTitle} value={cfg.title === undefined ? 'Shelly 3EM' : str(cfg.title)} placeholder="Shelly 3EM" onChange={(e) => onChange('title', e.target.value)} />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Geräte' : 'Devices'}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {devices.map((d) => (
            <div key={d.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input style={{ ...inp, flex: 1 }} value={d.name} placeholder={de ? 'Name' : 'Name'} onChange={(e) => update(d.id, { name: e.target.value })} />
              <input style={{ ...inp, flex: 1 }} value={d.ip} placeholder={de ? 'IP / Host' : 'IP / host'} onChange={(e) => update(d.id, { ip: e.target.value })} />
              <button type="button" onClick={() => remove(d.id)} title={de ? 'Entfernen' : 'Remove'} aria-label={de ? 'Entfernen' : 'Remove'} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, lineHeight: 0 }}>
                <IconTrash size={15} />
              </button>
            </div>
          ))}
        </div>
        {devices.length < MAX_DEVICES ? (
          <button type="button" onClick={add} style={{ ...inp, marginTop: 8, width: 'auto', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)' }}>
            <IconPlus size={15} /> {de ? 'Gerät hinzufügen' : 'Add device'}
          </button>
        ) : null}
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Passwort (nur wenn Geräte-Auth aktiv)' : 'Password (only if device auth enabled)'}</label>
        <input style={inp} type="password" value={str(cfg.password)} placeholder={de ? 'leer lassen, wenn keine Auth' : 'leave empty if no auth'} onChange={(e) => onChange('password', e.target.value)} />
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
          {de
            ? 'Benutzer ist bei Shelly immer „admin". Das Passwort wird verschlüsselt gespeichert.'
            : 'The Shelly user is always “admin”. The password is stored encrypted.'}
        </p>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={track} onChange={(e) => onChange('trackHistory', e.target.checked)} />
        {de ? 'Verlauf speichern (kWh heute / 7 Tage / 30 Tage)' : 'Store history (kWh today / 7d / 30d)'}
      </label>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Aktualisieren (Sek.)' : 'Refresh (sec.)'}</label>
        <input style={inp} type="number" min={5} max={300} value={clampRefresh(cfg.refreshSeconds)} onChange={(e) => onChange('refreshSeconds', clampRefresh(e.target.value))} />
      </div>

      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {de
          ? 'Der Server spricht das Gerät direkt im LAN an (lokale RPC-API, keine Cloud). Dafür muss am Container SELFDASHBOARD_ALLOW_PRIVATE_URLS=1 gesetzt sein.'
          : 'The server talks to the device directly on the LAN (local RPC API, no cloud). This requires SELFDASHBOARD_ALLOW_PRIVATE_URLS=1 on the container.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meta + exports
// ---------------------------------------------------------------------------

export const meta: PluginMeta = {
  id: 'shelly-3em',
  name: 'Shelly 3EM',
  description:
    'Shelly Pro 3EM / 3EM: 3-Phasen-Hausmessung über die lokale RPC-API. Live-Leistung je Phase, Gesamtleistung mit Bezug/Einspeisung und optionaler kWh-Verlauf (heute / 7 Tage / 30 Tage). Ohne Cloud, ohne API-Key.',
  author: 'SelfDashboard',
  category: 'system',
  icon: '⚡',
  iconUrl: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/shelly.png',
  version: '1.0.0',
  defaultLayout: { w: 4, h: 4, minW: 3, minH: 3 },
  configSchema: [
    { key: 'devices', label: 'Geräte', type: 'text', defaultValue: '[]' },
    { key: 'password', label: 'Passwort', type: 'password', defaultValue: '' },
    { key: 'trackHistory', label: 'Verlauf speichern', type: 'boolean', defaultValue: true },
    { key: 'showTitle', label: 'Titel anzeigen', type: 'boolean', defaultValue: true },
    { key: 'title', label: 'Widget-Titel', type: 'text', defaultValue: 'Shelly 3EM' },
    { key: 'refreshSeconds', label: 'Aktualisieren (Sek.)', type: 'number', defaultValue: 10 },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
