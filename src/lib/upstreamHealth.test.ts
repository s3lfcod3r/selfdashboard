import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type FakeSocket = EventEmitter & { setTimeout: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
const sockets: Array<{ opts: { host: string; port: number }; socket: FakeSocket }> = []

vi.mock('node:net', () => {
  const connect = (opts: { host: string; port: number }) => {
    const socket = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() }) as FakeSocket
    sockets.push({ opts, socket })
    return socket
  }
  return { default: { connect }, connect }
})

import { assertUpstreamHostUp, noteUpstreamError, noteUpstreamOk, UpstreamHostDownError } from './upstreamHealth'

function fetchFailed(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })
}

describe('upstreamHealth', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__sdUpstreamHealth
    sockets.length = 0
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('unbekannter Host ist up', () => {
    expect(() => assertUpstreamHostUp('http://192.168.1.103:8085/metrics')).not.toThrow()
  })

  it('EHOSTUNREACH markiert den ganzen Host (alle Ports) als offline', () => {
    noteUpstreamError('http://192.168.1.103:8085/metrics', fetchFailed('EHOSTUNREACH'))
    expect(() => assertUpstreamHostUp('http://192.168.1.103:3000/')).toThrow(UpstreamHostDownError)
    expect(() => assertUpstreamHostUp('http://192.168.1.80:8086/')).not.toThrow()
  })

  it('ECONNREFUSED und andere Fehler markieren nicht', () => {
    noteUpstreamError('http://192.168.1.10:8097/status', fetchFailed('ECONNREFUSED'))
    noteUpstreamError('http://192.168.1.10:8097/status', new Error('boom'))
    expect(() => assertUpstreamHostUp('http://192.168.1.10:8097/status')).not.toThrow()
  })

  it('node-fetch-Fehler (err.code direkt) werden erkannt', () => {
    noteUpstreamError('http://192.168.1.80:8086/', Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))
    expect(() => assertUpstreamHostUp('http://192.168.1.80:8086/')).toThrow(UpstreamHostDownError)
  })

  it('Probe läuft im Hintergrund — die Anfrage selbst wird trotzdem sofort abgelehnt', () => {
    noteUpstreamError('http://10.0.0.5:8086/', fetchFailed('EHOSTUNREACH'))
    expect(() => assertUpstreamHostUp('http://10.0.0.5:8086/')).toThrow()
    expect(sockets).toHaveLength(0)
    vi.advanceTimersByTime(15_000)
    expect(() => assertUpstreamHostUp('http://10.0.0.5:8086/')).toThrow()
    expect(sockets).toHaveLength(1)
    expect(sockets[0].opts).toEqual({ host: '10.0.0.5', port: 8086 })
    // Während die Probe läuft, keine zweite.
    expect(() => assertUpstreamHostUp('http://10.0.0.5:8086/')).toThrow()
    expect(sockets).toHaveLength(1)
  })

  it('erfolgreiche Probe (connect) hebt die Sperre auf', () => {
    noteUpstreamError('http://10.0.0.5/', fetchFailed('EHOSTUNREACH'))
    vi.advanceTimersByTime(15_000)
    expect(() => assertUpstreamHostUp('http://10.0.0.5/')).toThrow()
    sockets[0].socket.emit('connect')
    expect(sockets[0].socket.destroy).toHaveBeenCalled()
    expect(() => assertUpstreamHostUp('http://10.0.0.5/')).not.toThrow()
  })

  it('Probe mit ECONNREFUSED zählt als erreichbar', () => {
    noteUpstreamError('http://10.0.0.5/', fetchFailed('EHOSTUNREACH'))
    vi.advanceTimersByTime(15_000)
    expect(() => assertUpstreamHostUp('http://10.0.0.5/')).toThrow()
    sockets[0].socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
    expect(() => assertUpstreamHostUp('http://10.0.0.5/')).not.toThrow()
  })

  it('fehlgeschlagene Probe hält die Sperre; nächste Probe erst nach 15 s', () => {
    noteUpstreamError('http://10.0.0.5/', fetchFailed('EHOSTUNREACH'))
    vi.advanceTimersByTime(15_000)
    expect(() => assertUpstreamHostUp('http://10.0.0.5/')).toThrow()
    sockets[0].socket.emit('error', Object.assign(new Error('x'), { code: 'EHOSTUNREACH' }))
    vi.advanceTimersByTime(60_000)
    expect(() => assertUpstreamHostUp('http://10.0.0.5/')).toThrow()
    expect(sockets).toHaveLength(2)
    sockets[1].socket.emit('timeout')
    expect(() => assertUpstreamHostUp('http://10.0.0.5/')).toThrow()
    expect(sockets).toHaveLength(2)
  })

  it('erfolgreiche Antwort hebt die Sperre auf', () => {
    noteUpstreamError('http://10.0.0.5/', fetchFailed('EHOSTUNREACH'))
    noteUpstreamOk('http://10.0.0.5/other')
    expect(() => assertUpstreamHostUp('http://10.0.0.5/')).not.toThrow()
  })
})
