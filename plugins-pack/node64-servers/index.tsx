'use client'

import type { PluginComponent, PluginMeta, PluginSettingsProps, PluginWidgetProps } from '@/types'
import {
  N64_BASE_SCHEMA,
  N64_COLOR,
  N64BaseSettings,
  N64Dot,
  N64Frame,
  N64Meter,
  N64Note,
  useN64,
  useN64Data,
  type N64T,
} from '../_shared/node64-ui'
import type { ServerHost, ServersPayload } from './server'

const ID = 'node64-servers'
const VERSION = '1.0.0'

const STATE_COLOR: Record<string, string> = {
  ok: N64_COLOR.ok,
  warn: N64_COLOR.warn,
  crit: N64_COLOR.crit,
  unknown: N64_COLOR.idle,
}

function meterColor(v: number): string {
  return v >= 90 ? N64_COLOR.crit : v >= 75 ? N64_COLOR.warn : N64_COLOR.ok
}

function stateLabel(h: ServerHost, t: N64T): string {
  if (h.offline) return t('st_offline')
  return t(`st_${['ok', 'warn', 'crit'].includes(h.state) ? h.state : 'unknown'}`)
}

function MeterRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr 34px', alignItems: 'center', gap: 6, fontSize: 10 }}>
      <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
      <N64Meter value={value} color={meterColor(value)} />
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value} %</span>
    </div>
  )
}

function Widget({ config }: PluginWidgetProps) {
  const { t } = useN64()
  const { ref, data, error, loading, configured } = useN64Data<ServersPayload>(ID, config)

  return (
    <N64Frame
      pluginId={ID}
      config={config}
      defaultTitle={`Node64 · ${t('t_servers')}`}
      path="/monitor64"
      frameRef={ref}
      error={error}
      loading={loading}
      configured={configured}
      hasData={Boolean(data)}
      right={data ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('n_hosts', { n: data.hosts.length })}</span> : null}
    >
      {data ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
          {data.hosts.map((h) => {
            const color = h.offline ? N64_COLOR.idle : STATE_COLOR[h.state] ?? N64_COLOR.idle
            return (
              <div
                key={h.id}
                title={`${h.name} (${h.address})`}
                style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  minWidth: 0,
                  opacity: h.offline ? 0.7 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <N64Dot color={color} pulse={h.state === 'crit' && !h.offline} />
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                  <span style={{ fontSize: 10, color }}>{stateLabel(h, t)}</span>
                </div>
                {!h.offline && h.cpu !== null ? <MeterRow label={t('cpu')} value={h.cpu} /> : null}
                {!h.offline && h.ram !== null ? <MeterRow label={t('ram')} value={h.ram} /> : null}
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {h.services} {t('services')}
                  {h.problems ? <span style={{ color: N64_COLOR.warn }}> · {h.problems} {t('problems')}</span> : null}
                </div>
              </div>
            )
          })}
          {!data.hosts.length ? <N64Note>{t('no_hosts')}</N64Note> : null}
        </div>
      ) : null}
    </N64Frame>
  )
}

function Settings(props: PluginSettingsProps) {
  const { t } = useN64()
  return <N64BaseSettings {...props} defaultTitle={`Node64 · ${t('t_servers')}`} />
}

export const meta: PluginMeta = {
  id: ID,
  name: 'Node64 Server',
  description:
    'Monitor64 aus Node64 (ipv64.net): alle überwachten Server mit Zustand, CPU, RAM, Anzahl Dienste und offenen Problemen.',
  version: VERSION,
  author: 'SelfDashboard',
  category: 'system',
  icon: '🖥️',
  iconUrl: `https://cdn.jsdelivr.net/gh/s3lfcod3r/selfdashboard@main/plugins-pack/${ID}/icon.png`,
  defaultLayout: { w: 4, h: 3, minW: 2, minH: 2 },
  configSchema: [...N64_BASE_SCHEMA],
}

export const component: PluginComponent = { Widget, Settings }
