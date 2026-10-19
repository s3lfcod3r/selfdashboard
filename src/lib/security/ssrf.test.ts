import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: actual,
    lookup: vi.fn(),
  }
})

import {
  assertSafeOutboundUrl,
  assertSafeOutboundUrlResolved,
  UnsafeOutboundUrlError,
} from './ssrf'
import { lookup } from 'node:dns/promises'

describe('assertSafeOutboundUrl (static)', () => {
  it('lässt http/https durch', () => {
    expect(() => assertSafeOutboundUrl('http://example.com')).not.toThrow()
    expect(() => assertSafeOutboundUrl('https://example.com/path?q=1')).not.toThrow()
  })

  it('blockt unsupported protocols', () => {
    expect(() => assertSafeOutboundUrl('ftp://example.com')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertSafeOutboundUrl('file:///etc/passwd')).toThrow(UnsafeOutboundUrlError)
  })

  it('blockt loopback IPs (127.x, ::1)', () => {
    expect(() => assertSafeOutboundUrl('http://127.0.0.1:8080')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertSafeOutboundUrl('http://127.1.2.3')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertSafeOutboundUrl('http://[::1]:8080')).toThrow(UnsafeOutboundUrlError)
  })

  it('blockt link-local (169.254.x, fe80:) und 0.x', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertSafeOutboundUrl('http://[fe80::1]:8080')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertSafeOutboundUrl('http://0.0.0.0')).toThrow(UnsafeOutboundUrlError)
  })

  it('blockt .local / .internal Hostnames', () => {
    expect(() => assertSafeOutboundUrl('http://host.local')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertSafeOutboundUrl('http://host.internal')).toThrow(UnsafeOutboundUrlError)
  })

  it('blockt .localhost Suffix', () => {
    expect(() => assertSafeOutboundUrl('http://foo.localhost')).toThrow(UnsafeOutboundUrlError)
  })

  it('blockt metadata-hostnames', () => {
    expect(() => assertSafeOutboundUrl('http://metadata.google.internal')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertSafeOutboundUrl('http://instance-data')).toThrow(UnsafeOutboundUrlError)
  })

  it('blockt IPv4-mapped IPv6 mit eingebettetem loopback (hex)', () => {
    expect(() => assertSafeOutboundUrl('http://[::ffff:7f00:1]:8080')).toThrow(UnsafeOutboundUrlError)
  })

  it('blockt IPv4-mapped IPv6 mit eingebettetem loopback (dotted)', () => {
    expect(() => assertSafeOutboundUrl('http://[::ffff:127.0.0.1]:8080')).toThrow(UnsafeOutboundUrlError)
  })

  it('lässt öffentliche IPs durch', () => {
    expect(() => assertSafeOutboundUrl('http://8.8.8.8')).not.toThrow()
    expect(() => assertSafeOutboundUrl('http://93.184.216.34')).not.toThrow()
  })

  it('blockt private LAN IPs (10/8, 172.16/12, 192.168/16)', () => {
    expect(() => assertSafeOutboundUrl('http://10.0.0.1')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertSafeOutboundUrl('http://172.16.5.5')).toThrow(UnsafeOutboundUrlError)
    expect(() => assertSafeOutboundUrl('http://192.168.1.1')).toThrow(UnsafeOutboundUrlError)
  })

  it('lässt private IPs durch wenn SELFDASHBOARD_ALLOW_PRIVATE_URLS=1', () => {
    const old = process.env.SELFDASHBOARD_ALLOW_PRIVATE_URLS
    process.env.SELFDASHBOARD_ALLOW_PRIVATE_URLS = '1'
    try {
      expect(() => assertSafeOutboundUrl('http://10.0.0.1')).not.toThrow()
      expect(() => assertSafeOutboundUrl('http://192.168.1.1')).not.toThrow()
    } finally {
      process.env.SELFDASHBOARD_ALLOW_PRIVATE_URLS = old
    }
  })
})

describe('assertSafeOutboundUrlResolved (DNS)', () => {
  beforeEach(() => {
    (lookup as vi.Mock).mockClear()
  })

  it('blockt wenn DNS auf loopback auflöst', async () => {
    (lookup as vi.Mock).mockResolvedValue([{ address: '127.0.0.1' }])
    await expect(
      assertSafeOutboundUrlResolved('http://example.com'),
    ).rejects.toThrow(UnsafeOutboundUrlError)
  })

  it('blockt wenn DNS auf private IP auflöst', async () => {
    (lookup as vi.Mock).mockResolvedValue([{ address: '10.0.0.1' }])
    await expect(
      assertSafeOutboundUrlResolved('http://example.com'),
    ).rejects.toThrow(UnsafeOutboundUrlError)
  })

  it('blockt wenn DNS fehlschlägt', async () => {
    (lookup as vi.Mock).mockRejectedValue(new Error('ENOTFOUND'))
    await expect(
      assertSafeOutboundUrlResolved('http://example.com'),
    ).rejects.toThrow(UnsafeOutboundUrlError)
  })

  it('lässt durch wenn DNS auf öffentliche IP auflöst', async () => {
    (lookup as vi.Mock).mockResolvedValue([{ address: '93.184.216.34' }])
    await expect(
      assertSafeOutboundUrlResolved('http://example.com'),
    ).resolves.not.toThrow()
  })

  it('blockt wenn eine der auflösenden IPs blockiert ist', async () => {
    (lookup as vi.Mock).mockResolvedValue([{ address: '93.184.216.34' }, { address: '127.0.0.1' }])
    await expect(
      assertSafeOutboundUrlResolved('http://example.com'),
    ).rejects.toThrow(UnsafeOutboundUrlError)
  })

  it('spricht literal IPs nicht erneut ab (keine DNS-Lookup)', async () => {
    (lookup as vi.Mock).mockResolvedValue([{ address: '93.184.216.34' }])
    await expect(
      assertSafeOutboundUrlResolved('http://8.8.8.8'),
    ).resolves.not.toThrow()
    expect(lookup).not.toHaveBeenCalled()
  })
})
