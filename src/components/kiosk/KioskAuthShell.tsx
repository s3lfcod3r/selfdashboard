'use client'

import type { ReactNode } from 'react'
import { useDashboardStore } from '@/lib/store'
import { type Locale, LOCALES } from '@/lib/i18n'

export function KioskAuthShell({ children }: { children: ReactNode }) {
  const locale = useDashboardStore((s) => s.locale)
  const setLocale = useDashboardStore((s) => s.setLocale)
  const de = locale === 'de'

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: 'var(--background)', color: 'var(--text)' }}
    >
      <div className="w-full max-w-md flex flex-col items-center gap-6">
        <div className="w-full flex flex-col items-center gap-3">
          <img
            src="/logo-auth.svg"
            alt=""
            width={280}
            height={59}
            className="mx-auto"
            style={{ width: 'min(100%, 280px)', height: 'auto', display: 'block' }}
          />
          <h1 className="text-xl font-bold tracking-tight m-0" style={{ color: 'var(--text)' }}>
            {de ? 'Kiosk-Modus' : 'Kiosk mode'}
          </h1>
        </div>

        <div
          className="relative w-full rounded-2xl"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="absolute top-3 right-3 z-10">
            <LangToggle locale={locale} setLocale={setLocale} />
          </div>
          <div className="p-8 pt-10 flex flex-col gap-4">{children}</div>
        </div>
      </div>
    </div>
  )
}

function LangToggle({
  locale,
  setLocale,
}: {
  locale: Locale
  setLocale: (l: Locale) => void
}) {
  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label={locale === 'de' ? 'Sprache' : 'Language'}
      className="text-xs font-semibold rounded-md px-2 py-1 shrink-0"
      style={{
        background: 'var(--surface-2)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
        cursor: 'pointer',
      }}
    >
      {LOCALES.map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
