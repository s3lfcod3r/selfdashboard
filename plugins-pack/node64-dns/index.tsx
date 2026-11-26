'use client'

import { useState } from 'react'
import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'
import {
  N64_BASE_SCHEMA,
  N64_COLOR,
  N64Bars,
  N64BaseSettings,
  N64Check,
  N64Dot,
  N64Frame,
  N64Input,
  N64Note,
  N64Section,
  N64Select,
  N64Stat,
  N64StatRow,
  errorText,
  fmtInt,
  fmtTime,
  n64Conn,
  n64Str,
  postN64,
  useN64,
  useN64Data,
} from '../_shared/node64-ui'
import type { DnsPayload } from './server'

const ID = 'node64-dns'
const VERSION = '1.0.0'

function Widget({ config }: PluginWidgetProps) {
  const { t, locale } = useN64()
  const range = ['1h', '24h', '7d'].includes(n64Str(config.range)) ? n64Str(config.range) : '24h'
  const { ref, data, error, loading, configured, reload } = useN64Data<DnsPayload>(ID, config, { range })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const adminKey = n64Str(config.adminKey)
  const showChart = config.showChart !== false
  const showTop = config.showTop !== false
  const showDevices = config.showDevices === true

  async function toggle() {
    if (!data) return
    if (!adminKey) {
      setActionError(t('needs_admin_key'))
      return
    }
    setBusy(true)
    setActionError('')
    const res = await postN64<{ ok?: boolean }>(ID, {
      ...n64Conn(config),
      adminKey,
      action: data.paused ? 'resume' : 'pause',
    })
    setBusy(false)
    if (res.error) setActionError(`${t('action_failed')} ${errorText(res.error, t)}`)
    else void reload()
  }

  const rate = data && data.total > 0 ? (data.blocked / data.total) * 100 : 0
  const rangeLabel = t(range === '1h' ? 'last_hour' : range === '7d' ? 'last_7d' : 'last_24h')
  const btn = {
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    borderRadius: 6,
    padding: '2px 8px',
    fontSize: 11,
    cursor: busy ? 'wait' : 'pointer',
  } as const

  return (
    <N64Frame
      pluginId={ID}
      config={config}
      defaultTitle={`Node64 · ${t('t_dns')}`}
      path="/dns64"
      frameRef={ref}
      error={error}
      loading={loading}
      configured={configured}
      hasData={Boolean(data)}
      right={
        data ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <N64Dot color={data.paused ? N64_COLOR.warn : N64_COLOR.ok} />
            <span style={{ color: 'var(--text-muted)' }}>
              {data.paused
                ? data.pausedUntil
                  ? t('paused_until', { t: fmtTime(data.pausedUntil, locale) })
                  : t('filter_paused')
                : t('filter_active')}
            </span>
            <button type="button" style={btn} disabled={busy} onClick={() => void toggle()}>
              {data.paused ? t('resume') : t('pause_10')}
            </button>
          </span>
        ) : null
      }
    >
      {data ? (
        <>
          {actionError ? <N64Note tone="warn">{actionError}</N64Note> : null}
          <N64StatRow>
            <N64Stat label={t('queries')} value={fmtInt(data.total, locale)} />
            <N64Stat label={t('blocked')} value={fmtInt(data.blocked, locale)} color={N64_COLOR.crit} />
            <N64Stat label={t('block_rate')} value={`${rate.toLocaleString(locale, { maximumFractionDigits: 1 })} %`} color={N64_COLOR.okBright} />
            <N64Stat label={t('devices')} value={fmtInt(data.clients, locale)} />
            <N64Stat label={t('response_time')} value={`${data.avgMs.toLocaleString(locale)} ms`} />
          </N64StatRow>
          {showChart && data.timeline.length ? (
            <N64Section title={rangeLabel}>
              <N64Bars values={data.timeline.map((b) => ({ total: b.total, part: b.blocked }))} />
            </N64Section>
          ) : null}
          {showTop && data.topBlocked.length ? (
            <N64Section title={t('top_blocked')}>
              {data.topBlocked.map((d) => (
                <div key={d.name} style={{ display: 'flex', gap: 8, minWidth: 0, fontSize: 11 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>
                    {d.name}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.count, locale)}</span>
                </div>
              ))}
            </N64Section>
          ) : null}
          {showDevices && data.topClients.length ? (
            <N64Section title={t('top_devices')}>
              {data.topClients.map((c) => (
                <div key={c.name} style={{ display: 'flex', gap: 8, minWidth: 0, fontSize: 11 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>
                    {c.host || c.name}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtInt(c.count, locale)} · <span style={{ color: N64_COLOR.crit }}>{fmtInt(c.blocked, locale)}</span>
                  </span>
                </div>
              ))}
            </N64Section>
          ) : null}
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('list_size', { n: fmtInt(data.listSize, locale) })}</div>
        </>
      ) : null}
    </N64Frame>
  )
}

function Settings(props: PluginSettingsProps) {
  const { t } = useN64()
  const { config, onChange } = props
  return (
    <N64BaseSettings {...props} defaultTitle={`Node64 · ${t('t_dns')}`}>
      <N64Select
        label={t('s_range')}
        value={['1h', '24h', '7d'].includes(n64Str(config.range)) ? n64Str(config.range) : '24h'}
        options={[
          { value: '1h', label: t('last_hour') },
          { value: '24h', label: t('last_24h') },
          { value: '7d', label: t('last_7d') },
        ]}
        onChange={(v) => onChange('range', v)}
      />
      <N64Check label={t('s_show_chart')} checked={config.showChart !== false} onChange={(v) => onChange('showChart', v)} />
      <N64Check label={t('s_show_top')} checked={config.showTop !== false} onChange={(v) => onChange('showTop', v)} />
      <N64Check label={t('s_show_devices')} checked={config.showDevices === true} onChange={(v) => onChange('showDevices', v)} />
      <N64Input
        label={t('s_admin_key')}
        type="password"
        value={n64Str(config.adminKey)}
        placeholder="node64_…"
        onChange={(v) => onChange('adminKey', v.trim())}
      />
    </N64BaseSettings>
  )
}

export const meta: PluginMeta = {
  id: ID,
  name: 'Node64 DNS-Filter',
  description:
    'DNS64 aus Node64 (ipv64.net): Anfragen, Sperrquote, Verlauf, meistgesperrte Adressen und aktivste Geräte; Filter auf Knopfdruck 10 Minuten pausieren. Ersatz für das AdGuard-Widget.',
  version: VERSION,
  author: 'SelfDashboard',
  category: 'network',
  icon: '🛡️',
  iconUrl: `https://cdn.jsdelivr.net/gh/s3lfcod3r/selfdashboard@main/plugins-pack/${ID}/icon.png`,
  defaultLayout: { w: 4, h: 4, minW: 2, minH: 2 },
  configSchema: [
    ...N64_BASE_SCHEMA,
    { key: 'range', label: 'Zeitraum', type: 'select', defaultValue: '24h', options: [
      { label: '1 h', value: '1h' },
      { label: '24 h', value: '24h' },
      { label: '7 d', value: '7d' },
    ] },
    { key: 'showChart', label: 'Verlauf', type: 'boolean', defaultValue: true },
    { key: 'showTop', label: 'Meistgesperrt', type: 'boolean', defaultValue: true },
    { key: 'showDevices', label: 'Geräte', type: 'boolean', defaultValue: false },
    { key: 'adminKey', label: 'Admin-Schlüssel', type: 'password', defaultValue: '' },
  ],
}

export const component: PluginComponent = { Widget, Settings }
