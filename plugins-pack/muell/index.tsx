'use client'

import { useCallback, useMemo, type CSSProperties } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Interval = 'weekly' | 'biweekly' | 'monthly4' // weekly / every 2 weeks / every 4 weeks

type Bin = {
  id: string
  name: string
  color: string
  interval: Interval
  /** weekly: 0=Sun … 6=Sat (JS getDay). */
  weekday: number
  /** biweekly/monthly4: a known collection date "YYYY-MM-DD" (defines weekday + phase). */
  refDate: string
}

const MAX_BINS = 8
const DAY_MS = 24 * 60 * 60 * 1000

// German bin presets (name + real bin colour). Users can rename/recolour freely.
const PRESETS: { key: string; de: string; en: string; color: string }[] = [
  { key: 'rest', de: 'Restmüll', en: 'General waste', color: '#4b5563' },
  { key: 'bio', de: 'Biotonne', en: 'Bio / organic', color: '#92400e' },
  { key: 'gelb', de: 'Gelber Sack', en: 'Recycling (yellow)', color: '#eab308' },
  { key: 'papier', de: 'Papier', en: 'Paper', color: '#2563eb' },
  { key: 'glas', de: 'Glas', en: 'Glass', color: '#15803d' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `b_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

function isInterval(v: unknown): v is Interval {
  return v === 'weekly' || v === 'biweekly' || v === 'monthly4'
}

function parseBins(raw: unknown): Bin[] {
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
    .slice(0, MAX_BINS)
    .map((b): Bin | null => {
      if (typeof b !== 'object' || b === null) return null
      const o = b as Record<string, unknown>
      const wd = Number(o.weekday)
      return {
        id: str(o.id) || newId(),
        name: str(o.name),
        color: /^#[0-9a-fA-F]{3,8}$/.test(str(o.color)) ? str(o.color) : '#4b5563',
        interval: isInterval(o.interval) ? o.interval : 'weekly',
        weekday: Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : 1,
        refDate: /^\d{4}-\d{2}-\d{2}$/.test(str(o.refDate)) ? str(o.refDate) : '',
      }
    })
    .filter((b): b is Bin => b !== null)
}

function midnight(d: Date): number {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c.getTime()
}

/** Parse "YYYY-MM-DD" as a LOCAL date (avoid UTC shift of new Date(str)). */
function parseLocalDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(d.getTime()) ? midnight(d) : null
}

/** Next collection at midnight (epoch ms) on/after today, or null if unset. */
function nextPickup(bin: Bin, todayMs: number): number | null {
  const t = midnight(new Date(todayMs))
  if (bin.interval === 'weekly') {
    const base = new Date(t)
    const delta = (bin.weekday - base.getDay() + 7) % 7
    return t + delta * DAY_MS
  }
  const anchor = parseLocalDate(bin.refDate)
  if (anchor == null) return null
  const intervalMs = (bin.interval === 'biweekly' ? 14 : 28) * DAY_MS
  const n = Math.ceil((t - anchor) / intervalMs)
  let cand = anchor + n * intervalMs
  if (cand < t) cand += intervalMs
  return cand
}

function daysUntil(dateMs: number, todayMs: number): number {
  return Math.round((midnight(new Date(dateMs)) - midnight(new Date(todayMs))) / DAY_MS)
}

const WD_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtDate(dateMs: number, de: boolean): string {
  const d = new Date(dateMs)
  const wd = (de ? WD_DE : WD_EN)[d.getDay()]
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return de ? `${wd}, ${dd}.${mm}.` : `${wd}, ${dd}/${mm}`
}

function untilLabel(days: number, de: boolean): string {
  if (days <= 0) return de ? 'Heute' : 'Today'
  if (days === 1) return de ? 'Morgen' : 'Tomorrow'
  return de ? `in ${days} Tagen` : `in ${days} days`
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

type IconProps = { size?: number; color?: string }

function IconTrashBin({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
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

function IconAlarm({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2" />
      <path d="M5 3 2 6" />
      <path d="m22 6-3-3" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

type Computed = { bin: Bin; date: number | null; days: number | null }

function Widget({ config }: PluginWidgetProps) {
  const { de } = usePluginLocale()
  const cfg = config as Record<string, unknown>
  const bins = useMemo(() => parseBins(cfg.bins), [cfg.bins])
  const showTitle = cfg.showTitle !== false
  const title = cfg.title === undefined ? (de ? 'Müllabfuhr' : 'Waste collection') : str(cfg.title)

  // Recompute against the current day. Date is read at render — the dashboard
  // re-renders often enough, and the value only matters at day granularity.
  const now = Date.now()
  const computed: Computed[] = useMemo(() => {
    return bins
      .map((bin) => {
        const date = nextPickup(bin, now)
        return { bin, date, days: date == null ? null : daysUntil(date, now) }
      })
      .sort((a, b) => {
        if (a.date == null) return 1
        if (b.date == null) return -1
        return a.date - b.date
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bins, Math.floor(now / DAY_MS)])

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

  if (bins.length === 0) {
    return (
      <div style={{ ...shell, alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
        <IconTrashBin size={30} color="var(--text-muted)" />
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
          {de ? 'Noch keine Tonne. In den Einstellungen hinzufügen.' : 'No bin yet. Add one in settings.'}
        </p>
      </div>
    )
  }

  const soonest = computed.find((c) => c.date != null)

  return (
    <div style={shell}>
      {showTitle && title ? (
        <p style={{ margin: 0, fontSize: 'clamp(9px, 2.4cqmin, 10px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', flexShrink: 0 }}>
          {title}
        </p>
      ) : null}

      {/* Next-up banner when a collection is today or tomorrow. */}
      {soonest && soonest.days != null && soonest.days <= 1 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: 10, background: soonest.bin.color, color: '#fff', flexShrink: 0 }}>
          <IconAlarm size={15} color="#fff" />
          <span style={{ fontSize: 'clamp(10px, 2.8cqmin, 12px)', fontWeight: 700 }}>
            {soonest.days === 0
              ? de
                ? `${soonest.bin.name || (de ? 'Tonne' : 'Bin')} heute!`
                : `${soonest.bin.name || 'Bin'} today!`
              : de
                ? `${soonest.bin.name || 'Tonne'} morgen rausstellen`
                : `Put out ${soonest.bin.name || 'bin'} tomorrow`}
          </span>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {computed.map(({ bin, date, days }) => {
          const imminent = days != null && days <= 1
          return (
            <div
              key={bin.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 10,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${bin.color}`,
              }}
            >
              <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, background: bin.color }} />
              <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 'clamp(11px, 3cqmin, 13px)', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bin.name}>
                  {bin.name || (de ? 'Tonne' : 'Bin')}
                </span>
                <span style={{ fontSize: 'clamp(9px, 2.3cqmin, 10.5px)', color: 'var(--text-muted)' }}>
                  {date != null ? fmtDate(date, de) : de ? 'Referenztermin fehlt' : 'reference date missing'}
                </span>
              </div>
              <span
                style={{
                  fontSize: 'clamp(10px, 2.7cqmin, 12px)',
                  fontWeight: 700,
                  color: imminent ? bin.color : 'var(--text)',
                  flexShrink: 0,
                }}
              >
                {days != null ? untilLabel(days, de) : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
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

function intervalLabel(i: Interval, de: boolean): string {
  if (i === 'weekly') return de ? 'wöchentlich' : 'weekly'
  if (i === 'biweekly') return de ? '14-tägig' : 'every 2 weeks'
  return de ? '4-wöchentlich' : 'every 4 weeks'
}

function Settings({ config, onChange }: PluginSettingsProps) {
  const { de } = usePluginLocale()
  const cfg = config as Record<string, unknown>
  const bins = useMemo(() => parseBins(cfg.bins), [cfg.bins])
  const showTitle = cfg.showTitle !== false

  const persist = useCallback((list: Bin[]) => onChange('bins', JSON.stringify(list)), [onChange])
  const update = useCallback(
    (id: string, patch: Partial<Bin>) => persist(bins.map((b) => (b.id === id ? { ...b, ...patch } : b))),
    [bins, persist],
  )
  const remove = useCallback((id: string) => persist(bins.filter((b) => b.id !== id)), [bins, persist])

  const addPreset = useCallback(
    (p: (typeof PRESETS)[number]) => {
      if (bins.length >= MAX_BINS) return
      persist([
        ...bins,
        { id: newId(), name: de ? p.de : p.en, color: p.color, interval: 'biweekly', weekday: 1, refDate: '' },
      ])
    },
    [bins, persist, de],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={showTitle} onChange={(e) => onChange('showTitle', e.target.checked)} />
          {de ? 'Titel oben anzeigen' : 'Show title at top'}
        </label>
        <input style={{ ...inp, opacity: showTitle ? 1 : 0.5 }} disabled={!showTitle} value={cfg.title === undefined ? (de ? 'Müllabfuhr' : 'Waste collection') : str(cfg.title)} placeholder={de ? 'Müllabfuhr' : 'Waste collection'} onChange={(e) => onChange('title', e.target.value)} />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{de ? 'Tonnen' : 'Bins'}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bins.map((b) => (
            <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={b.color} onChange={(e) => update(b.id, { color: e.target.value })} title={de ? 'Farbe' : 'Colour'} style={{ width: 34, height: 32, padding: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer', flexShrink: 0 }} />
                <input style={{ ...inp, flex: 1 }} value={b.name} placeholder={de ? 'Name (z. B. Biotonne)' : 'Name (e.g. Bio)'} onChange={(e) => update(b.id, { name: e.target.value })} />
                <button type="button" onClick={() => remove(b.id)} title={de ? 'Entfernen' : 'Remove'} aria-label={de ? 'Entfernen' : 'Remove'} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, lineHeight: 0 }}>
                  <IconTrashBin size={16} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select style={{ ...inp, flex: 1, cursor: 'pointer' }} value={b.interval} onChange={(e) => update(b.id, { interval: isInterval(e.target.value) ? e.target.value : 'weekly' })}>
                  {(['weekly', 'biweekly', 'monthly4'] as Interval[]).map((i) => (
                    <option key={i} value={i}>{intervalLabel(i, de)}</option>
                  ))}
                </select>
                {b.interval === 'weekly' ? (
                  <select style={{ ...inp, flex: 1, cursor: 'pointer' }} value={b.weekday} onChange={(e) => update(b.id, { weekday: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                      <option key={wd} value={wd}>{(de ? WD_DE : WD_EN)[wd]}</option>
                    ))}
                  </select>
                ) : (
                  <input style={{ ...inp, flex: 1 }} type="date" value={b.refDate} onChange={(e) => update(b.id, { refDate: e.target.value })} title={de ? 'Ein bekanntes Abholdatum' : 'A known collection date'} />
                )}
              </div>
              {b.interval !== 'weekly' ? (
                <p style={{ margin: 0, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {de ? 'Referenztermin = ein echtes Abholdatum (bestimmt Wochentag + Takt).' : 'Reference date = a real collection date (defines weekday + phase).'}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {bins.length < MAX_BINS ? (
          <div style={{ marginTop: 10 }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--text-muted)' }}>{de ? 'Schnell hinzufügen:' : 'Quick add:'}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => addPreset(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />
                  {de ? p.de : p.en}
                  <IconPlus size={13} />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {de
          ? 'Alles wird nur lokal berechnet — kein Server, keine Cloud. Tipp: Für 14-tägige Tonnen einfach das nächste bekannte Abholdatum eintragen.'
          : 'Everything is computed locally — no server, no cloud. Tip: for 2-weekly bins just enter the next known collection date.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meta + exports
// ---------------------------------------------------------------------------

export const meta: PluginMeta = {
  id: 'muell',
  name: 'Müllabfuhr',
  description:
    'Müll-Abholkalender: pro Tonne (Bio, Rest, Gelb, Papier …) Wochentag oder 14-tägig/4-wöchentlich mit Referenztermin. Zeigt die nächste Abholung mit Countdown und markiert „heute/morgen rausstellen“. Komplett lokal, kein Server.',
  author: 'SelfDashboard',
  category: 'utility',
  icon: '🗑️',
  version: '1.0.0',
  defaultLayout: { w: 3, h: 4, minW: 2, minH: 2 },
  configSchema: [
    { key: 'bins', label: 'Tonnen', type: 'text', defaultValue: '[]' },
    { key: 'showTitle', label: 'Titel anzeigen', type: 'boolean', defaultValue: true },
    { key: 'title', label: 'Widget-Titel', type: 'text', defaultValue: 'Müllabfuhr' },
  ],
}

export const component: PluginComponent = {
  Widget,
  Settings,
}
