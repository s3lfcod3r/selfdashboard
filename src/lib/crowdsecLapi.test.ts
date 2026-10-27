import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

import { crowdsecUnbanIp, resetCrowdsecLapiTokenCache } from '../../plugins-pack/crowdsec/lib/crowdsecLapi'

type Call = { method: string; url: string; auth?: string; ua?: string; body?: unknown }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('crowdsecLapi', () => {
  let calls: Call[]
  let loginStatus: number
  let expireOnce: boolean

  beforeEach(() => {
    calls = []
    loginStatus = 200
    expireOnce = false
    resetCrowdsecLapiTokenCache()
    vi.stubEnv('CROWDSEC_LAPI_URL', 'http://192.168.1.7:8080/')
    vi.stubEnv('CROWDSEC_LAPI_MACHINE_ID', 'selfdashboard')
    vi.stubEnv('CROWDSEC_LAPI_PASSWORD', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const headers = (init.headers ?? {}) as Record<string, string>
        const call: Call = {
          method: init.method ?? 'GET',
          url,
          auth: headers.Authorization,
          ua: headers['User-Agent'],
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        }
        calls.push(call)
        if (url.endsWith('/v1/watchers/login')) {
          return loginStatus === 200
            ? jsonResponse(200, { code: 200, expire: 'x', token: `tok${calls.length}` })
            : jsonResponse(loginStatus, { message: 'incorrect Username or Password' })
        }
        if (expireOnce) {
          expireOnce = false
          return jsonResponse(401, { message: 'token expired' })
        }
        if (url.includes('/v1/alerts')) return jsonResponse(403, { message: 'access forbidden from this IP' })
        return jsonResponse(200, { nbDeleted: '2' })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('logs in as machine and deletes decisions + alerts for the IP', async () => {
    await expect(crowdsecUnbanIp(' 2001:db8::1 ')).resolves.toEqual({ deleted: 2 })
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST http://192.168.1.7:8080/v1/watchers/login',
      'DELETE http://192.168.1.7:8080/v1/decisions?ip=2001%3Adb8%3A%3A1',
      'DELETE http://192.168.1.7:8080/v1/alerts?ip=2001%3Adb8%3A%3A1',
    ])
    expect(calls[0].body).toEqual({ machine_id: 'selfdashboard', password: 'secret', scenarios: [] })
    expect(calls[1].auth).toBe('Bearer tok1')
    // CrowdSec 1.8 lehnt Logins ohne "name/version" im User-Agent ab
    expect(calls[0].ua).toMatch(/^[\w.-]+\/\d+\.\d+/)
  })

  it('reuses the token and logs in again after a 401', async () => {
    await crowdsecUnbanIp('1.2.3.4')
    await crowdsecUnbanIp('1.2.3.5')
    expect(calls.filter((c) => c.url.endsWith('/login'))).toHaveLength(1)
    expireOnce = true
    await expect(crowdsecUnbanIp('1.2.3.6')).resolves.toEqual({ deleted: 2 })
    expect(calls.filter((c) => c.url.endsWith('/login'))).toHaveLength(2)
  })

  it('reports missing credentials without calling the LAPI', async () => {
    vi.stubEnv('CROWDSEC_LAPI_PASSWORD', '')
    await expect(crowdsecUnbanIp('1.2.3.4')).rejects.toThrow('lapi_credentials_missing')
    expect(calls).toHaveLength(0)
  })

  it('reports a rejected login', async () => {
    loginStatus = 401
    await expect(crowdsecUnbanIp('1.2.3.4')).rejects.toThrow('lapi_login_failed')
  })

  it('reports an unreachable LAPI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(crowdsecUnbanIp('1.2.3.4')).rejects.toThrow('lapi_unreachable')
  })

  it('rejects invalid IPs', async () => {
    await expect(crowdsecUnbanIp('1.2.3.4; rm -rf /')).rejects.toThrow('invalid_ip')
    await expect(crowdsecUnbanIp('')).rejects.toThrow('invalid_ip')
    expect(calls).toHaveLength(0)
  })
})
