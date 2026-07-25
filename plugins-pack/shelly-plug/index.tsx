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

type EnergyReading = { today: number; week: number; month: number }

type DeviceResult = {
  id: string
  name: string
  online: boolean
  output: boolean | null
  power: number | null
  voltage: number | null
  current: number | null
  tempC: number | null
  energy?: EnergyReading
  error?: string
}

const MAX_DEVICES = 16

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

function fmtPower(w: number, de: boolean): string {
  const abs = Math.abs(w)
  if (abs >= 1000) {
    return `${(abs / 1000).toLocaleString(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: 2 })} kW`
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
// Inline SVG icons
// ---------------------------------------------------------------------------

type IconProps = { size?: number; color?: string }

function IconPlug({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
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

function IconThermo({ size = 12, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// On/off toggle — designed states (not a bare checkbox).
// ---------------------------------------------------------------------------

function Toggle({ on, pending, disabled, onClick, de }: { on: boolean; pending: boolean; disabled: boolean; onClick: () => void; de: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled || pending}
      onClick={onClick}
      title={on ? (de ? 'Ausschalten' : 'Turn off') : de ? 'Einschalten' : 'Turn on'}
      style={{
        position: 'relative',
        width: 40,
        height: 22,
        flexShrink: 0,
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: on ? 'var(--accent)' : 'var(--section, var(--bg))',
        cursor: disabled || pending ? 'not-allowed' : 'pointer',
        opacity: pending ? 0.6 : 1,
        transition: 'background 150ms ease',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 150ms ease',
          boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function fetchStatus(devices: Device[], password: string, track: boolean, signal: AbortSignal): Promise<DeviceResult[] | null> {
  try {
    const res = await fetch('/api/plugins/shelly-plug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', devices, password, track }),
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

async function sendSwitch(device: Device, on: boolean, password: string): Promise<boolean> {
  try {
    const res = await fetch('/api/plugins/shelly-plug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'switch', device, on, password }),
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

function Widget({ config, instanceId }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const cfg = config as Record<string, unknown>
  const updatePluginConfig = useDashboardStore((s) => s.updatePluginConfig)

  const allDevices = useMemo(() => parseDevices(cfg.devices), [cfg.devices])
  const devices = useMemo(() => allDevices.filter((d) => d.ip), [allDevices])
  const password = str(cfg.password)
  const track = cfg.trackHistory !== false
  const allowSwitch = cfg.allowSwitch !== false
  const refreshSec = clampRefresh(cfg.refreshSeconds)
  const showTitle = cfg.showTitle !== false
  const title = cfg.title === undefined ? 'Shelly Plug' : str(cfg.title)
  const canEdit = Boolean(instanceId)

  const [results, setResults] = useState<DeviceResult[] | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, password, track, refreshSec, active])

  const toggle = useCallback(
    async (device: Device, current: boolean) => {
      setPending((p) => ({ ...p, [device.id]: true }))
      // Optimistic flip so the switch reacts immediately.
      setResults((prev) => prev?.map((r) => (r.id === device.id ? { ...r, output: !current } : r)) ?? prev)
      const ok = await sendSwitch(device, !current, password)
      if (!ok) {
        // Roll back on failure.
        setResults((prev) => prev?.map((r) => (r.id === device.id ? { ...r, output: current } : r)) ?? prev)
      }
      setPending((p) => ({ ...p, [device.id]: false }))
      const ac = new AbortController()
      void refresh(ac.signal)
    },
    [password, refresh],
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

  if (devices.length === 0) {
    return (
      <div ref={shellRef} style={{ ...shell, alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
        <IconPlug size={30} color="var(--text-muted)" />
        {canEdit ? (
          <div style={{ width: '100%', maxWidth: 320 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.45 }}>
              {de ? 'Shelly Plug hinzufügen (Name + IP):' : 'Add a Shelly Plug (name + IP):'}
            </p>
            <AddForm onAdd={addDevice} de={de} />
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
            {de ? 'Noch keine Steckdose. In den Einstellungen hinzufügen.' : 'No plug yet. Add one in settings.'}
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {devices.map((d) => (
          <PlugRow
            key={d.id}
            device={d}
            result={byId.get(d.id)}
            de={de}
            showHistory={track}
            allowSwitch={allowSwitch}
            pending={Boolean(pending[d.id])}
            onToggle={toggle}
          />
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

function PlugRow({
  device,
  result,
  de,
  showHistory,
  allowSwitch,
  pending,
  onToggle,
}: {
  device: Device
  result: DeviceResult | undefined
  de: boolean
  showHistory: boolean
  allowSwitch: boolean
  pending: boolean
  onToggle: (d: Device, current: boolean) => void
}) {
  const loading = result === undefined
  const offline = result != null && !result.online
  const on = result?.output === true
  const name = device.name || device.ip
  const accent = offline ? 'var(--text-muted)' : on ? 'var(--accent)' : 'var(--border)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 11px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${accent}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: offline ? 'var(--text-muted)' : '#22c55e' }} />
        <span style={{ fontSize: 'clamp(11px, 3cqmin, 13px)', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }} title={name}>
          {name}
        </span>
        {allowSwitch && !offline && !loading ? (
          <Toggle on={on} pending={pending} disabled={result?.output == null} onClick={() => onToggle(device, on)} de={de} />
        ) : null}
      </div>

      {loading ? (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{de ? 'Wird geladen…' : 'Loading…'}</span>
      ) : offline ? (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{errorText(result?.error, de)}</span>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
            <span style={{ fontSize: 'clamp(17px, 5.5cqmin, 24px)', fontWeight: 800, color: on ? 'var(--text)' : 'var(--text-muted)', lineHeight: 1 }}>
              {result?.power != null ? fmtPower(result.power, de) : '—'}
            </span>
            {!on ? <span style={{ fontSize: 'clamp(9px, 2.4cqmin, 11px)', fontWeight: 600, color: 'var(--text-muted)' }}>{de ? 'aus' : 'off'}</span> : null}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {result?.voltage != null ? (
              <span style={{ fontSize: 'clamp(9px, 2.2cqmin, 10.5px)', color: 'var(--text-muted)' }}>{Math.round(result.voltage)} V</span>
            ) : null}
            {result?.current != null ? (
              <span style={{ fontSize: 'clamp(9px, 2.2cqmin, 10.5px)', color: 'var(--text-muted)' }}>
                {result.current.toLocaleString(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: 2 })} A
              </span>
            ) : null}
            {result?.tempC != null ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'clamp(9px, 2.2cqmin, 10.5px)', color: 'var(--text-muted)' }}>
                <IconThermo size={11} /> {Math.round(result.tempC)}°C
              </span>
            ) : null}
          </div>

          {showHistory && result?.energy ? (
            <div style={{ display: 'flex', gap: 12, marginTop: 1 }}>
              <EnergyStat label={de ? 'Heute' : 'Today'} value={result.energy.today} de={de} />
              <EnergyStat label={de ? '30 Tage' : '30 days'} value={result.energy.month} de={de} />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function EnergyStat({ label, value, de }: { label: string; value: number; de: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 'clamp(8px, 2cqmin, 9.5px)', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 'clamp(10px, 2.6cqmin, 12px)', fontWeight: 700, color: 'var(--text)' }}>{fmtKwh(value, de)}</span>
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
  const allowSwitch = cfg.allowSwitch !== false

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
        <input style={{ ...inp, opacity: showTitle ? 1 : 0.5 }} disabled={!showTitle} value={cfg.title === undefined ? 'Shelly Plug' : str(cfg.title)} placeholder="Shelly Plug" onChange={(e) => onChange('title', e.target.value)} />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Steckdosen' : 'Plugs'}</label>
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
            <IconPlus size={15} /> {de ? 'Steckdose hinzufügen' : 'Add plug'}
          </button>
        ) : null}
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Passwort (nur wenn Geräte-Auth aktiv)' : 'Password (only if device auth enabled)'}</label>
        <input style={inp} type="password" value={str(cfg.password)} placeholder={de ? 'leer lassen, wenn keine Auth' : 'leave empty if no auth'} onChange={(e) => onChange('password', e.target.value)} />
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
          {de ? 'Benutzer ist bei Shelly immer „admin". Das Passwort wird verschlüsselt gespeichert.' : 'The Shelly user is always “admin”. The password is stored encrypted.'}
        </p>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={allowSwitch} onChange={(e) => onChange('allowSwitch', e.target.checked)} />
        {de ? 'Schalten erlauben (An/Aus-Schalter anzeigen)' : 'Allow switching (show on/off toggle)'}
      </label>

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
          ? 'Der Server spricht das Gerät direkt im LAN an (lokale RPC-API, keine Cloud). Dafür muss am Container SELFDASHBOARD_ALLOW_PRIVATE_URLS=1 gesetzt sein. Schalten ist nur für angemeldete Dashboard-Nutzer möglich.'
          : 'The server talks to the device directly on the LAN (local RPC API, no cloud). This requires SELFDASHBOARD_ALLOW_PRIVATE_URLS=1 on the container. Switching is only available to logged-in dashboard users.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meta + exports
// ---------------------------------------------------------------------------

export const meta: PluginMeta = {
  id: 'shelly-plug',
  name: 'Shelly Plug',
  description:
    'Shelly Plug PM Gen3 / Plug S Gen3 (und andere Gen2+ Steckdosen): Momentanleistung, Spannung/Strom, Temperatur und An/Aus-Schalten direkt vom Dashboard. Optionaler kWh-Verlauf. Ohne Cloud, ohne API-Key.',
  author: 'SelfDashboard',
  category: 'system',
  icon: '🔌',
  iconUrl: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/shelly.png',
  version: '1.0.0',
  defaultLayout: { w: 3, h: 4, minW: 2, minH: 2 },
  configSchema: [
    { key: 'devices', label: 'Steckdosen', type: 'text', defaultValue: '[]' },
    { key: 'password', label: 'Passwort', type: 'password', defaultValue: '' },
    { key: 'allowSwitch', label: 'Schalten erlauben', type: 'boolean', defaultValue: true },
    { key: 'trackHistory', label: 'Verlauf speichern', type: 'boolean', defaultValue: true },
    { key: 'showTitle', label: 'Titel anzeigen', type: 'boolean', defaultValue: true },
    { key: 'title', label: 'Widget-Titel', type: 'text', defaultValue: 'Shelly Plug' },
    { key: 'refreshSeconds', label: 'Aktualisieren (Sek.)', type: 'number', defaultValue: 10 },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
