/* eslint-disable @typescript-eslint/no-require-imports -- PostCSS build plugin (CommonJS) */
/**
 * Macht das generierte CSS auf aelteren WebViews lauffaehig (z.B. Chromium 74
 * auf Billig-Tablets/TV-Boxen), ohne moderne Browser zu beeintraechtigen:
 *
 *  - `inset: …` (Kurzform, erst Chrome 87) -> top/right/bottom/left (ueberall
 *    unterstuetzt). Ohne das greift `fixed inset-0` nicht -> Modals/Overlays
 *    zentrieren nicht, sondern "rutschen" an eine falsche Position.
 *  - Viewport-Einheiten dvh/svh/lvh (erst Chrome 108) -> vh. Auf einem Kiosk-
 *    Display ohne dynamische Browserleisten ist vh gleichwertig.
 *
 * Laeuft als letztes Plugin, damit auch von Tailwind erzeugte Deklarationen
 * erfasst werden.
 */
const UNIT_RE = /(-?\d*\.?\d+)(dvh|svh|lvh)\b/gi

module.exports = () => ({
  postcssPlugin: 'legacy-compat',
  Declaration(decl) {
    // dvh/svh/lvh -> vh (auch innerhalb von min()/max()/calc()).
    if (UNIT_RE.test(decl.value)) {
      decl.value = decl.value.replace(UNIT_RE, '$1vh')
    }
    // inset-Kurzform -> Langform.
    if (decl.prop === 'inset' || decl.prop === 'inset-block' || decl.prop === 'inset-inline') {
      const parts = decl.value.trim().split(/\s+/)
      let top, right, bottom, left
      if (parts.length === 1) {
        top = right = bottom = left = parts[0]
      } else if (parts.length === 2) {
        top = bottom = parts[0]
        right = left = parts[1]
      } else if (parts.length === 3) {
        top = parts[0]
        right = left = parts[1]
        bottom = parts[2]
      } else {
        ;[top, right, bottom, left] = parts
      }
      if (decl.prop === 'inset') {
        decl.cloneBefore({ prop: 'top', value: top })
        decl.cloneBefore({ prop: 'right', value: right })
        decl.cloneBefore({ prop: 'bottom', value: bottom })
        decl.cloneBefore({ prop: 'left', value: left })
        decl.remove()
      } else if (decl.prop === 'inset-block') {
        decl.cloneBefore({ prop: 'top', value: parts[0] })
        decl.cloneBefore({ prop: 'bottom', value: parts[1] ?? parts[0] })
        decl.remove()
      } else if (decl.prop === 'inset-inline') {
        decl.cloneBefore({ prop: 'left', value: parts[0] })
        decl.cloneBefore({ prop: 'right', value: parts[1] ?? parts[0] })
        decl.remove()
      }
    }
  },
})
module.exports.postcss = true
