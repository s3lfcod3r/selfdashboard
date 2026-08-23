'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

// ---------------------------------------------------------------------------
// Types — mirror the normalized shape from server.ts.
// ---------------------------------------------------------------------------

/** `password` is optional and per-device; empty means "use the shared one". */
type Device = { id: string; name: string; ip: string; password?: string }

/** `month` is the calendar month (resets on the 1st), not a rolling 30 days. */
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

/**
 * Poll interval in seconds, 0–300. **0 means off**: the widget still loads once
 * when it appears, it just stops polling afterwards. Anything between 1 and 9 is
 * allowed too — it hits the device hard, but that is the operator's call.
 */
function clampRefresh(v: unknown): number {
  return Math.min(300, Math.max(0, Math.round(num(v, 10))))
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
      const dev: Device = { id: str(o.id) || newId(), name: str(o.name), ip: str(o.ip) }
      // Kept verbatim, not trimmed: a password may start or end with a space.
      if (typeof o.password === 'string' && o.password) dev.password = o.password
      return dev
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

/**
 * Short name of the current month ("Aug", "Sep") as the label for the calendar
 * month figure. Naming the month says "this resets on the 1st" without needing
 * a caption, and stays narrow enough for a small tile.
 */
function monthLabel(de: boolean): string {
  return new Date().toLocaleDateString(de ? 'de-DE' : 'en-GB', { month: 'short' })
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
  // Entries without an IP are half-finished rows from Settings — skip them here
  // instead of showing a permanently unreachable plug.
  const devices = useMemo(() => parseDevices(cfg.devices).filter((d) => d.ip), [cfg.devices])
  const password = str(cfg.password)
  const track = cfg.trackHistory !== false
  const allowSwitch = cfg.allowSwitch !== false
  const refreshSec = clampRefresh(cfg.refreshSeconds)
  const showTitle = cfg.showTitle !== false
  const title = cfg.title === undefined ? 'Shelly Plug' : str(cfg.title)
  const canEdit = Boolean(instanceId)
  // 'compact' is the default: a dense line per plug, so several fit a small
  // tile. 'detail' is the older card layout with sparkline and today/month.
  const compact = str(cfg.layout || 'compact') !== 'detail'

  const confirmSwitch = cfg.confirmSwitch !== false
  const [results, setResults] = useState<DeviceResult[] | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [confirming, setConfirming] = useState<Record<string, boolean>>({})
  const [powerHist, setPowerHist] = useState<Record<string, number[]>>({})
  const busyRef = useRef(false)
  const { ref: shellRef, active } = usePollingActive<HTMLDivElement>()

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
        // Keep a short rolling buffer of live power per device for the sparkline.
        setPowerHist((prev) => {
          const next = { ...prev }
          for (const r of data) {
            if (r.online && typeof r.power === 'number') {
              next[r.id] = (next[r.id] ?? []).concat(Math.max(0, r.power)).slice(-40)
            }
          }
          return next
        })
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
    // 0 = off: load once, then leave it alone. setInterval(…, 0) would spin.
    if (refreshSec <= 0) return () => ac.abort()
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

  // Turning ON is harmless → immediate. Turning OFF asks for confirmation first
  // (so a stray tap can't kill e.g. the PC), unless the user disabled it.
  const requestToggle = useCallback(
    (device: Device, current: boolean) => {
      if (current && confirmSwitch) setConfirming((c) => ({ ...c, [device.id]: true }))
      else void toggle(device, current)
    },
    [confirmSwitch, toggle],
  )
  const confirmOff = useCallback(
    (device: Device) => {
      setConfirming((c) => ({ ...c, [device.id]: false }))
      void toggle(device, true)
    },
    [toggle],
  )
  const cancelOff = useCallback((device: Device) => {
    setConfirming((c) => ({ ...c, [device.id]: false }))
  }, [])

  const shell: CSSProperties = {
    height: '100%',
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    boxSizing: 'border-box',
    padding: compact ? '6px 9px 7px' : '12px 14px',
    containerType: 'size',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: compact ? 4 : 8,
  }

  if (devices.length === 0) {
    return (
      <div ref={shellRef} style={{ ...shell, alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
        <IconPlug size={30} color="var(--text-muted)" />
        {canEdit ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45, maxWidth: 320 }}>
            {de
              ? 'Noch keine Steckdose. Über das Zahnrad in den Einstellungen hinzufügen (Name + IP).'
              : 'No plug yet. Add one in settings via the gear icon (name + IP).'}
          </p>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
            {de ? 'Noch keine Steckdose. In den Einstellungen hinzufügen.' : 'No plug yet. Add one in settings.'}
          </p>
        )}
      </div>
    )
  }

  const byId = new Map((results ?? []).map((r) => [r.id, r]))

  // With the kWh column a cell needs more room, so ask for wider columns when
  // history is on. That alone keeps the row readable: auto-fit only opens a
  // second column once every cell clears COL_MIN, so the kWh figure is shown
  // unconditionally — it must not vanish just because the tile got narrower
  // (browser zoom does exactly that). If a single column ends up below COL_MIN,
  // the NAME truncates with an ellipsis; the numbers stay.
  const COL_MIN = track ? 230 : 165

  return (
    <div ref={shellRef} style={shell}>
      {showTitle && title ? (
        <p style={{ margin: 0, fontSize: compact ? 'clamp(8px, 2.2cqmin, 9px)' : 'clamp(9px, 2.4cqmin, 10px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', flexShrink: 0, lineHeight: 1.2 }}>
          {title}
        </p>
      ) : null}

      {compact ? (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            width: '100%',
            minWidth: 0,
            minHeight: 0,
            flex: 1,
            overflowY: 'auto',
            // Never scroll sideways: a too-narrow row must clip the name, not
            // push the watt value out of the tile.
            overflowX: 'hidden',
            // Reserve the scrollbar gutter — without it the bar sits on top of
            // the right-aligned watt value as soon as the list needs scrolling.
            scrollbarGutter: 'stable',
            display: 'grid',
            // Two columns as soon as the tile is wide enough, but only once
            // there are enough plugs for a second column to look deliberate.
            // min(COL_MIN, 100%) matters: a bare minmax(COL_MIN, 1fr) keeps the
            // column at COL_MIN even in a narrower tile, and the row overflows.
            gridTemplateColumns:
              devices.length >= 4 ? `repeat(auto-fit, minmax(min(${COL_MIN}px, 100%), 1fr))` : '1fr',
            alignContent: 'start',
            columnGap: 14,
            rowGap: 2,
          }}
        >
          {devices.map((d) => (
            <CompactRow
              key={d.id}
              device={d}
              result={byId.get(d.id)}
              de={de}
              showMonth={track}
              allowSwitch={allowSwitch}
              pending={Boolean(pending[d.id])}
              confirming={Boolean(confirming[d.id])}
              onToggle={requestToggle}
              onConfirm={confirmOff}
              onCancel={cancelOff}
            />
          ))}
        </ul>
      ) : (
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
              confirming={Boolean(confirming[d.id])}
              history={powerHist[d.id]}
              onToggle={requestToggle}
              onConfirm={confirmOff}
              onCancel={cancelOff}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Very short status for the compact row, where a full sentence will not fit. */
function shortError(code: string | undefined, de: boolean): string {
  switch (code) {
    case 'auth_failed':
      return de ? 'Login' : 'Auth'
    case 'blocked_url':
      return 'SSRF'
    case 'timeout':
      return de ? 'Timeout' : 'Timeout'
    default:
      return de ? 'Weg' : 'Down'
  }
}

/**
 * One line per plug: status dot, name, live watts (+ month kWh) — the dense
 * list layout, modelled on the Uptime Kuma widget so a handful of plugs fit in
 * a small tile. The dot doubles as the on/off button; there is no room for a
 * real toggle at this size.
 */
function CompactRow({
  device,
  result,
  de,
  showMonth,
  allowSwitch,
  pending,
  confirming,
  onToggle,
  onConfirm,
  onCancel,
}: {
  device: Device
  result: DeviceResult | undefined
  de: boolean
  /** Show the month kWh next to the watts (follows the history setting). */
  showMonth: boolean
  allowSwitch: boolean
  pending: boolean
  confirming: boolean
  onToggle: (d: Device, current: boolean) => void
  onConfirm: (d: Device) => void
  onCancel: (d: Device) => void
}) {
  const loading = result === undefined
  const offline = result != null && !result.online
  const on = result?.output === true
  const name = device.name || device.ip
  const color = offline ? '#ef4444' : loading ? 'var(--text-muted)' : on ? '#22c55e' : 'var(--text-muted)'

  const value = loading
    ? '…'
    : offline
      ? shortError(result?.error, de)
      : on
        ? fmtPower(result?.power ?? 0, de)
        : de
          ? 'Aus'
          : 'Off'

  const monthKwh = result?.energy ? fmtKwh(result.energy.month, de) : null
  const month = showMonth ? monthKwh : null
  const canSwitch = allowSwitch && !offline && !loading && result?.output != null
  // The tooltip always carries the month, even when the column is hidden.
  const title = offline
    ? `${name} · ${errorText(result?.error, de)}`
    : `${name} · ${value}${monthKwh ? ` · ${monthLabel(de)} ${monthKwh}` : ''}`

  const dotStyle: CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
    padding: 0,
    border: 'none',
    opacity: pending ? 0.45 : 1,
    transition: 'opacity 150ms ease',
  }

  return (
    <li title={title} style={{ listStyle: 'none', margin: 0, padding: 0, minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          minWidth: 0,
          // Sized off the container WIDTH, not cqmin: a wide-but-flat tile is
          // the normal shape here, and cqmin would shrink the text to nothing.
          fontSize: 'clamp(11px, 3.4cqw, 13px)',
          lineHeight: 1.15,
          minHeight: 19,
        }}
      >
        {canSwitch ? (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            disabled={pending}
            onClick={() => onToggle(device, on)}
            aria-label={on ? (de ? `${name} ausschalten` : `Turn ${name} off`) : de ? `${name} einschalten` : `Turn ${name} on`}
            style={{ ...dotStyle, cursor: pending ? 'not-allowed' : 'pointer' }}
          />
        ) : (
          <span aria-hidden style={dotStyle} />
        )}

        <span
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--text)',
            fontWeight: 600,
          }}
        >
          {name}
        </span>

        {confirming ? (
          <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => onConfirm(device)}
              title={de ? 'Ausschalten' : 'Turn off'}
              style={{ border: 'none', borderRadius: 4, padding: '1px 6px', background: '#ef4444', color: '#fff', fontWeight: 700, fontSize: '0.82em', cursor: 'pointer', lineHeight: 1.3 }}
            >
              {de ? 'Aus' : 'Off'}
            </button>
            <button
              type="button"
              onClick={() => onCancel(device)}
              title={de ? 'Abbrechen' : 'Cancel'}
              style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.82em', cursor: 'pointer', lineHeight: 1.3 }}
            >
              ✕
            </button>
          </span>
        ) : (
          <>
            {month ? (
              <span
                style={{
                  // Fixed, right-aligned column so the kWh figures line up
                  // instead of drifting with each name length.
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  minWidth: '3.9em',
                  textAlign: 'right',
                  fontSize: '0.78em',
                  opacity: 0.75,
                }}
              >
                {month}
              </span>
            ) : null}
            <span
              style={{
                fontVariantNumeric: 'tabular-nums',
                color,
                whiteSpace: 'nowrap',
                flexShrink: 0,
                fontWeight: 700,
                fontSize: '0.86em',
                minWidth: '3.1em',
                textAlign: 'right',
              }}
            >
              {value}
            </span>
          </>
        )}
      </div>
    </li>
  )
}

