'use client'

import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'
import {
  N64_BASE_SCHEMA,
  N64_COLOR,
  N64BaseSettings,
  N64Check,
  N64Dot,
  N64Frame,
  N64Input,
  N64Note,
  N64Section,
  fmtAgo,
  n64Str,
  useN64,
  useN64Data,
  type N64T,
} from '../_shared/node64-ui'
import type { ChecksPayload, CheckRow } from './server'

const ID = 'node64-checks'
const VERSION = '1.1.0'

const STATE_COLOR: Record<string, string> = {
  up: N64_COLOR.ok,
  down: N64_COLOR.crit,
  degraded: N64_COLOR.warn,
  paused: N64_COLOR.idle,
  maintenance: N64_COLOR.idle,
  stabilizing: N64_COLOR.warn,
  pending: N64_COLOR.idle,
}

function stateLabel(state: string, t: N64T): string {
  const k: Record<string, string> = {
    up: 'st_up',
    down: 'st_down',
    degraded: 'st_degraded',
    paused: 'st_paused',
    maintenance: 'st_maintenance',
  }
  return t(k[state] ?? 'st_pending')
}

function Row({ c, showLatency, t }: { c: CheckRow; showLatency: boolean; t: N64T }) {
  const bad = c.state === 'down' || c.state === 'degraded'
  return (
    <div
      title={`${c.name} – ${stateLabel(c.state, t)}${c.message ? ` · ${c.message}` : ''}`}
      style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '1px 0', fontSize: 12, lineHeight: 1.3 }}
    >
      <N64Dot color={STATE_COLOR[c.state] ?? N64_COLOR.idle} pulse={bad} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: c.state === 'paused' ? 'var(--text-muted)' : undefined,
        }}
      >
        {c.name}
      </span>
      {bad ? (
        <span style={{ color: N64_COLOR.crit, fontSize: 11, whiteSpace: 'nowrap' }}>{fmtAgo(c.since, t)}</span>
      ) : showLatency && c.latency !== null ? (
        <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {c.latency < 10 ? c.latency.toFixed(1) : Math.round(c.latency)} ms
        </span>
      ) : null}
    </div>
  )
}

