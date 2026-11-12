import { describe, expect, it } from 'vitest'
import {
  HARNESS_PAIRING_CODE_PREFIX,
  PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  encodeHarnessPairingCode,
  encodePairingCode,
  type HarnessPairingPayload,
  type PairingPayload,
} from '@clara/shared-types'
import { pairingInputError } from './pairing'

const browserPairing: PairingPayload = {
  v: PROTOCOL_VERSION,
  wsUrl: 'ws://127.0.0.1:8788/ws',
  room: 'local',
  clientToken: 'local',
  enrollId: 'enroll',
  enrollToken: 'token',
  fingerprint: 'AB12-CD34',
  expiresAt: Date.now() + 60_000,
}

const adapterPairing: HarnessPairingPayload = {
  v: PROTOCOL_VERSION,
  role: 'adapter',
  kind: 'opencode',
  wsUrl: 'ws://server:8788/ws',
  room: 'local',
  clientToken: 'local',
  enrollId: 'enroll',
  enrollToken: 'token',
  fingerprint: 'AB12-CD34',
  expiresAt: Date.now() + 60_000,
}

describe('pairingInputError', () => {
  it('accepts a browser pairing code', () => {
    expect(pairingInputError(`${PAIRING_CODE_PREFIX}${encodePairingCode(browserPairing)}`)).toBe('')
  })

  it('names an adapter pairing code instead of reporting random text', () => {
    const code = `${HARNESS_PAIRING_CODE_PREFIX}${encodeHarnessPairingCode(adapterPairing)}`
    const error = pairingInputError(code)
    expect(error).toContain('harness adapter pairing code')
    expect(error).toContain('pnpm clara adapter install --opencode')
  })

  it('uses the adapter kind in the install command', () => {
    const code = `${HARNESS_PAIRING_CODE_PREFIX}${encodeHarnessPairingCode({
      ...adapterPairing,
      kind: 'pi',
    })}`
    expect(pairingInputError(code)).toContain('pnpm clara adapter install --pi')
  })

  it('explains the browser code prefix for other input', () => {
    expect(pairingInputError('not-a-code')).toContain('Browser pairing codes start with clara1_')
  })
})
