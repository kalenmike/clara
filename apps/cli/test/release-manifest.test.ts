import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseManifest,
  verifyManifestSignature,
  type ReleaseManifest,
} from '../src/release/manifest.ts'

const keyPair = generateKeyPairSync('ed25519')
const privateKey = keyPair.privateKey
const publicPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()

function manifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    schemaVersion: 1,
    version: '0.2.0',
    channel: 'stable',
    publishedAt: '2026-11-15T00:00:00.000Z',
    artifacts: {
      'linux-x64': {
        url: 'https://example.test/clara-linux-x64.tar.gz',
        sha256: 'a'.repeat(64),
        size: 10,
      },
    },
    ...overrides,
  }
}

describe('release manifest', () => {
  it('accepts a well-formed manifest', () => {
    const value = parseManifest(Buffer.from(JSON.stringify(manifest())))
    expect(value.version).toBe('0.2.0')
    expect(value.artifacts['linux-x64']?.size).toBe(10)
  })

  it('rejects unknown schemas, versions, and insecure URLs', () => {
    expect(() =>
      parseManifest(Buffer.from(JSON.stringify({ ...manifest(), schemaVersion: 2 })))
    ).toThrow()
    expect(() =>
      parseManifest(Buffer.from(JSON.stringify(manifest({ version: 'latest' }))))
    ).toThrow()
    expect(() =>
      parseManifest(
        Buffer.from(
          JSON.stringify(
            manifest({
              artifacts: {
                'linux-x64': { url: 'http://example.test/a', sha256: 'a'.repeat(64), size: 10 },
              },
            })
          )
        )
      )
    ).toThrow()
    expect(() =>
      parseManifest(
        Buffer.from(
          JSON.stringify(
            manifest({
              artifacts: {
                'linux-x64': { url: 'http://example.test/a', sha256: 'a'.repeat(64), size: 10 },
              },
            })
          )
        ),
        { allowInsecure: true }
      )
    ).not.toThrow()
  })

  it('verifies an Ed25519 signature over the exact bytes', () => {
    const bytes = Buffer.from(JSON.stringify(manifest()))
    const signature = sign(null, bytes, privateKey)
    expect(verifyManifestSignature(bytes, signature, publicPem)).toBe(true)
    expect(verifyManifestSignature(Buffer.from(`${bytes} `), signature, publicPem)).toBe(false)
    expect(verifyManifestSignature(bytes, signature, 'not-a-key')).toBe(false)
  })
})
