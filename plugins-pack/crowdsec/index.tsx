import { useDashboardStore } from '@/lib/store'
import type { PluginComponent, PluginMeta, PluginWidgetProps } from '@/types'
import { CrowdsecSettings } from './CrowdsecSettings'
import { CrowdsecWidget } from './CrowdsecWidget'
import { CROWDSEC_VERSION } from './constants'

export const meta: PluginMeta = {
  id: 'crowdsec',
  name: 'CrowdSec',
  description:
    'Kompaktes CrowdSec-Dashboard aus crowdsec.db: Übersicht, Banns, Länder und durchsuchbarer IP-Feed mit Lookup-Links und optionalem Entsperren über die CrowdSec-LAPI. API: /api/plugins/crowdsec.',
  version: CROWDSEC_VERSION,
  author: 'SelfDashboard',
  category: 'security',
  icon: '🛡️',
  iconUrl: '/plugin-logos/crowdsec.png',
  defaultLayout: { w: 5, h: 6, minW: 4, minH: 4 },
  stackedExtraH: 2,
}

function Widget({ config, layoutMode, theme }: PluginWidgetProps) {
  const locale = useDashboardStore((s) => s.locale)
  // CrowdSec-Widget kennt nur de/en (formatInt / Intl.RelativeTimeFormat).
  // Alle anderen Dashboard-Sprachen fallen auf Deutsch zurück.
  const widgetLocale: 'de' | 'en' = locale === 'en' ? 'en' : 'de'
  return <CrowdsecWidget config={config} locale={widgetLocale} layoutMode={layoutMode} theme={theme} />
}

export const component: PluginComponent = {
  Widget,
  Settings: CrowdsecSettings,
}
