import { afterEach, describe, expect, it } from 'vitest'
import type { PanelInstallInfo, PanelInstallRegistryEntry } from '@clara/shared-types'
import {
  adapterRepairCommand,
  adapterUpdate,
  fetchInstallInfo,
  installManifest,
  installOffered,
  latestAdapterVersion,
  registryCheckedAt,
  registryCommand,
  registryError,
  repoCommand,
  supportedPlatforms,
} from './install.ts'
import { configurePanelApi } from './panel-api.ts'

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
          publishedAt: '2026-11-16T23:00:00.000Z',
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
  afterEach(() => configurePanelApi(null))

  it('reads the registry, asking for a fresh check when the user asks', async () => {
    const paths: string[] = []
    configurePanelApi(async (request) => {
      paths.push(request.path)
      return new Response(JSON.stringify(info), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    await fetchInstallInfo()
    await fetchInstallInfo({ refresh: true })
    expect(paths).toEqual(['/panel/api/v1/install', '/panel/api/v1/install?refresh=true'])
  })

  it('reports the most recent registry check time', () => {
    expect(registryCheckedAt(info)).toBe(new Date(0).toISOString())
    expect(registryCheckedAt(undefined)).toBeUndefined()

    const entry = (checkedAt: string): PanelInstallRegistryEntry => ({
      kind: 'opencode',
      manifestUrl: 'https://clara.example/adapters/opencode/manifest.json',
      ok: true,
      checkedAt,
    })
    expect(
      registryCheckedAt({
        ...info,
        registry: {
          ...info.registry,
          entries: [
            entry('2026-11-16T10:00:00.000Z'),
            entry('2026-11-16T12:00:00.000Z'),
            entry('not-a-date'),
          ],
        },
      })
    ).toBe('2026-11-16T12:00:00.000Z')
  })

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

  it('uses the release timestamp for a development adapter', () => {
    expect(
      adapterUpdate(info, {
        kind: 'opencode',
        adapterVersion: '0.1.0-dev+7572258',
        adapterInstalledAt: '2026-11-16T16:00:00.000Z',
      })
    ).toEqual({ latest: '0.1.0-dev+abc1234', available: true })
    expect(
      adapterUpdate(info, {
        kind: 'opencode',
        adapterVersion: '0.1.0-dev+8809f65',
        adapterInstalledAt: '2026-11-16T23:30:00.000Z',
      })
    ).toEqual({ latest: '0.1.0-dev+abc1234', available: false })
    expect(adapterUpdate(info, { kind: 'claude', adapterVersion: '0.1.0' })).toEqual({
      latest: undefined,
      available: false,
    })
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
