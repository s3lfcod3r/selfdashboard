/**
 * Gemeinsame Browser-Bausteine der Node64-Plugins: Übersetzung (12 Sprachen),
 * Abruf über den eigenen Plugin-Server, Rahmen mit Kopfzeile, Einstellungen.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePluginLocale } from '@/lib/pluginLocale'
import { usePollingActive } from '@/hooks/usePollingActive'
import type { PluginSettingsProps } from '@/types'
import { N64_LANGS, N64_TEXT, type N64Lang } from './node64-i18n'

/** Self-Marke: Teal statt Blau. */
export const N64_COLOR = {
  ok: '#33a78c',
  okBright: '#43d3ad',
  warn: '#f59e0b',
  crit: '#ef4444',
  idle: '#8b97a3',
} as const

export type N64T = (key: string, vars?: Record<string, string | number>) => string

export function useN64(): { t: N64T; lang: N64Lang; locale: string } {
  const { locale } = usePluginLocale()
  const lang: N64Lang = (N64_LANGS as readonly string[]).includes(locale) ? (locale as N64Lang) : 'en'
  const idx = N64_LANGS.indexOf(lang)
  const t = useCallback<N64T>(
    (key, vars) => {
      const row = N64_TEXT[key]
      let s = row ? row[idx] || row[0] : key
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
      return s
    },
    [idx],
  )
  return { t, lang, locale: lang }
}

export function n64Str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

export function n64Num(v: unknown): number {
  const x = typeof v === 'number' ? v : Number(String(v ?? ''))
  return Number.isFinite(x) ? x : 0
}

export function fmtInt(n: number, locale: string): string {
  return Math.round(n).toLocaleString(locale)
}

export function fmtBytes(n: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`
}

export function fmtAgo(iso: string | number, t: N64T): string {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return t('ago_s')
  if (s < 3600) return t('ago_m', { n: Math.floor(s / 60) })
  if (s < 86400) return t('ago_h', { n: Math.floor(s / 3600) })
  return t('ago_d', { n: Math.floor(s / 86400) })
}

export function fmtTime(iso: string | number, locale: string): string {
  const d = new Date(typeof iso === 'number' ? iso : Date.parse(iso))
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function countryName(cc: string, locale: string): string {
  try {
    const dn = new Intl.DisplayNames([locale], { type: 'region' })
    return dn.of(cc.toUpperCase()) || cc
  } catch {
    return cc
  }
}

export function countryFlag(cc: string): string {
  const c = cc.toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return '🏳️'
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1a5 + ch.charCodeAt(0)))
}

const ERRORS: Record<string, string> = {
  missing_url: 'not_configured',
  missing_key: 'not_configured',
  invalid_url: 'err_network',
  invalid_key: 'err_invalid_key',
  unauthorized: 'err_unauthorized',
  forbidden: 'err_forbidden',
  module_off: 'err_module_off',
  timeout: 'err_timeout',
  network_error: 'err_network',
  upstream_error: 'err_network',
  blocked_url: 'err_blocked_url',
  rate_limited: 'err_rate',
}

export function errorText(code: string, t: N64T): string {
  return t(ERRORS[code] ?? 'err_generic')
}

/** Basis-Daten jedes Widgets: Adresse + Schlüssel aus der Kachel-Konfiguration. */
export function n64Conn(config: Record<string, unknown>): { url: string; apiKey: string; ok: boolean } {
  const url = n64Str(config.url)
  const apiKey = n64Str(config.apiKey)
  return { url, apiKey, ok: Boolean(url && apiKey) }
}

export async function postN64<T>(pluginId: string, body: Record<string, unknown>): Promise<T & { error?: string }> {
  try {
    const res = await fetch(`/api/plugins/${pluginId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok && !json.error) return { error: `http_${res.status}` } as T & { error?: string }
    return json
  } catch {
    return { error: 'network_error' } as T & { error?: string }
  }
}

/**
 * Regelmäßiger Abruf, der in Hintergrund-Tabs und außerhalb des Sichtbereichs
 * pausiert. `body` wird als JSON verglichen, damit neue Einstellungen sofort greifen.
 */
