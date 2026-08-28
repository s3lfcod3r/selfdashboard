/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS PostCSS config */
module.exports = {
  plugins: [
    require('tailwindcss'),
    require('autoprefixer'),
    // Aeltere WebViews (Chromium 74) lauffaehig machen: inset-Kurzform ->
    // Langform, dvh/svh/lvh -> vh. Muss NACH Tailwind/Autoprefixer laufen.
    require('./postcss-legacy-compat'),
  ],
}
