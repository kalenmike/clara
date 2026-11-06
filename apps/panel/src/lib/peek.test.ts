import { describe, expect, it } from 'vitest'
import { maskText, PEEK_MASK, readPeekPreference, writePeekPreference } from './peek.ts'

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