export function useN64Data<T>(pluginId: string, config: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const { ref, active } = usePollingActive()
  const conn = n64Conn(config)
  const refreshMs = Math.max(15, n64Num(config.refreshSeconds) || 60) * 1000
  const bodyKey = JSON.stringify({ url: conn.url, apiKey: conn.apiKey, ...extra })
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(conn.ok)
  const [at, setAt] = useState(0)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!conn.ok) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    const my = ++seq.current
    const res = await postN64<T>(pluginId, JSON.parse(bodyKey) as Record<string, unknown>)
    if (my !== seq.current) return
    if (res.error) setError(res.error)
    else {
      setError(null)
      setData(res)
      setAt(Date.now())
    }
    setLoading(false)
  }, [pluginId, bodyKey, conn.ok])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!active || !conn.ok) return
    const id = window.setInterval(() => void load(), refreshMs)
    return () => window.clearInterval(id)
  }, [active, load, refreshMs, conn.ok])

  return { ref, data, error, loading, configured: conn.ok, at, reload: load }
}

const box: CSSProperties = {
  height: '100%',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  color: 'var(--text)',
  fontSize: 12,
  overflow: 'hidden',
}

export function N64Frame(props: {
  pluginId: string
  config: Record<string, unknown>
  defaultTitle: string
  path: string
  frameRef?: React.Ref<HTMLDivElement>
  error: string | null
  loading: boolean
  configured: boolean
  hasData: boolean
  right?: ReactNode
  children: ReactNode
}) {
  const { t } = useN64()
  const showTitle = props.config.showTitle !== false
  const title = props.config.title === undefined ? props.defaultTitle : n64Str(props.config.title)
  const base = n64Str(props.config.url).replace(/\/+$/, '')
  const href = base ? `${/^https?:\/\//i.test(base) ? base : `http://${base}`}${props.path}` : ''
  return (
    <div ref={props.frameRef} style={box}>
      {showTitle ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <img
            src={`/api/plugins/custom-assets/${props.pluginId}/icon.png`}
            alt=""
            width={18}
            height={18}
            style={{ borderRadius: 4, flex: 'none' }}
          />
          <span style={{ flex: '1 1 auto', minWidth: 40, fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 auto', minWidth: 0 }}>
            {props.right}
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" title={t('open_node64')} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                ↗
              </a>
            ) : null}
          </span>
        </div>
      ) : null}
      {!props.configured ? (
        <N64Note>{t('not_configured')}</N64Note>
      ) : props.error && !props.hasData ? (
        <N64Note tone="crit">{errorText(props.error, t)}</N64Note>
      ) : props.loading && !props.hasData ? (
        <N64Note>{t('loading')}</N64Note>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto' }}>
          {props.error ? <N64Note tone="warn">{errorText(props.error, t)}</N64Note> : null}
          {props.children}
        </div>
      )}
    </div>
  )
}

export function N64Note({ children, tone }: { children: ReactNode; tone?: 'warn' | 'crit' }) {
  const color = tone === 'crit' ? N64_COLOR.crit : tone === 'warn' ? N64_COLOR.warn : 'var(--text-muted)'
  return <div style={{ color, fontSize: 12, lineHeight: 1.4, padding: '4px 0' }}>{children}</div>
}

export function N64Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flex: 'none',
        boxShadow: pulse ? `0 0 0 3px ${color}33` : undefined,
      }}
    />
  )
}

/** Kennzahl als schmaler Baustein (Wert + Beschriftung), viele passen in eine Zeile. */
export function N64Stat({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div
      title={label}
      style={{
        flex: '1 1 0',
        minWidth: 52,
        padding: '3px 6px',
        borderRadius: 6,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        lineHeight: 1.2,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: color ?? 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
    </div>
  )
}

export function N64StatRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{children}</div>
}

/** Ländercode als kleine Markierung (Flaggen-Emojis zeigt Windows nicht an). */
export function N64Code({ code }: { code: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 600,
        padding: '0 4px',
        borderRadius: 3,
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono, monospace)',
        flex: 'none',
        lineHeight: '14px',
      }}
    >
      {code.toUpperCase()}
    </span>
  )
}

