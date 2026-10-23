/**
 * Cache-Schlüssel für /api/plugins/widgets-bundle — gleich berechnet in Browser
 * und Server. FNV-1a statt crypto.subtle, weil das auf http:// (LAN) fehlt.
 */
export function widgetBundleVersionKey(ids: readonly string[], versions: Record<string, string>): string {
  const input = ids.map((id) => `${id}@${versions[id] ?? '0'}`).join(',')
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export const WIDGET_BUNDLE_MAX_IDS = 100
