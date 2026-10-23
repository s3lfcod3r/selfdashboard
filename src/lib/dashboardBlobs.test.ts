import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { blobDir, expandDashboardBlobs, extractDashboardBlobs, requestOrigin } from './dashboardBlobs'

const bigPng = Buffer.alloc(12_000, 7) // > 8 KB base64
const bigB64 = bigPng.toString('base64')
const smallB64 = Buffer.from('klein').toString('base64')

function state(config: Record<string, unknown>, pluginId = 'bookmarks') {
  return { dashboards: [{ id: 'd', plugins: [{ instanceId: 'i', pluginId, config }] }], activeDashboardId: 'd' }
}
const cfgOf = (s: unknown) => (s as ReturnType<typeof state>).dashboards[0].plugins[0].config

let tmp = ''
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-blobs-'))
  process.env.SELFDASHBOARD_DATA_DIR = tmp
})
afterEach(() => {
  delete process.env.SELFDASHBOARD_DATA_DIR
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('extractDashboardBlobs', () => {
  it('lagert große Bilder verlustfrei aus — auch in JSON-Strings (Bookmarks: config.data)', () => {
    const data = JSON.stringify({ apps: [{ id: '1', icon: `data:image/png;base64,${bigB64}` }, { id: '2', icon: '🚀' }] })
    const r = extractDashboardBlobs(state({ data }))
    expect(r.changed).toBe(true)
    const stored = cfgOf(r.state).data as string
    expect(stored).toMatch(/"icon":"sdblob:[a-f0-9]{64}\.png"/)
    expect(stored).toContain('🚀')
    expect(JSON.parse(stored).apps).toHaveLength(2)
    const files = fs.readdirSync(blobDir())
    expect(files).toHaveLength(1)
    expect(fs.readFileSync(path.join(blobDir(), files[0])).equals(bigPng)).toBe(true)
  })

  it('lässt kleine Bilder und fremde Plugins unverändert', () => {
    expect(extractDashboardBlobs(state({ icon: `data:image/png;base64,${smallB64}` })).changed).toBe(false)
    expect(extractDashboardBlobs(state({ icon: `data:image/png;base64,${bigB64}` }, 'scratchpad')).changed).toBe(false)
  })

  it('Rundreise: ausliefern → zurückspeichern ergibt wieder denselben Platzhalter', () => {
    const extracted = extractDashboardBlobs(state({ icon: `data:image/png;base64,${bigB64}` })).state
    const token = cfgOf(extracted).icon as string
    const served = expandDashboardBlobs(extracted, 'http://192.168.1.21:3000')
    const url = cfgOf(served).icon as string
    expect(url).toBe(`http://192.168.1.21:3000/api/dashboard-blob/${token.slice('sdblob:'.length)}`)
    expect(url.startsWith('http')).toBe(true) // Bookmarks erkennt Bilder an data:/http
    const back = extractDashboardBlobs(served)
    expect(cfgOf(back.state).icon).toBe(token)
  })

  it('Platzhalter funktionieren über verschiedene Adressen hinweg', () => {
    const extracted = extractDashboardBlobs(state({ icon: `data:image/png;base64,${bigB64}` })).state
    const viaProxy = expandDashboardBlobs(extracted, 'https://dashboard.example.de')
    expect(cfgOf(extractDashboardBlobs(viaProxy).state).icon).toBe(cfgOf(extracted).icon)
  })
})

describe('requestOrigin', () => {
  it('nutzt Host bzw. X-Forwarded-*', () => {
    expect(requestOrigin(new Request('http://0.0.0.0:3000/x', { headers: { host: '192.168.1.21:3000' } }))).toBe(
      'http://192.168.1.21:3000',
    )
    expect(
      requestOrigin(
        new Request('http://0.0.0.0:3000/x', {
          headers: { host: 'intern', 'x-forwarded-host': 'dash.example.de', 'x-forwarded-proto': 'https' },
        }),
      ),
    ).toBe('https://dash.example.de')
  })
})
