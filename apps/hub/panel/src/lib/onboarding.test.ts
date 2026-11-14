import { describe, expect, it } from 'vitest'
import type { PanelSnapshot } from '@clara/shared-types'
import {
  buildSetupState,
  isWebUrlReady,
  readSetupPreferences,
  writeSetupPreferences,
  type SetupPath,
} from './onboarding.ts'

function snapshot(
  overrides: {
    relayStatus?: PanelSnapshot['relay']['status']
    relayConfigured?: boolean
    webUrl?: string
    harnesses?: number
    devices?: Array<{ revokedAt?: string }>
  } = {}
): PanelSnapshot {
  return {
    relay: {
      configured: overrides.relayConfigured ?? false,
      status: overrides.relayStatus ?? 'disabled',
    },
    config: {
      pairingBaseUrl: { value: overrides.webUrl ?? 'http://127.0.0.1:8080', source: 'default' },
    },
    harnesses: Array.from({ length: overrides.harnesses ?? 0 }, (_, index) => ({
      id: `harness-${index}`,
    })),
    devices: overrides.devices ?? [],
  } as unknown as PanelSnapshot
}

describe('setup state', () => {
  it('starts incomplete until a connection path is chosen', () => {
    const state = buildSetupState(snapshot(), undefined)
    expect(state.path).toBeUndefined()
    expect(state.connectionReady).toBe(false)
    expect(state.requiredDone).toBe(false)
    expect(state.progress).toEqual({ done: 0, total: 3 })
    expect(state.current).toBe('connection')
  })

  it('completes the connection step for local without a relay', () => {
    const state = buildSetupState(snapshot(), 'local')
    expect(state.connectionReady).toBe(true)
    expect(state.steps[0]?.done).toBe(true)
  })

  it('requires an online relay and an https web URL for the relay path', () => {
    expect(buildSetupState(snapshot({ relayConfigured: true }), 'relay').connectionReady).toBe(
      false
    )
    expect(
      buildSetupState(
        snapshot({ relayConfigured: true, relayStatus: 'online', webUrl: 'http://clara.example' }),
        'relay'
      ).connectionReady
    ).toBe(false)
    expect(
      buildSetupState(
        snapshot({ relayConfigured: true, relayStatus: 'online', webUrl: 'https://clara.example' }),
        'relay'
      ).connectionReady
    ).toBe(true)
  })

  it('requires a harness and a non-revoked device', () => {
    const state = buildSetupState(
      snapshot({
        relayConfigured: true,
        relayStatus: 'online',
        webUrl: 'https://clara.example',
        harnesses: 1,
        devices: [{ revokedAt: '2026-01-01T00:00:00.000Z' }],
      }),
      'relay'
    )
    expect(state.harnessReady).toBe(true)
    expect(state.clientReady).toBe(false)
    expect(state.progress).toEqual({ done: 2, total: 3 })
    expect(state.current).toBe('client')
  })

  it('reports ready when every required step is done', () => {
    const state = buildSetupState(
      snapshot({
        harnesses: 1,
        devices: [{}, { revokedAt: '2026-01-01T00:00:00.000Z' }],
      }),
      'local'
    )
    expect(state.requiredDone).toBe(true)
    expect(state.progress).toEqual({ done: 3, total: 3 })
    expect(state.current).toBe('ready')
  })

  it('accepts only a public https URL for a remote pairing URL', () => {
    expect(isWebUrlReady('https://clara.example', 'relay')).toBe(true)
    expect(isWebUrlReady('http://clara.example', 'relay')).toBe(false)
    expect(isWebUrlReady('https://127.0.0.1:8080', 'relay')).toBe(false)
    expect(isWebUrlReady('https://localhost', 'relay')).toBe(false)
    expect(isWebUrlReady('not a url', 'relay')).toBe(false)
    expect(isWebUrlReady('http://127.0.0.1:8080', 'local')).toBe(true)
  })
})

describe('setup preferences', () => {
  function storage(): Storage {
    const values = new Map<string, string>()
    return {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    }
  }

  it('round-trips the path and completion timestamps', () => {
    const target = storage()
    const path: SetupPath = 'relay'
    writeSetupPreferences(target, {
      path,
      dismissedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-02T00:00:00.000Z',
      guideSeenAt: '2026-01-03T00:00:00.000Z',
    })
    expect(readSetupPreferences(target)).toEqual({
      path,
      dismissedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-02T00:00:00.000Z',
      guideSeenAt: '2026-01-03T00:00:00.000Z',
    })
  })

  it('ignores malformed or unknown values', () => {
    const target = storage()
    target.setItem('clara.panel.setup', '{not json')
    expect(readSetupPreferences(target)).toEqual({})
    target.setItem('clara.panel.setup', JSON.stringify({ path: 'elsewhere' }))
    expect(readSetupPreferences(target)).toEqual({})
  })
})
