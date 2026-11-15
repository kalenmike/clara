import { describe, expect, it, vi } from 'vitest'
import {
  HARNESS_PAIRING_CODE_PREFIX,
  PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  buildPairingUrl,
  encodeHarnessPairingCode,
  encodePairingCode,
  type HarnessPairingPayload,
  type PairingPayload,
} from '@clara/shared-types'
import { pairingGrantError, pairingInputError } from './pairing'

const browserPairing: PairingPayload = {
  v: PROTOCOL_VERSION,
  wsUrl: 'ws://127.0.0.1:8788/ws',
  room: 'local',
  enrollId: 'enroll',
  enrollToken: 'token',
  fingerprint: 'AB12-CD34',
  expiresAt: Date.now() + 60_000,
}

const relayPairing: PairingPayload = {
  ...browserPairing,
  wsUrl: 'wss://relay.example/room/room-1',
  room: 'room-1',
  grant: 'encoded.signature',
}

const adapterPairing: HarnessPairingPayload = {
  v: PROTOCOL_VERSION,
  role: 'adapter',
  kind: 'opencode',
  wsUrl: 'ws://server:8788/ws',
  room: 'local',
  enrollId: 'enroll',
  enrollToken: 'token',
  fingerprint: 'AB12-CD34',
  expiresAt: Date.now() + 60_000,
}

describe('pairingInputError', () => {
  it('accepts a browser pairing code', () => {
    expect(pairingInputError(`${PAIRING_CODE_PREFIX}${encodePairingCode(browserPairing)}`)).toBe('')
  })

  it('accepts a relay pairing code that carries an enrollment grant', () => {
    expect(pairingInputError(`${PAIRING_CODE_PREFIX}${encodePairingCode(relayPairing)}`)).toBe('')
  })

  it('rejects a relay pairing code without a grant', () => {
    const withoutGrant: PairingPayload = { ...relayPairing, grant: undefined }
    expect(pairingInputError(`${PAIRING_CODE_PREFIX}${encodePairingCode(withoutGrant)}`)).not.toBe(
      ''
    )
    const error = pairingGrantError(withoutGrant)
    expect(error).toContain('no enrollment grant')
    expect(error).toContain('pair again')
  })

  it('ignores a leftover client token field', () => {
    // Older codes may still carry the retired field. The web ignores it and
    // accepts the code on its enrollment grant alone.
    const legacy = { ...relayPairing, clientToken: 'retired-value' } as unknown as PairingPayload
    expect(pairingInputError(`${PAIRING_CODE_PREFIX}${encodePairingCode(legacy)}`)).toBe('')
  })

  it('does not require a grant for a local pairing code', () => {
    expect(pairingInputError(`${PAIRING_CODE_PREFIX}${encodePairingCode(browserPairing)}`)).toBe('')
  })

  it('names an adapter pairing code instead of reporting random text', () => {
    const code = `${HARNESS_PAIRING_CODE_PREFIX}${encodeHarnessPairingCode(adapterPairing)}`
    const error = pairingInputError(code)
    expect(error).toContain('harness adapter pairing code')
    expect(error).toContain('clara adapter install opencode --pair')
  })

  it('uses the adapter kind in the install command', () => {
    const code = `${HARNESS_PAIRING_CODE_PREFIX}${encodeHarnessPairingCode({
      ...adapterPairing,
      kind: 'pi',
    })}`
    expect(pairingInputError(code)).toContain('clara adapter install pi --pair')
  })

  it('explains the browser code prefix for other input', () => {
    expect(pairingInputError('not-a-code')).toContain('Browser pairing codes start with clara1_')
  })
})

describe('capturePairingLink', () => {
  it('accepts a pairing URL from outside the address bar without rewriting it', async () => {
    vi.resetModules()
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      location: { href: 'clara://pair', pathname: '/', search: '' },
      history: { replaceState },
    })

    const { capturePairingLink, takePairingLink } = await import('./pairing')
    capturePairingLink(buildPairingUrl('https://clara.example/connect', browserPairing))

    expect(takePairingLink()).toMatchObject({ enrollId: 'enroll', room: 'local' })
    expect(replaceState).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('strips the pairing fragment from the page URL', async () => {
    vi.resetModules()
    const replaceState = vi.fn()
    const link = buildPairingUrl('https://clara.example/connect', browserPairing)
    vi.stubGlobal('window', {
      location: {
        href: link,
        pathname: '/connect',
        search: '?from=qr',
      },
      history: { replaceState },
    })

    const { capturePairingLink, takePairingLink } = await import('./pairing')
    capturePairingLink()

    expect(takePairingLink()).toMatchObject({ enrollId: 'enroll' })
    expect(replaceState).toHaveBeenCalledWith(null, '', '/connect?from=qr')
    vi.unstubAllGlobals()
  })
})
