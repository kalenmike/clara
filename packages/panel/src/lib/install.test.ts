import { describe, expect, it } from 'vitest'
import type { PanelInstallInfo } from '@clara/shared-types'
import {
  adapterRepairCommand,
  installManifest,
  installOffered,
  latestAdapterVersion,
  registryCommand,
  registryError,
  repoCommand,
  supportedPlatforms,
} from './install.ts'

const info: PanelInstallInfo = {
  enabled: true,
  available: true,
  registry: {
    baseUrl: 'https://clara.example/adapters',
    source: 'default',
    entries: [
      {
        kind: 'opencode',
        manifestUrl: 'https://clara.example/adapters/opencode/manifest.json',
        ok: true,
        checkedAt: new Date(0).toISOString(),
        manifest: {
          schemaVersion: 1,
          harness: 'opencode',
          version: '0.1.0-dev+abc1234',
          install: 'https://clara.example/adapters/opencode/install.sh',
          installSha256: 'a'.repeat(64),
          artifacts: {
            'linux-x64': {
              url: 'https://example.com/opencode.tar.gz',
              sha256: 'a'.repeat(64),
            },
          },
        },
      },
      {
        kind: 'claude',
        manifestUrl: 'https://clara.example/adapters/claude/manifest.json',
        ok: false,
        checkedAt: new Date(0).toISOString(),
        error: 'missing',
      },
    ],
  },
}

describe('install panel helpers', () => {
  it('finds a manifest and its platforms', () => {
    expect(installManifest(info, 'opencode')?.version).toBe('0.1.0-dev+abc1234')
    expect(supportedPlatforms(installManifest(info, 'opencode'))).toEqual(['linux-x64'])
    expect(installManifest(info, 'claude')).toBeUndefined()
    expect(registryError(info, 'claude')).toBe('missing')
  })

  it('builds the registry command with the runner enabled', () => {
    expect(registryCommand(info, 'opencode', 'code')).toBe(
      "curl -fsSL https://clara.example/adapters/opencode/install.sh | CLARA_ADAPTER_REGISTRY_URL='https://clara.example/adapters' sh -s -- --pair code"
    )
    expect(registryCommand(info, 'claude', 'code')).toBeUndefined()
  })

  it('builds a repair command that reuses the saved pairing', () => {
    expect(adapterRepairCommand(info, 'opencode')).toBe(
      "curl -fsSL https://clara.example/adapters/opencode/install.sh | CLARA_ADAPTER_REGISTRY_URL='https://clara.example/adapters' sh -s -- --reuse-pairing"
    )
    expect(latestAdapterVersion(info, 'opencode')).toBe('0.1.0-dev+abc1234')
  })

  it('keeps the repository command as a fallback', () => {
    expect(repoCommand('claude', 'code')).toBe('clara adapter install claude --pair code')
  })

  it('offers setup only when the hub can share a command', () => {
    expect(installOffered(info)).toBe(true)
    expect(installOffered(undefined)).toBe(false)
    expect(installOffered({ ...info, enabled: false })).toBe(false)
    expect(
      installOffered({
        ...info,
        available: false,
        reason: 'Adapter setup is off.',
      })
    ).toBe(false)
  })
})
