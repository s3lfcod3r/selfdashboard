'use client'

import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'
import {
  N64_BASE_SCHEMA,
  N64_COLOR,
  N64Bars,
  N64BaseSettings,
  N64Check,
  N64Dot,
  N64Frame,
  N64Note,
  N64Section,
  N64Stat,
  N64StatRow,
  fmtBytes,
  fmtInt,
  useN64,
  useN64Data,
  type N64T,
} from '../_shared/node64-ui'
import type { ProxyHost, ProxyPayload } from './server'

const ID = 'node64-proxy'
const VERSION = '1.1.0'

function reachColor(h: ProxyHost): string {
  if (!h.enabled) return N64_COLOR.idle
  if (h.reach === 'up') return N64_COLOR.ok
  if (h.reach === 'down') return N64_COLOR.crit
  return N64_COLOR.idle
}

function certText(h: ProxyHost, t: N64T): { text: string; color: string } {
  if (h.certDays === null) return { text: t('no_cert'), color: 'var(--text-muted)' }
  if (h.certDays < 0 || h.certState === 'expired') return { text: t('cert_expired'), color: N64_COLOR.crit }
  return {
    text: t('cert_days', { n: h.certDays }),
    color: h.certDays < 14 ? N64_COLOR.crit : h.certDays < 30 ? N64_COLOR.warn : 'var(--text-muted)',
  }
}

function Widget({ config }: PluginWidgetProps) {
  const { t, locale } = useN64()
  const { ref, data, error, loading, configured } = useN64Data<ProxyPayload>(ID, config)
  const showStats = config.showStats !== false
  const showChart = config.showChart !== false
  const hosts = (data?.hosts ?? []).filter((h) => h.kind !== 'redirect' || config.showRedirects === true)

  return (
    <N64Frame
      pluginId={ID}
      config={config}
      defaultTitle={`Node64 · ${t('t_proxy')}`}
      path="/cdn64"
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
              <N64Stat label={t('requests')} value={fmtInt(data.totals.requests, locale)} />
              <N64Stat label={t('blocked')} value={fmtInt(data.totals.blocked, locale)} color={N64_COLOR.crit} />
              <N64Stat label={t('decoy')} value={fmtInt(data.totals.decoy, locale)} color={N64_COLOR.warn} />
              <N64Stat label={t('traffic')} value={fmtBytes(data.totals.bytes, locale)} />
            </N64StatRow>
          ) : null}
          {showChart && data.timeline.length ? (
            <N64Section title={t('last_24h')}>
              <N64Bars values={data.timeline} height={26} />
            </N64Section>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {hosts.map((h) => {
              const cert = certText(h, t)
              const reachLabel = t(h.reach === 'up' ? 'reach_up' : h.reach === 'down' ? 'reach_down' : 'reach_unknown')
              return (
                <div
                  key={h.id}
                  title={`${h.name} – ${reachLabel}${h.ms !== null ? ` (${h.ms} ms)` : ''} · ${cert.text} · ${fmtInt(h.requests, locale)} ${t('requests')} · ${fmtInt(h.blocked, locale)} ${t('blocked')}${h.errors ? ` · ${fmtInt(h.errors, locale)} ${t('errors')}` : ''}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '2px 0', fontSize: 12 }}
                >
                  <N64Dot color={reachColor(h)} pulse={h.reach === 'down'} />
                  <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.name}
                    {h.extra ? <span style={{ color: 'var(--text-muted)' }}> +{h.extra}</span> : null}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtInt(h.requests, locale)}
                    {h.blocked ? <span style={{ color: N64_COLOR.crit }}> · {fmtInt(h.blocked, locale)}</span> : null}
                  </span>
                  <span style={{ fontSize: 10, color: cert.color, whiteSpace: 'nowrap', minWidth: 30, textAlign: 'right' }}>
                    {h.certDays === null ? '–' : h.certDays < 0 ? '🔒 !' : `🔒 ${h.certDays}`}
                  </span>
                </div>
              )
            })}
          </div>
          {!hosts.length ? <N64Note>{t('no_hosts')}</N64Note> : null}
        </>
      ) : null}
    </N64Frame>
  )
}

function Settings(props: PluginSettingsProps) {
  const { t } = useN64()
  const { config, onChange } = props
  return (
    <N64BaseSettings {...props} defaultTitle={`Node64 · ${t('t_proxy')}`}>
      <N64Check label={t('s_show_stats')} checked={config.showStats !== false} onChange={(v) => onChange('showStats', v)} />
      <N64Check label={t('s_show_chart')} checked={config.showChart !== false} onChange={(v) => onChange('showChart', v)} />
      <N64Check label={t('redirect')} checked={config.showRedirects === true} onChange={(v) => onChange('showRedirects', v)} />
    </N64BaseSettings>
  )
}

export const meta: PluginMeta = {
  id: ID,
  name: 'Node64 Reverse-Proxy',
  description:
    'PROXY64 aus Node64 (ipv64.net): Proxy-Hosts mit Erreichbarkeit, Anfragen, Sperren und Restlaufzeit der Zertifikate, dazu Verlauf der letzten 24 Stunden. Ersatz für das Zoraxy-Widget.',
  version: VERSION,
  author: 'SelfDashboard',
  category: 'network',
  icon: '🔀',
  iconUrl: `https://cdn.jsdelivr.net/gh/s3lfcod3r/selfdashboard@main/plugins-pack/${ID}/icon.png`,
  defaultLayout: { w: 4, h: 3, minW: 2, minH: 2 },
  configSchema: [
    ...N64_BASE_SCHEMA,
    { key: 'showStats', label: 'Zahlen', type: 'boolean', defaultValue: true },
    { key: 'showChart', label: 'Verlauf', type: 'boolean', defaultValue: true },
    { key: 'showRedirects', label: 'Weiterleitungen', type: 'boolean', defaultValue: false },
  ],
}

export const component: PluginComponent = { Widget, Settings }