export function N64Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

/** Gestapelte Balken (gesamt / Anteil hervorgehoben), z. B. DNS-Anfragen je halbe Stunde. */
export function N64Bars({ values, height = 44 }: { values: { total: number; part: number }[]; height?: number }) {
  if (!values.length) return null
  const max = Math.max(1, ...values.map((v) => v.total))
  const w = 100 / values.length
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }} aria-hidden>
      {values.map((v, i) => {
        const h = (v.total / max) * height
        const hp = (v.part / max) * height
        return (
          <g key={i}>
            <rect x={i * w + w * 0.1} y={height - h} width={w * 0.8} height={h} fill={N64_COLOR.ok} opacity={0.35} />
            <rect x={i * w + w * 0.1} y={height - hp} width={w * 0.8} height={hp} fill={N64_COLOR.crit} opacity={0.75} />
          </g>
        )
      })}
    </svg>
  )
}

export function N64Meter({ value, color }: { value: number; color: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden', minWidth: 30 }}>
      <div style={{ width: `${v}%`, height: '100%', background: color }} />
    </div>
  )
}

const inp: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 13,
  boxSizing: 'border-box',
}
const lab: CSSProperties = { display: 'block', fontSize: 12, margin: '10px 0 4px' }
const hint: CSSProperties = { margin: '4px 0 0', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }

export function N64Input(props: {
  label: string
  value: string | number
  onChange: (v: string) => void
  type?: 'text' | 'password' | 'number'
  placeholder?: string
  hintText?: string
}) {
  return (
    <div>
      <label style={lab}>{props.label}</label>
      <input
        style={inp}
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        autoComplete="off"
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hintText ? <p style={hint}>{props.hintText}</p> : null}
    </div>
  )
}

export function N64Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 10, cursor: 'pointer' }}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  )
}

export function N64Select(props: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label style={lab}>{props.label}</label>
      <select style={inp} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Gemeinsamer Teil der Einstellungen: Titel, Adresse, Schlüssel, Intervall. */
export function N64BaseSettings({
  config,
  onChange,
  defaultTitle,
  children,
}: PluginSettingsProps & { defaultTitle: string; children?: ReactNode }) {
  const { t } = useN64()
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <N64Check label={t('s_show_title')} checked={config.showTitle !== false} onChange={(v) => onChange('showTitle', v)} />
      <N64Input
        label={t('s_title')}
        value={config.title === undefined ? defaultTitle : n64Str(config.title)}
        placeholder={defaultTitle}
        onChange={(v) => onChange('title', v)}
      />
      <N64Input
        label={t('s_url')}
        value={n64Str(config.url)}
        placeholder="http://192.168.1.20:8080"
        onChange={(v) => onChange('url', v)}
      />
      <N64Input
        label={t('s_key')}
        type="password"
        value={n64Str(config.apiKey)}
        placeholder="node64_…"
        hintText={t('s_key_hint')}
        onChange={(v) => onChange('apiKey', v.trim())}
      />
      <N64Input
        label={t('s_refresh')}
        type="number"
        value={n64Num(config.refreshSeconds) || 60}
        onChange={(v) => onChange('refreshSeconds', Math.max(15, n64Num(v) || 60))}
      />
      {children}
    </div>
  )
}

/** Anzahl Listeneinträge aus der Konfiguration (0–20, Standard `def`). */
export function n64Count(v: unknown, def: number): number {
  if (v === undefined || v === null || v === '') return def
  return Math.max(0, Math.min(20, Math.round(n64Num(v))))
}

/** Gemeinsame Felder für `configSchema` (Sicherung/Export der Kachel). */
export const N64_BASE_SCHEMA = [
  { key: 'showTitle', label: 'Titel anzeigen', type: 'boolean' as const, defaultValue: true },
  { key: 'url', label: 'Node64-Adresse', type: 'text' as const, defaultValue: '' },
  { key: 'apiKey', label: 'API-Schlüssel', type: 'password' as const, defaultValue: '' },
  { key: 'refreshSeconds', label: 'Aktualisieren (Sek.)', type: 'number' as const, defaultValue: 60 },
]
