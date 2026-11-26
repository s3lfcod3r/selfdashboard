'use client'

import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'
import {
  N64_BASE_SCHEMA,
  N64_COLOR,
  N64BaseSettings,
  N64Check,
  N64Frame,
  N64Note,
  N64Section,
  N64Select,
  N64Stat,
  N64StatRow,
  countryFlag,
  countryName,
  fmtAgo,
  fmtInt,
  n64Str,
  useN64,
  useN64Data,
} from '../_shared/node64-ui'
import { WorldMap } from './WorldMap'
import type { MapPayload } from './server'

const ID = 'node64-map'
const VERSION = '1.0.0'

const KIND_COLOR: Record<string, string> = {
  exploit: N64_COLOR.crit,
  login: N64_COLOR.crit,
  scan: N64_COLOR.warn,
  other: N64_COLOR.idle,
}

function Widget({ config }: PluginWidgetProps) {
  const { t, locale } = useN64()
  const range = ['1h', '24h', '7d'].includes(n64Str(config.range)) ? n64Str(config.range) : '24h'
  const { ref, data, error, loading, configured } = useN64Data<MapPayload>(ID, config, { range })
  const mode = config.mapMode === 'arcs' ? 'arcs' : 'dots'
  const showList = config.showList !== false
  const showStats = config.showStats !== false

  return (
    <N64Frame
      pluginId={ID}
      config={config}
      defaultTitle={`Node64 · ${t('t_map')}`}
      path="/honeypot"
      frameRef={ref}
      error={error}
      loading={loading}
      configured={configured}
      hasData={Boolean(data)}
    >
      {data ? (
        <>
          {showStats ? (
            <N64StatRow>
              <N64Stat label={t('attacks')} value={fmtInt(data.attacks, locale)} color={N64_COLOR.crit} />
              <N64Stat label={t('sources')} value={fmtInt(data.sources, locale)} />
              <N64Stat label={t('countries')} value={fmtInt(data.countries, locale)} />
              <N64Stat label={t('banned')} value={fmtInt(data.banned, locale)} color={N64_COLOR.okBright} />
            </N64StatRow>
          ) : null}
          {!data.points.length ? (
            <N64Note>{t('no_attacks')}</N64Note>
          ) : (
            <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 120, flexWrap: 'wrap' }}>
              <div style={{ flex: '3 1 260px', minWidth: 0, minHeight: 120 }}>
                <WorldMap points={data.points} mode={mode} homeCc={data.home} label={t('t_map')} />
              </div>
              {showList ? (
                <div style={{ flex: '1 1 150px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <N64Section title={t('top_countries')}>
                    {data.points.slice(0, 6).map((p) => (
                      <div key={p.cc} style={{ display: 'flex', gap: 6, fontSize: 11, minWidth: 0 }}>
                        <span aria-hidden>{countryFlag(p.cc)}</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {countryName(p.cc, locale)}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(p.count, locale)}</span>
                      </div>
                    ))}
                  </N64Section>
                  {data.recent.length ? (
                    <N64Section title={t('recent')}>
                      {data.recent.slice(0, 5).map((r, i) => (
                        <div
                          key={`${r.t}-${i}`}
                          title={`${r.ip} · ${countryName(r.cc, locale)} · ${r.port}`}
                          style={{ display: 'flex', gap: 6, fontSize: 10, minWidth: 0, alignItems: 'center' }}
                        >
                          <span aria-hidden>{countryFlag(r.cc)}</span>
                          <span style={{ color: KIND_COLOR[r.kind] ?? N64_COLOR.idle, whiteSpace: 'nowrap' }}>{t(`kind_${r.kind}`)}</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
                            {r.ip}
                          </span>
                          <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtAgo(r.t, t)}</span>
                        </div>
                      ))}
                    </N64Section>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </N64Frame>
  )
}

function Settings(props: PluginSettingsProps) {
  const { t } = useN64()
  const { config, onChange } = props
  return (
    <N64BaseSettings {...props} defaultTitle={`Node64 · ${t('t_map')}`}>
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
      <N64Select
        label={t('s_map_mode')}
        value={config.mapMode === 'arcs' ? 'arcs' : 'dots'}
        options={[
          { value: 'dots', label: t('mode_dots') },
          { value: 'arcs', label: t('mode_arcs') },
        ]}
        onChange={(v) => onChange('mapMode', v)}
      />
      <N64Check label={t('s_show_stats')} checked={config.showStats !== false} onChange={(v) => onChange('showStats', v)} />
      <N64Check label={t('s_show_list')} checked={config.showList !== false} onChange={(v) => onChange('showList', v)} />
    </N64BaseSettings>
  )
}

export const meta: PluginMeta = {
  id: ID,
  name: 'Node64 Angriffskarte',
  description:
    'Honeypot64 aus Node64 (ipv64.net): Weltkarte der Angriffe (Punkte oder Bögen), Top-Länder, letzte Zugriffe und gesperrte Adressen. Ersatz für CrowdSec-Widget und SelfThreatMap.',
  version: VERSION,
  author: 'SelfDashboard',
  category: 'security',
  icon: '🗺️',
  iconUrl: `https://cdn.jsdelivr.net/gh/s3lfcod3r/selfdashboard@main/plugins-pack/${ID}/icon.png`,
  defaultLayout: { w: 6, h: 4, minW: 3, minH: 3 },
  configSchema: [
    ...N64_BASE_SCHEMA,
    { key: 'range', label: 'Zeitraum', type: 'select', defaultValue: '24h', options: [
      { label: '1 h', value: '1h' },
      { label: '24 h', value: '24h' },
      { label: '7 d', value: '7d' },
    ] },
    { key: 'mapMode', label: 'Darstellung', type: 'select', defaultValue: 'dots', options: [
      { label: 'Punkte', value: 'dots' },
      { label: 'Bögen', value: 'arcs' },
    ] },
    { key: 'showStats', label: 'Zahlen', type: 'boolean', defaultValue: true },
    { key: 'showList', label: 'Liste', type: 'boolean', defaultValue: true },
  ],
}

export const component: PluginComponent = { Widget, Settings }