function Widget({ config }: PluginWidgetProps) {
  const { t } = useN64()
  const { ref, data, error, loading, configured } = useN64Data<ChecksPayload>(ID, config)
  const groupFilter = n64Str(config.group)
  const onlyProblems = config.onlyProblems === true
  const showLatency = config.showLatency !== false
  const showGroups = config.showGroups !== false
  const groupSummary = config.groupSummary === true

  const all = data?.checks ?? []
  const filtered = all
    .filter((c) => !groupFilter || c.group === groupFilter)
    .filter((c) => !onlyProblems || (c.state !== 'up' && c.state !== 'paused'))
  const down = (data?.counts.down ?? 0) > 0
  const groups = new Map<string, CheckRow[]>()
  for (const c of filtered) {
    const g = showGroups ? c.group || t('no_group') : ''
    groups.set(g, [...(groups.get(g) ?? []), c])
  }

  return (
    <N64Frame
      pluginId={ID}
      config={config}
      defaultTitle={`Node64 · ${t('t_checks')}`}
      path="/healthchecks"
      frameRef={ref}
      error={error}
      loading={loading}
      configured={configured}
      hasData={Boolean(data)}
    >
      {data ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <N64Dot color={down ? N64_COLOR.crit : N64_COLOR.ok} pulse={down} />
            <span style={{ fontWeight: 600, color: down ? N64_COLOR.crit : N64_COLOR.okBright }}>
              {down ? t('n_down', { n: data.counts.down }) : t('all_ok')}
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>
              {t('n_checks', { n: data.counts.total })}
            </span>
          </div>
          {data.update ? <N64Note tone="warn">{t('update_available', { v: data.update })}</N64Note> : null}
          {data.incidents.length ? (
            <N64Section title={t('open_incidents')}>
              {data.incidents.map((i, k) => (
                <div key={k} style={{ fontSize: 11, color: N64_COLOR.crit, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i.name} · {i.reason} · {fmtAgo(i.started, t)}
                </div>
              ))}
            </N64Section>
          ) : null}
          {groupSummary ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {[...groups.entries()].map(([g, rows]) => {
                const ok = rows.filter((c) => c.state === 'up').length
                const active = rows.filter((c) => c.state !== 'paused' && c.state !== 'maintenance')
                const bad = rows.filter((c) => c.state === 'down' || c.state === 'degraded')
                return (
                  <div key={g || '_'} style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <N64Dot color={bad.length ? N64_COLOR.crit : N64_COLOR.ok} pulse={bad.length > 0} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g || t('t_checks')}</span>
                      <span style={{ fontSize: 11, color: bad.length ? N64_COLOR.crit : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {t('group_ok', { n: ok, v: active.length })}
                      </span>
                    </div>
                    {bad.map((c) => (
                      <div key={c.id} style={{ paddingLeft: 14 }}>
                        <Row c={c} showLatency={false} t={t} />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '4px 12px' }}>
              {[...groups.entries()].map(([g, rows]) => (
                <div key={g || '_'} style={{ minWidth: 0 }}>
                  {g ? <N64Section title={g}>{rows.map((c) => <Row key={c.id} c={c} showLatency={showLatency} t={t} />)}</N64Section> : rows.map((c) => <Row key={c.id} c={c} showLatency={showLatency} t={t} />)}
                </div>
              ))}
            </div>
          )}
          {!filtered.length && onlyProblems ? <N64Note>{t('all_ok')}</N64Note> : null}
        </>
      ) : null}
    </N64Frame>
  )
}

function Settings(props: PluginSettingsProps) {
  const { t } = useN64()
  const { config, onChange } = props
  return (
    <N64BaseSettings {...props} defaultTitle={`Node64 · ${t('t_checks')}`}>
      <N64Input label={t('s_group')} value={n64Str(config.group)} onChange={(v) => onChange('group', v)} />
      <N64Check label={t('s_show_groups')} checked={config.showGroups !== false} onChange={(v) => onChange('showGroups', v)} />
      <N64Check label={t('s_group_summary')} checked={config.groupSummary === true} onChange={(v) => onChange('groupSummary', v)} />
      <N64Check label={t('s_only_problems')} checked={config.onlyProblems === true} onChange={(v) => onChange('onlyProblems', v)} />
      <N64Check label={t('s_show_latency')} checked={config.showLatency !== false} onChange={(v) => onChange('showLatency', v)} />
    </N64BaseSettings>
  )
}

export const meta: PluginMeta = {
  id: ID,
  name: 'Node64 Prüfungen',
  description:
    'Healthchecks aus Node64 (ipv64.net): Gesamtzustand, offene Störungen, alle Prüfungen nach Gruppen mit Antwortzeit. Ersatz für das Uptime-Kuma-Widget.',
  version: VERSION,
  author: 'SelfDashboard',
  category: 'network',
  icon: '💚',
  iconUrl: `https://cdn.jsdelivr.net/gh/s3lfcod3r/selfdashboard@main/plugins-pack/${ID}/icon.png`,
  defaultLayout: { w: 4, h: 4, minW: 2, minH: 2 },
  configSchema: [
    ...N64_BASE_SCHEMA,
    { key: 'group', label: 'Gruppe', type: 'text', defaultValue: '' },
    { key: 'showGroups', label: 'Nach Gruppen', type: 'boolean', defaultValue: true },
    { key: 'groupSummary', label: 'Zusammenfassung je Gruppe', type: 'boolean', defaultValue: false },
    { key: 'onlyProblems', label: 'Nur Probleme', type: 'boolean', defaultValue: false },
    { key: 'showLatency', label: 'Antwortzeit', type: 'boolean', defaultValue: true },
  ],
}

export const component: PluginComponent = { Widget, Settings }
