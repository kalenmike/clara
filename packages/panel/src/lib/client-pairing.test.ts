import { describe, expect, it } from 'vitest'
import {
  canStartPairing,
  pairingNotice,
  resolvePairingTransport,
  type PairingTransportState,
} from './client-pairing.ts'

function state(patch: Partial<PairingTransportState> = {}): PairingTransportState {
  return {
    allowed: ['relay', 'local'],
    relayUsable: true,
    localUsable: true,
    stopped: false,
    ...patch,
  }
}

describe('resolvePairingTransport', () => {
  it('keeps the requested transport when it is usable', () => {
    expect(resolvePairingTransport(state({ initial: 'local' }))).toBe('local')
    expect(resolvePairingTransport(state({ initial: 'relay' }))).toBe('relay')
  })

  it('falls back to local when the requested relay is unavailable', () => {
    expect(
      resolvePairingTransport(state({ initial: 'relay', relayUsable: false, localUsable: true }))
    ).toBe('local')
  })

  it('falls back to relay when local is unavailable', () => {
    expect(
      resolvePairingTransport(state({ initial: 'local', relayUsable: true, localUsable: false }))
    ).toBe('relay')
  })

  it('honours a local-only transport list', () => {
    expect(
      resolvePairingTransport(state({ allowed: ['local'], initial: 'relay', relayUsable: true }))
    ).toBe('local')
  })

  it('keeps the requested transport when neither is usable', () => {
    expect(
      resolvePairingTransport(state({ initial: 'relay', relayUsable: false, localUsable: false }))
    ).toBe('relay')
  })
})

describe('canStartPairing', () => {
  it('requires an allowed usable transport', () => {
    expect(canStartPairing(state())).toBe(true)
    expect(canStartPairing(state({ stopped: true }))).toBe(false)
    expect(canStartPairing(state({ allowed: ['local'], localUsable: false }))).toBe(false)
    expect(canStartPairing(state({ allowed: ['relay'], relayUsable: false }))).toBe(false)
  })
})

describe('pairingNotice', () => {
  it('is absent when a transport can pair', () => {
    expect(pairingNotice(state())).toBeUndefined()
  })

  it('names a stopped hub', () => {
    expect(pairingNotice(state({ stopped: true }))).toContain('External connections are off')
  })

  it('names a disabled local-only step', () => {
    expect(pairingNotice(state({ allowed: ['local'], localUsable: false }))).toContain(
      'Local transport is off'
    )
  })

  it('names an unavailable relay-only step', () => {
    expect(pairingNotice(state({ allowed: ['relay'], relayUsable: false }))).toContain(
      'Relay pairing is unavailable'
    )
  })

  it('names both transports being unavailable', () => {
    expect(pairingNotice(state({ relayUsable: false, localUsable: false }))).toContain(
      'Local and relay pairing are unavailable'
    )
  })
})
