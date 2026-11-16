import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseManifest, verifyManifestSignature } from '../src/manifest.ts'

const keyPair = generateKeyPairSync('ed25519')
const privateKey = keyPair.privateKey
const publicPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()

function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    channel: 'stable',
    generatedAt: '2026-11-15T00:00:00.000Z',
    cli: {
      version: '0.2.0',
      tag: 'v0.2.0',
      publishedAt: '2026-11-15T00:00:00.000Z',
      artifacts: {
        'linux-x64': {
          url: 'https://example.test/clara-linux-x64.tar.gz',
          sha256: 'a'.repeat(64),
          size: 10,
        },
      },
    },
    desktop: {
      version: '0.2.0',
      tag: 'desktop-v0.2.0',
      publishedAt: '2026-11-15T00:00:00.000Z',
      artifacts: {
        'linux-x64': {
          url: 'https://example.test/clara-desktop-linux-x64.AppImage',
          sha256: 'b'.repeat(64),
          size: 20,
          type: 'appimage',
        },
      },
    },
    ...overrides,
  }
}

function parse(value: Record<string, unknown>) {
  return parseManifest(Buffer.from(JSON.stringify(value)))
}

describe('release manifest', () => {
  it('accepts a nested component manifest and normalizes the CLI fields', () => {
    const value = parse(wire())
    expect(value.version).toBe('0.2.0')
    expect(value.artifacts['linux-x64']?.size).toBe(10)
    expect(value.desktop?.version).toBe('0.2.0')
    expect(value.desktop?.artifacts['linux-x64']?.type).toBe('appimage')
  })

  it('rejects unknown schemas, versions, and insecure URLs', () => {
    expect(() => parse(wire({ schemaVersion: 1 }))).toThrow()
    expect(() =>
      parse(wire({ cli: { version: 'latest', publishedAt: '', artifacts: {} } }))
    ).toThrow()
    expect(() =>
      parse(
        wire({
          cli: {
            version: '0.2.0',
            publishedAt: '2026-11-15T00:00:00.000Z',
            artifacts: {
              'linux-x64': { url: 'http://example.test/a', sha256: 'a'.repeat(64), size: 10 },
            },
          },
        })
      )
    ).toThrow()
    expect(() =>
      parseManifest(
        Buffer.from(
          JSON.stringify(
            wire({
              cli: {
                version: '0.2.0',
                publishedAt: '2026-11-15T00:00:00.000Z',
                artifacts: {
                  'linux-x64': { url: 'http://example.test/a', sha256: 'a'.repeat(64), size: 10 },
                },
              },
            })
          )
        ),
        { allowInsecure: true }
      )
    ).not.toThrow()
  })

  it('rejects an invalid desktop type and accepts a missing desktop block', () => {
    expect(() =>
      parse(
        wire({
          desktop: {
            version: '0.2.0',
            publishedAt: '2026-11-15T00:00:00.000Z',
            artifacts: {
              'linux-x64': {
                url: 'https://example.test/a',
                sha256: 'b'.repeat(64),
                size: 20,
                type: 'exe',
              },
            },
          },
        })
      )
    ).toThrow()
    const value = parse(wire({ desktop: undefined }))
    expect(value.desktop).toBeUndefined()
  })

  it('verifies an Ed25519 signature over the exact bytes', () => {
    const bytes = Buffer.from(JSON.stringify(wire()))
    const signature = sign(null, bytes, privateKey)
    expect(verifyManifestSignature(bytes, signature, publicPem)).toBe(true)
    expect(verifyManifestSignature(Buffer.from(`${bytes} `), signature, publicPem)).toBe(false)
    expect(verifyManifestSignature(bytes, signature, 'not-a-key')).toBe(false)
  })
})
