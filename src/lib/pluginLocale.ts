'use client'

import type { Locale } from '@/lib/i18n'
import { useDashboardStore } from '@/lib/store'

/**
 * `de` ist nur für die deutsche Oberfläche true. Plugin-Widgets sind binär
 * (de ? deutsch : englisch); für alle anderen Sprachen (en, fr, es, …) zeigen
 * sie daher Englisch als Fallback (Kern-UI ist vollständig übersetzt).
 */
export function usePluginLocale(): { locale: Locale; de: boolean } {
  const locale = useDashboardStore((s) => s.locale) as Locale
  return { locale, de: locale === 'de' }
}
