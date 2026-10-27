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

/** Zielgröße je Bundle-Teil (Rohgröße der widget.js; minifiziert wird meist weniger). */
export const BUNDLE_CHUNK_BYTES = 300 * 1024
/** Annahme, wenn der Server keine Größe liefert (älteres Image). */
const UNKNOWN_WIDGET_BYTES = 30 * 1024

/**
 * Ids der Reihe nach zu Teilen bis ~maxBytes gruppieren (mind. 1 Id je Teil).
 * Jeder Teil wird ein eigenes Bundle-Skript — der Browser kann zwischen den Teilen
 * zeichnen und reagieren, statt alles am Stück auszuführen.
 */
export function chunkWidgetIds(
  ids: readonly string[],
  sizes: Record<string, number> = {},
  maxBytes = BUNDLE_CHUNK_BYTES,
): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let bytes = 0
  for (const id of ids) {
    const size = sizes[id] ?? UNKNOWN_WIDGET_BYTES
    if (current.length > 0 && bytes + size > maxBytes) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(id)
    bytes += size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}
