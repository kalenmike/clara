import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveRelayWsUrl } from './client'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveRelayWsUrl', () => {
  it('uses the pairing URL when no deployment endpoint is configured', () => {
    vi.stubEnv('VITE_CLARA_WS_URL', '')
    expect(resolveRelayWsUrl('ws://127.0.0.1:8788/ws', 'local')).toBe('ws://127.0.0.1:8788/ws')
    expect(resolveRelayWsUrl('wss://relay.example/room/abc', 'abc')).toBe(
      'wss://relay.example/room/abc'
    )
  })

  it('keeps a local pairing on its own endpoint even with a relay deployment', () => {
    vi.stubEnv('VITE_CLARA_WS_URL', 'wss://relay.example')
    expect(resolveRelayWsUrl('ws://127.0.0.1:8788/ws', 'local')).toBe('ws://127.0.0.1:8788/ws')
  })

  it('builds the relay room URL from the deployment endpoint', () => {
    vi.stubEnv('VITE_CLARA_WS_URL', 'wss://relay.example/')
    expect(resolveRelayWsUrl('wss://ignored/room/abc', 'room-1')).toBe(
      'wss://relay.example/room/room-1'
    )
  })

  it('keeps an explicit room path and drops the query', () => {
    vi.stubEnv('VITE_CLARA_WS_URL', 'wss://relay.example/base/room/other?token=1')
    expect(resolveRelayWsUrl('wss://ignored/room/abc', 'abc')).toBe(
      'wss://relay.example/base/room/other'
    )
  })
})