function PlugRow({
  device,
  result,
  de,
  showHistory,
  allowSwitch,
  pending,
  confirming,
  history,
  onToggle,
  onConfirm,
  onCancel,
}: {
  device: Device
  result: DeviceResult | undefined
  de: boolean
  showHistory: boolean
  allowSwitch: boolean
  pending: boolean
  confirming: boolean
  history?: number[]
  onToggle: (d: Device, current: boolean) => void
  onConfirm: (d: Device) => void
  onCancel: (d: Device) => void
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
        {allowSwitch && !offline && !loading && !confirming ? (
          <Toggle on={on} pending={pending} disabled={result?.output == null} onClick={() => onToggle(device, on)} de={de} />
        ) : null}
      </div>

      {confirming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
          <span style={{ fontSize: 'clamp(10px, 2.6cqmin, 12px)', fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0 }}>
            {de ? `„${name}" ausschalten?` : `Turn “${name}” off?`}
          </span>
          <button
            type="button"
            onClick={() => onConfirm(device)}
            style={{ border: 'none', borderRadius: 7, padding: '5px 12px', background: '#ef4444', color: '#fff', fontWeight: 700, fontSize: 'clamp(10px, 2.6cqmin, 12px)', cursor: 'pointer' }}
          >
            {de ? 'Aus' : 'Off'}
          </button>
          <button
            type="button"
            onClick={() => onCancel(device)}
            style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '5px 12px', background: 'transparent', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'clamp(10px, 2.6cqmin, 12px)', cursor: 'pointer' }}
          >
            {de ? 'Abbrechen' : 'Cancel'}
          </button>
        </div>
      ) : null}

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

          {on && history && history.length >= 2 ? <Sparkline values={history} de={de} /> : null}

          {showHistory && result?.energy ? (
            <div style={{ display: 'flex', gap: 12, marginTop: 1 }}>
              <EnergyStat label={de ? 'Heute' : 'Today'} value={result.energy.today} de={de} />
              <EnergyStat label={monthLabel(de)} value={result.energy.month} de={de} />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

/** Live power sparkline from a rolling buffer, with a hover tooltip that reads
 * out the power at the point under the mouse. */
function Sparkline({ values, de }: { values: number[]; de: boolean }) {
  const w = 100
  const h = 30
  const top = 4
  const bottom = h - 3
  const RH = 34 // rendered pixel height
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  // Scale to the actual range with headroom so a near-constant load still shows
  // its wobble instead of being pinned to the top over a big empty area.
  const pad = Math.max((rawMax - rawMin) * 0.35, rawMax * 0.06, 1)
  const min = rawMin - pad
  const max = rawMax + pad
  const range = max - min || 1
  const n = values.length

  const [hover, setHover] = useState<number | null>(null)

  const yFor = (v: number) => bottom - ((v - min) / range) * (bottom - top)
  const xFor = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * w)

  // Smooth the line through segment midpoints (quadratic) for a nicer curve.
  let line = `M ${xFor(0).toFixed(1)} ${yFor(values[0]).toFixed(1)}`
  for (let i = 1; i < n; i++) {
    const x0 = xFor(i - 1)
    const y0 = yFor(values[i - 1])
    const x1 = xFor(i)
    const y1 = yFor(values[i])
    line += ` Q ${x0.toFixed(1)} ${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}`
  }
  line += ` L ${xFor(n - 1).toFixed(1)} ${yFor(values[n - 1]).toFixed(1)}`

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const frac = (e.clientX - rect.left) / rect.width
    setHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))))
  }

  const hv = hover != null ? values[hover] : null
  const hx = hover != null ? xFor(hover) : 0
  const hyPx = hover != null ? (yFor(values[hover]) / h) * RH : 0

  return (
    <div
      style={{ position: 'relative', width: '100%', height: RH, marginTop: 2, cursor: 'crosshair' }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={RH} style={{ display: 'block' }} aria-hidden>
        <defs>
          <linearGradient id="shellyPlugSpark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill="url(#shellyPlugSpark)" stroke="none" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>

      {hover != null && hv != null ? (
        <>
          <div style={{ position: 'absolute', left: `${hx}%`, top: 0, bottom: 0, width: 1, background: 'var(--accent)', opacity: 0.5, transform: 'translateX(-0.5px)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: `${hx}%`, top: hyPx, width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 2px var(--surface)', pointerEvents: 'none' }} />
          <div
            style={{
              position: 'absolute',
              left: `${Math.max(8, Math.min(92, hx))}%`,
              top: -3,
              transform: 'translate(-50%, -100%)',
              background: 'var(--text)',
              color: 'var(--surface)',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 5,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {fmtPower(hv, de)}
          </div>
        </>
      ) : null}
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
  const layout = str(cfg.layout || 'compact') === 'detail' ? 'detail' : 'compact'

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
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Ansicht' : 'Layout'}</label>
        <select style={inp} value={layout} onChange={(e) => onChange('layout', e.target.value)}>
          <option value="compact">{de ? 'Kompakt — eine Zeile je Steckdose' : 'Compact — one line per plug'}</option>
          <option value="detail">{de ? 'Detail — Karte mit Verlauf, heute und Monat' : 'Detail — card with sparkline, today and month'}</option>
        </select>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
          {de
            ? 'Kompakt zeigt Punkt, Name und Watt nebeneinander und legt ab vier Steckdosen zwei Spalten an, sobald die Kachel breit genug ist. Der Punkt schaltet.'
            : 'Compact shows dot, name and watts on one line, in two columns from four plugs up once the tile is wide enough. The dot is the on/off button.'}
        </p>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Steckdosen' : 'Plugs'}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {devices.map((d) => (
            <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input style={{ ...inp, flex: 1 }} value={d.name} placeholder={de ? 'Name' : 'Name'} onChange={(e) => update(d.id, { name: e.target.value })} />
                <input style={{ ...inp, flex: 1 }} value={d.ip} placeholder={de ? 'IP / Host' : 'IP / host'} onChange={(e) => update(d.id, { ip: e.target.value })} />
                <button type="button" onClick={() => remove(d.id)} title={de ? 'Entfernen' : 'Remove'} aria-label={de ? 'Entfernen' : 'Remove'} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, lineHeight: 0 }}>
                  <IconTrash size={15} />
                </button>
              </div>
              <input
                style={{ ...inp, fontSize: 11.5, marginRight: 27 }}
                type="password"
                autoComplete="new-password"
                value={d.password ?? ''}
                placeholder={de ? 'eigenes Passwort (leer = gemeinsames unten)' : 'own password (empty = shared one below)'}
                onChange={(e) => update(d.id, { password: e.target.value })}
              />
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
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Gemeinsames Passwort (nur wenn Geräte-Auth aktiv)' : 'Shared password (only if device auth enabled)'}</label>
        <input style={inp} type="password" autoComplete="new-password" value={str(cfg.password)} placeholder={de ? 'leer lassen, wenn keine Auth' : 'leave empty if no auth'} onChange={(e) => onChange('password', e.target.value)} />
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
          {de
            ? 'Gilt für alle Steckdosen ohne eigenes Passwort. Benutzer ist bei Shelly immer „admin". Hinweis: in der Dashboard-Konfiguration derzeit unverschlüsselt abgelegt, nur für angemeldete Nutzer zugänglich.'
            : 'Applies to every plug without its own password. The Shelly user is always “admin”. Note: currently kept unencrypted in the dashboard config, accessible to logged-in users only.'}
        </p>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={allowSwitch} onChange={(e) => onChange('allowSwitch', e.target.checked)} />
        {de ? 'Schalten erlauben (An/Aus-Schalter anzeigen)' : 'Allow switching (show on/off toggle)'}
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', opacity: allowSwitch ? 1 : 0.5 }}>
        <input type="checkbox" disabled={!allowSwitch} checked={cfg.confirmSwitch !== false} onChange={(e) => onChange('confirmSwitch', e.target.checked)} />
        {de ? 'Vor dem Ausschalten nachfragen' : 'Confirm before turning off'}
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={track} onChange={(e) => onChange('trackHistory', e.target.checked)} />
        {de ? 'Verlauf speichern (kWh heute / laufender Monat)' : 'Store history (kWh today / current month)'}
      </label>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Aktualisieren (Sek.)' : 'Refresh (sec.)'}</label>
        <input style={inp} type="number" min={0} max={300} step={1} value={clampRefresh(cfg.refreshSeconds)} onChange={(e) => onChange('refreshSeconds', clampRefresh(e.target.value))} />
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
          {de
            ? '0 bis 300. Bei 0 wird nur einmal beim Öffnen geladen und danach nicht mehr automatisch. Kleine Werte fragen das Gerät häufig ab.'
            : '0 to 300. At 0 the widget loads once when it opens and then stops polling. Small values query the device often.'}
        </p>
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
    'Shelly Plug PM Gen3 / Plug S Gen3 (und andere Gen2+ Steckdosen): mehrere Steckdosen in einer Kachel — kompakte Zeilenansicht mit Statuspunkt, Name und Momentanleistung, optional mehrspaltig. Umschaltbar auf Detailkarten mit Verlauf. kWh heute / laufender Monat, Passwort je Steckdose, An/Aus-Schalten. Ohne Cloud, ohne API-Key.',
  author: 'SelfDashboard',
  category: 'system',
  icon: '🔌',
  iconUrl: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/shelly.png',
  version: '1.4.1',
  defaultLayout: { w: 3, h: 4, minW: 2, minH: 2 },
  configSchema: [
    { key: 'devices', label: 'Steckdosen', type: 'text', defaultValue: '[]' },
    {
      key: 'layout',
      label: 'Ansicht',
      type: 'select',
      defaultValue: 'compact',
      options: [
        { value: 'compact', label: 'Kompakt (eine Zeile je Steckdose)' },
        { value: 'detail', label: 'Detail (Karte mit Verlauf)' },
      ],
    },
    { key: 'password', label: 'Passwort', type: 'password', defaultValue: '' },
    { key: 'allowSwitch', label: 'Schalten erlauben', type: 'boolean', defaultValue: true },
    { key: 'confirmSwitch', label: 'Ausschalten bestätigen', type: 'boolean', defaultValue: true },
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
