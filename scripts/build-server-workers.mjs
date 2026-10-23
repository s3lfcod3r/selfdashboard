/**
 * Baut Worker-Thread-Dateien für den Server (läuft als `postbuild` nach `next build`).
 *
 * Next/webpack bündelt worker_threads nicht zuverlässig — daher eigenständige
 * ESM-Bundles per esbuild nach .next/standalone/server-workers/ (im Image /app/server-workers/).
 * Native/große Pakete bleiben extern und kommen aus /app/node_modules.
 *
 * Run: node scripts/build-server-workers.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const standaloneDir = path.join(root, '.next', 'standalone')

const WORKERS = [
  {
    name: 'crowdsec-worker.mjs',
    entry: path.join(root, 'src', 'builtin-plugins', 'crowdsec', 'lib', 'crowdsecWorker.ts'),
  },
]

if (!fs.existsSync(standaloneDir)) {
  console.warn('[SelfDashboard] build-server-workers: .next/standalone fehlt — übersprungen (Worker-Fallback: Hauptthread)')
  process.exit(0)
}

const esbuild = (await import('esbuild')).default
const outDir = path.join(standaloneDir, 'server-workers')
fs.mkdirSync(outDir, { recursive: true })

/** `server-only` wirft außerhalb von Next — im Worker durch ein leeres Modul ersetzen. */
const serverOnlyStub = {
  name: 'server-only-stub',
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'sd-stub' }))
    build.onLoad({ filter: /.*/, namespace: 'sd-stub' }, () => ({ contents: 'export {}', loader: 'js' }))
  },
}

for (const w of WORKERS) {
  const outfile = path.join(outDir, w.name)
  await esbuild.build({
    entryPoints: [w.entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    absWorkingDir: root,
    alias: { '@': path.join(root, 'src') },
    external: ['better-sqlite3', 'maxmind'],
    banner: { js: "import { createRequire as __sdCreateRequire } from 'module';const require = __sdCreateRequire(import.meta.url);" },
    plugins: [serverOnlyStub],
    logLevel: 'warning',
  })
  console.log(`[SelfDashboard] server worker → ${path.relative(root, outfile)}`)
}
