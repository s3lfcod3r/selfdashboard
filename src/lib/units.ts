export type UnitSystem = 'auto' | 'metric' | 'imperial'
export type ResolvedUnitSystem = 'metric' | 'imperial'

/** Countries where Fahrenheit/mph are everyday units; everyone else defaults to metric. */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM'])

/** `auto` derives from a BCP-47 locale's region (falls back to `navigator.language`, then metric). */
export function resolveUnitSystem(setting: UnitSystem | undefined, localeStr?: string): ResolvedUnitSystem {
  if (setting === 'metric' || setting === 'imperial') return setting
  if (setting !== 'auto') return 'metric'
  const loc = localeStr ?? (typeof navigator !== 'undefined' ? navigator.language : '')
  if (!loc) return 'metric'
  try {
    const region = new Intl.Locale(loc).maximize().region
    return region && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric'
  } catch {
    return 'metric'
  }
}

/** Per-widget override (`metric`/`imperial`); anything else (e.g. '') follows the global setting. */
export function resolveWidgetUnitSystem(override: unknown, global: ResolvedUnitSystem): ResolvedUnitSystem {
  return override === 'metric' || override === 'imperial' ? override : global
}

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32
}
