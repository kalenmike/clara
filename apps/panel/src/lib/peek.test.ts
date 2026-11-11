import { describe, expect, it } from 'vitest'
import type { PanelSnapshot } from '@clara/shared-types'
import {
  collectSecrets,
  maskText,
  PEEK_MASK,
  readPeekPreference,
  writePeekPreference,
} from './peek.ts'

describe('maskText', () => {
  it('masks WebSocket URLs and keeps the surrounding text and trailing punctuation', () => {
    expect(maskText('relay online (wss://relay.example.com/room/abc).')).toBe(
      `relay online (wss://${PEEK_MASK}).`
    )
    expect(maskText('local WebSocket listening on ws://192.168.1.5:8788/ws')).toBe(
      `local WebSocket listening on ws://${PEEK_MASK}`
    )
  })

  it('masks an uppercase scheme', () => {
    expect(maskText('WSS://Relay.Example.com/path')).toBe(`WSS://${PEEK_MASK}`)
  })

  it('leaves non-WebSocket URLs alone', () => {
    expect(maskText('panel at http://127.0.0.1:8790/')).toBe('panel at http://127.0.0.1:8790/')
  })

  it('masks exact values longest first', () => {
    const configDir = '/home/me/.config/clara'
    const configPath = `${configDir}/server.json`

    expect(maskText(`pairing config: ${configPath}`, [configDir, configPath])).toBe(
      `pairing config: ${PEEK_MASK}`
    )
  })

  it('masks a host that appears without a scheme', () => {
    expect(maskText('connect ENOTFOUND relay.example.com', ['relay.example.com'])).toBe(
      `connect ENOTFOUND ${PEEK_MASK}`
    )
  })

  it('masks every secret and ignores values too short to be identifying', () => {
    expect(
      maskText('room secret-room on relay.example.com', ['secret-room', 'relay.example.com', 'ws'])
    ).toBe(`room ${PEEK_MASK} on ${PEEK_MASK}`)
  })

  it('leaves ordinary text alone', () => {
    expect(maskText('No activity has been recorded yet.')).toBe(
      'No activity has been recorded yet.'
    )
  })
})

describe('collectSecrets', () => {
  it('collects the harness identity and pending pairing material', () => {
    const secrets = collectSecrets(
      snapshot({
        opencode: { url: 'http://opencode.internal:4096' },
        harnesses: [{ harnessId: 'harness-identity-1234567890' }],
        harnessPairings: [
          {
            code: 'clara-harness1_secret-code',
            wsUrl: 'wss://relay.example/room/secret-room',
          },
        ],
      })
    )

    expect(secrets).toContain('http://opencode.internal:4096')
    expect(secrets).toContain('opencode.internal')
    expect(secrets).toContain('harness-identity-1234567890')
    expect(secrets).toContain('clara-harness1_secret-code')
  })

  it('masks a harness URL and the relay room in free text', () => {
    const secrets = collectSecrets(
      snapshot({
        opencode: { url: 'http://opencode.internal:4096' },
        harnesses: [{ harnessId: 'http://opencode.internal:4096' }],
      })
    )

    expect(maskText('harness http://opencode.internal:4096 failed', secrets)).toBe(
      `harness ${PEEK_MASK} failed`
    )
    expect(maskText('Room room-abc', secrets)).toBe(`Room ${PEEK_MASK}`)
  })

  it('keeps loopback harness hostnames out of the secret list', () => {
    const secrets = collectSecrets(
      snapshot({
        opencode: { url: 'http://127.0.0.1:4096' },
        harnesses: [{ harnessId: 'harness-identity-1234567890' }],
      })
    )

    expect(secrets).toContain('http://127.0.0.1:4096')
    expect(secrets).not.toContain('127.0.0.1')
    expect(secrets).not.toContain('localhost')
  })
})

describe('peek preference', () => {
  it('defaults to masked without a stored choice', () => {
    expect(readPeekPreference(undefined)).toBe('masked')
    expect(readPeekPreference(fakeStorage())).toBe('masked')
    expect(readPeekPreference(fakeStorage({ 'clara.panel.peek': 'nonsense' }))).toBe('masked')
  })

  it('round-trips the tab preference', () => {
    const storage = fakeStorage()

    writePeekPreference(storage, 'shown')
    expect(readPeekPreference(storage)).toBe('shown')

    writePeekPreference(storage, 'masked')
    expect(readPeekPreference(storage)).toBe('masked')
  })

  it('survives storage the browser blocks', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked')
      },
      setItem: (): void => {
        throw new Error('blocked')
      },
    }

    expect(readPeekPreference(blocked)).toBe('masked')
    expect(() => writePeekPreference(blocked, 'shown')).not.toThrow()
  })
})

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

function snapshot(patch: Partial<Record<string, unknown>> = {}): PanelSnapshot {
  return {
    agent: {
      configPath: '/home/me/.config/clara/server.json',
      configDir: '/home/me/.config/clara',
    },
    config: {
      relayUrl: { value: 'wss://relay.example.com' },
      relayRoom: { value: 'room-abc' },
    },
    local: { host: '127.0.0.1', port: 8788, url: 'ws://127.0.0.1:8788' },
    opencode: { url: 'http://127.0.0.1:4096' },
    harnesses: [],
    relay: { url: 'wss://relay.example.com', room: 'room-abc' },
    storage: [],
    clients: [],
    devices: [],
    ...patch,
  } as unknown as PanelSnapshot
}
