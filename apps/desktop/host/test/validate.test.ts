import { describe, expect, it } from 'vitest'
import {
  HARNESS_PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  encodeHarnessPairingCode,
  type PanelInstallManifest,
} from '@clara/shared-types'
import { parseInstallRequest } from '../src/validate.ts'

const manifest: PanelInstallManifest = {
  schemaVersion: 1,
  harness: 'claude',
  version: '0.1.0',
  install: 'https://clara.example/adapters/claude/install.sh',
  installSha256: 'a'.repeat(64),
  artifacts: {},
}

function code(kind = 'claude'): string {
  return `${HARNESS_PAIRING_CODE_PREFIX}${encodeHarnessPairingCode({
    v: PROTOCOL_VERSION,
    role: 'adapter',
    kind,
    wsUrl: 'wss://relay.example/room/room',
    room: 'room',
    enrollId: 'id',
    enrollToken: 'token',
    grant: 'grant',
    fingerprint: 'fp',
    expiresAt: Date.now() + 60_000,
  })}`
}

describe('parseInstallRequest', () => {
  it('accepts a local install with a matching code', () => {
    expect(
      parseInstallRequest({
        kind: 'claude',
        method: 'local',
        pairingCode: code(),
        manifest,
      })
    ).toMatchObject({ kind: 'claude', method: 'local' })
  })

  it('rejects a code for another harness', () => {
    expect(() =>
      parseInstallRequest({
        kind: 'claude',
        method: 'local',
        pairingCode: code('opencode'),
        manifest,
      })
    ).toThrow(/not for claude/)
  })

  it('rejects an invalid manifest and method', () => {
    expect(() =>
      parseInstallRequest({
        kind: 'claude',
        method: 'local',
        pairingCode: code(),
        manifest: { ...manifest, install: 'http://insecure.example/install.sh' },
      })
    ).toThrow(/manifest/)
    expect(() =>
      parseInstallRequest({
        kind: 'claude',
        method: 'usb',
        pairingCode: code(),
        manifest,
      })
    ).toThrow(/local, SSH, or Docker/)
  })
})
