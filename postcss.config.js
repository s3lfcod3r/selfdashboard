module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    // Aeltere WebViews (Chromium 74) lauffaehig machen: inset-Kurzform ->
    // Langform, dvh/svh/lvh -> vh. Muss NACH Tailwind/Autoprefixer laufen.
    // Next.js verlangt Plugin-Namen als String (kein require()).
    './postcss-legacy-compat.js': {},
  },
}
