import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, loadSecretKey } from '@clara/crypto'
import type { ServerConfig } from '../src/config.ts'
import type { SecretKeyInfo } from '../src/store/secret-key.ts'
import {
  CloudflareClient,
  CloudflareError,
} from '../src/features/cloudflare-deployment/cloudflare-client.ts'
import {
  deployRelay,
  validateCustomHostname,
} from '../src/features/cloudflare-deployment/deploy.ts'
import { createCloudflarePanelFeature } from '../src/features/cloudflare-deployment/panel-routes.ts'
import { CloudflareDeploymentState } from '../src/features/cloudflare-deployment/state.ts'
import type { PanelFeatureRequest } from '../src/panel/feature.ts'
import {
  forgetCloudflareToken,
  hasCloudflareToken,
  loadCloudflareToken,
  loadRelayDeployment,
  saveCloudflareToken,
  saveRelayDeployment,
} from '../src/features/cloudflare-deployment/storage.ts'
import { loadRelayCredentials, saveRelayCredentials } from '../src/store/relay.ts'
import type { RelayArtifact } from '../src/features/cloudflare-deployment/artifact.ts'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-cloudflare-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function secretKey(): Promise<SecretKeyInfo> {
  const value = generateSecretKey()
  return { key: await loadSecretKey(value), version: 1, source: 'generated' }
}

const artifact: RelayArtifact = {
  code: 'export default {}',
  scriptName: 'clara-relay',
  mainModule: 'clara-relay.mjs',
  compatibilityDate: '2026-10-30',
  migrationTag: 'v1',
  durableObject: { binding: 'RELAY_ROOMS', className: 'RelayRoom' },
}

describe('cloudflare deployment storage', () => {
  it('round-trips relay tokens and the API token through the secret key', async () => {
    const dir = tempDir()
    const key = await secretKey()
    const relay = { agentToken: 'agent-token' }

    await saveRelayCredentials(dir, key, relay)
    await saveCloudflareToken(dir, key, 'cloudflare-token')

    expect(await loadRelayCredentials(dir, key)).toEqual(relay)
    expect(await loadCloudflareToken(dir, key)).toBe('cloudflare-token')
    expect(hasCloudflareToken(dir)).toBe(true)

    forgetCloudflareToken(dir)
    expect(hasCloudflareToken(dir)).toBe(false)
  })

  it('keeps custom-domain fields and tolerates records written before they existed', () => {
    const dir = tempDir()
    const legacy = {
      accountId: 'account',
      scriptName: 'clara-relay',
      hostname: 'clara-relay.example.workers.dev',
      deployedAt: '2026-01-01T00:00:00.000Z',
      reachable: true,
      previewUrls: false,
    }
    writeFileSync(join(dir, 'relay-deployment.json'), JSON.stringify(legacy))

    expect(loadRelayDeployment(dir)).toEqual(legacy)

    saveRelayDeployment(dir, {
      ...legacy,
      customDomain: {
        hostname: 'relay.example.com',
        zoneId: 'zone-1',
        domainId: 'domain-1',
        ready: true,
      },
      disableWorkersDev: true,
    })

    expect(loadRelayDeployment(dir)).toMatchObject({
      customDomain: {
        hostname: 'relay.example.com',
        zoneId: 'zone-1',
        domainId: 'domain-1',
        ready: true,
      },
      disableWorkersDev: true,
    })
  })
})

describe('CloudflareClient', () => {
  it('uploads the relay module, Durable Object binding, secrets, and first migration', async () => {
    let upload: FormData | undefined
    const client = new CloudflareClient('token', async (input, init) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) {
        return json({ subdomain: 'example' })
      }
      if (url.includes('/workers/services/')) return json(undefined, 404)
      if (url.endsWith('/subdomain')) return json({ enabled: true })
      if (init?.method === 'PUT') {
        upload = init.body as FormData
        return json({ id: 'script' })
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`)
    })

    await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      sleep: async () => {},
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, relay: 2 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })

    const metadataPart = upload?.get('metadata')
    expect(metadataPart).toBeInstanceOf(Blob)
    const metadata = JSON.parse(await (metadataPart as Blob).text())
    expect(metadata.main_module).toBe('clara-relay.mjs')
    expect(metadata.compatibility_date).toBe('2026-10-30')
    expect(metadata.bindings).toEqual(
      expect.arrayContaining([
        {
          type: 'durable_object_namespace',
          name: 'RELAY_ROOMS',
          class_name: 'RelayRoom',
        },
        expect.objectContaining({ type: 'secret_text', name: 'CLARA_AGENT_TOKEN' }),
      ])
    )
    expect(metadata.migrations).toEqual({
      new_tag: 'v1',
      steps: [{ new_sqlite_classes: ['RelayRoom'] }],
    })
  })

  it('disables preview URLs by default without adding an upload metadata field', async () => {
    let metadata: Record<string, unknown> | undefined
    let subdomain: { body: unknown; apiDate: string | null } | undefined
    const client = new CloudflareClient('token', async (input, init) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) return json(undefined, 404)
      if (url.endsWith('/subdomain')) {
        subdomain = {
          body: JSON.parse(String(init?.body)),
          apiDate: new Headers(init?.headers).get('Cloudflare-Workers-Script-Api-Date'),
        }
        return json({ enabled: true, previews_enabled: false })
      }
      if (init?.method === 'PUT') {
        const form = init.body as FormData
        metadata = JSON.parse(await (form.get('metadata') as Blob).text())
        return json({ id: 'script' })
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`)
    })

    const result = await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      sleep: async () => {},
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, relay: 2 }), { status: 200 }),
    })

    expect(metadata).not.toHaveProperty('preview_urls')
    expect(subdomain).toEqual({
      body: { enabled: true, previews_enabled: false },
      apiDate: '2025-08-01',
    })
    expect(result.previewUrls).toBe(false)
  })

  it('forwards an explicit preview URL opt-in', async () => {
    let subdomainBody: unknown
    const client = new CloudflareClient('token', async (input, init) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) return json(undefined, 404)
      if (url.endsWith('/subdomain')) {
        subdomainBody = JSON.parse(String(init?.body))
        return json({ enabled: true, previews_enabled: true })
      }
      return json({ id: 'script' })
    })

    const result = await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      previewUrls: true,
      sleep: async () => {},
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, relay: 2 }), { status: 200 }),
    })

    expect(subdomainBody).toEqual({ enabled: true, previews_enabled: true })
    expect(result.previewUrls).toBe(true)
  })

  it('clears preview URLs when redeploying an existing Worker', async () => {
    let subdomainCalls = 0
    let subdomainBody: unknown
    const client = new CloudflareClient('token', async (input, init) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) {
        return json({ default_environment: { script: { migration_tag: 'v1' } } })
      }
      if (url.endsWith('/subdomain')) {
        subdomainCalls += 1
        subdomainBody = JSON.parse(String(init?.body))
        return json({ enabled: true, previews_enabled: false })
      }
      return json({ id: 'script' })
    })

    await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      allowExisting: true,
      sleep: async () => {},
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, relay: 2 }), { status: 200 }),
    })

    expect(subdomainCalls).toBe(1)
    expect(subdomainBody).toEqual({ enabled: true, previews_enabled: false })
  })

  it('retries with the legacy body when the preview URL setting is rejected', async () => {
    const subdomainBodies: unknown[] = []
    let healthCalls = 0
    const client = new CloudflareClient('token', async (input, init) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) return json(undefined, 404)
      if (url.endsWith('/subdomain')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        subdomainBodies.push(body)
        return 'previews_enabled' in body ? json(undefined, 400) : json({ enabled: true })
      }
      if (init?.method === 'PUT') return json({ id: 'script' })
      throw new Error(`Unexpected request: ${init?.method} ${url}`)
    })

    const result = await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      sleep: async () => {},
      fetchImpl: async () => {
        healthCalls += 1
        return new Response(JSON.stringify({ ok: true, relay: 2 }), { status: 200 })
      },
    })

    expect(subdomainBodies).toEqual([{ enabled: true, previews_enabled: false }, { enabled: true }])
    expect(result.hostname).toBe('clara-relay.example.workers.dev')
    expect(result.previewUrls).toBe(false)
    expect(result.previewUrlsError).toBe('error')
    expect(healthCalls).toBe(1)
  })

  it('fails the deploy when the subdomain cannot be enabled', async () => {
    let healthCalls = 0
    const client = new CloudflareClient('token', async (input, init) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) return json(undefined, 404)
      if (url.endsWith('/subdomain')) return json(undefined, 400)
      if (init?.method === 'PUT') return json({ id: 'script' })
      throw new Error(`Unexpected request: ${init?.method} ${url}`)
    })

    await expect(
      deployRelay({
        client,
        artifact,
        account: { id: 'account', name: 'Account' },
        scriptName: 'clara-relay',
        sleep: async () => {},
        fetchImpl: async () => {
          healthCalls += 1
          return new Response(JSON.stringify({ ok: true, relay: 2 }), { status: 200 })
        },
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(healthCalls).toBe(0)
  })

  it('skips the migration when the published Worker already has the tag', async () => {
    let metadata: Record<string, unknown> | undefined
    const client = new CloudflareClient('token', async (input, init) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) {
        return json({ default_environment: { script: { migration_tag: 'v1' } } })
      }
      if (url.endsWith('/subdomain')) return json({ enabled: true })
      if (init?.method === 'PUT') {
        const form = init.body as FormData
        metadata = JSON.parse(await (form.get('metadata') as Blob).text())
        return json({ id: 'script' })
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`)
    })

    await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      allowExisting: true,
      sleep: async () => {},
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, relay: 2 }), { status: 200 }),
    })

    expect(metadata?.migrations).toBeUndefined()
  })

  it('refuses to overwrite a Worker with an unknown migration tag', async () => {
    const client = new CloudflareClient('token', async (input) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) {
        return json({ default_environment: { script: { migration_tag: 'v9' } } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(
      deployRelay({
        client,
        artifact,
        account: { id: 'account', name: 'Account' },
        scriptName: 'clara-relay',
        allowExisting: true,
        sleep: async () => {},
      })
    ).rejects.toMatchObject({ code: 'unexpected_migration' })
  })

  it('refuses to overwrite an existing Worker without a local deployment record', async () => {
    const client = new CloudflareClient('token', async (input) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) {
        return json({ default_environment: { script: { migration_tag: 'v1' } } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(
      deployRelay({
        client,
        artifact,
        account: { id: 'account', name: 'Account' },
        scriptName: 'clara-relay',
        sleep: async () => {},
      })
    ).rejects.toMatchObject({ code: 'script_exists' })
  })

  it('refuses to overwrite an existing Worker without a relay migration', async () => {
    const client = new CloudflareClient('token', async (input) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) return json({ default_environment: { script: {} } })
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(
      deployRelay({
        client,
        artifact,
        account: { id: 'account', name: 'Account' },
        scriptName: 'clara-relay',
        sleep: async () => {},
      })
    ).rejects.toMatchObject({ code: 'script_exists' })
  })

  it('reports a missing workers.dev subdomain', async () => {
    const client = new CloudflareClient('token', async () => json({}))

    await expect(
      deployRelay({
        client,
        artifact,
        account: { id: 'account', name: 'Account' },
        scriptName: 'clara-relay',
        sleep: async () => {},
      })
    ).rejects.toMatchObject({ code: 'workers_dev_unavailable' })
  })
})

describe('Cloudflare zones and custom domains', () => {
  it('lists zones with the account filter and names every scope on 403', async () => {
    let requested = ''
    const client = new CloudflareClient('token', async (input) => {
      requested = String(input)
      return json([{ id: 'zone-1', name: 'example.com' }])
    })

    expect(await client.listZones('account')).toEqual([{ id: 'zone-1', name: 'example.com' }])
    expect(requested).toContain('/zones?account.id=account&per_page=50')

    const denied = new CloudflareClient('token', async () => json(undefined, 403))
    const error = await denied.listZones('account').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(CloudflareError)
    expect((error as CloudflareError).status).toBe(403)
    expect((error as Error).message).toContain('Workers Scripts: Edit')
    expect((error as Error).message).toContain('Zone: Read')
    expect((error as Error).message).toContain('Zone: Workers Routes: Edit')
  })

  it('lists domains for one service and attaches with the exact body', async () => {
    let listUrl = ''
    let attachBody: unknown
    const client = new CloudflareClient('token', async (input, init) => {
      const url = String(input)
      if (init?.method === 'GET') {
        listUrl = url
        return json([
          {
            id: 'domain-0',
            zone_id: 'zone-1',
            zone_name: 'example.com',
            hostname: 'relay.example.com',
            service: 'clara-relay',
            environment: 'production',
          },
        ])
      }
      attachBody = JSON.parse(String(init?.body))
      return json({
        id: 'domain-1',
        zone_id: 'zone-1',
        hostname: 'relay.example.com',
        service: 'clara-relay',
        environment: 'production',
      })
    })

    expect(await client.listWorkerDomains('account', 'clara-relay')).toEqual([
      {
        id: 'domain-0',
        zoneId: 'zone-1',
        zoneName: 'example.com',
        hostname: 'relay.example.com',
        service: 'clara-relay',
        environment: 'production',
      },
    ])
    expect(listUrl).toContain('/accounts/account/workers/domains?service=clara-relay')

    const attached = await client.attachWorkerDomain({
      accountId: 'account',
      scriptName: 'clara-relay',
      zoneId: 'zone-1',
      hostname: 'relay.example.com',
    })
    expect(attachBody).toEqual({
      zone_id: 'zone-1',
      hostname: 'relay.example.com',
      service: 'clara-relay',
      environment: 'production',
    })
    expect(attached.id).toBe('domain-1')
  })

  function customClient(options: {
    domains?: unknown[]
    attachId?: string
    onAttach?: () => void
    onDetach?: (domainId: string) => void
    subdomainBodies?: unknown[]
  }): CloudflareClient {
    return new CloudflareClient('token', async (input, init) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) return json(undefined, 404)
      if (url.endsWith('/subdomain')) {
        options.subdomainBodies?.push(JSON.parse(String(init?.body)))
        return json({ enabled: true })
      }
      if (url.includes('/workers/domains?service=')) return json(options.domains ?? [])
      if (url.includes('/workers/domains/')) {
        const domainId = url.split('/').pop() ?? ''
        options.onDetach?.(domainId)
        return json({})
      }
      if (url.endsWith('/workers/domains')) {
        options.onAttach?.()
        return json({
          id: options.attachId ?? 'domain-new',
          zone_id: 'zone-1',
          hostname: 'relay.example.com',
          service: 'clara-relay',
          environment: 'production',
        })
      }
      if (url.endsWith('/zones?account.id=account&per_page=50')) {
        return json([{ id: 'zone-1', name: 'example.com' }])
      }
      if (init?.method === 'PUT') return json({ id: 'script' })
      throw new Error(`Unexpected request: ${init?.method} ${url}`)
    })
  }

  function healthyFetch(customHealth: boolean = true): typeof fetch {
    return async (input) => {
      const url = String(input)
      const healthy = customHealth || !url.includes('relay.example.com')
      return new Response(JSON.stringify(healthy ? { ok: true, relay: 2 } : { ok: false }), {
        status: healthy ? 200 : 503,
      })
    }
  }

  it('uses the custom host once it answers and records the binding', async () => {
    let attachBody: unknown
    let attachCalls = 0
    const client = customClient({
      onAttach: () => {
        attachCalls += 1
      },
    })
    const original = client.attachWorkerDomain.bind(client)
    client.attachWorkerDomain = async (input) => {
      attachBody = {
        zone_id: input.zoneId,
        hostname: input.hostname,
        service: input.scriptName,
        environment: 'production',
      }
      return original(input)
    }

    const result = await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      customDomain: { hostname: 'relay.example.com', zoneId: 'zone-1' },
      sleep: async () => {},
      fetchImpl: healthyFetch(true),
    })

    expect(attachCalls).toBe(1)
    expect(attachBody).toEqual({
      zone_id: 'zone-1',
      hostname: 'relay.example.com',
      service: 'clara-relay',
      environment: 'production',
    })
    expect(result.hostname).toBe('relay.example.com')
    expect(result.url).toBe('wss://relay.example.com')
    expect(result.customDomain).toEqual({
      hostname: 'relay.example.com',
      zoneId: 'zone-1',
      domainId: 'domain-new',
      ready: true,
    })
    expect(result.disableWorkersDev).toBe(false)
  })

  it('reuses an existing binding on redeploy instead of attaching again', async () => {
    let attachCalls = 0
    const result = await deployRelay({
      client: customClient({
        domains: [
          {
            id: 'domain-existing',
            zone_id: 'zone-1',
            hostname: 'relay.example.com',
            service: 'clara-relay',
          },
        ],
        onAttach: () => {
          attachCalls += 1
        },
      }),
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      customDomain: { hostname: 'relay.example.com', zoneId: 'zone-1' },
      sleep: async () => {},
      fetchImpl: healthyFetch(true),
    })

    expect(attachCalls).toBe(0)
    expect(result.customDomain?.domainId).toBe('domain-existing')
  })

  it('detaches the previous binding when the hostname changes', async () => {
    const detached: string[] = []
    const result = await deployRelay({
      client: customClient({ onDetach: (domainId) => detached.push(domainId) }),
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      customDomain: { hostname: 'relay.example.com', zoneId: 'zone-1' },
      previousCustomDomain: {
        hostname: 'old.example.com',
        zoneId: 'zone-1',
        domainId: 'domain-old',
      },
      sleep: async () => {},
      fetchImpl: healthyFetch(true),
    })

    expect(detached).toEqual(['domain-old'])
    expect(result.customDomain?.domainId).toBe('domain-new')
  })

  it('keeps workers.dev and warns when the custom host does not answer', async () => {
    const subdomainBodies: unknown[] = []
    const result = await deployRelay({
      client: customClient({ subdomainBodies }),
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      customDomain: { hostname: 'relay.example.com', zoneId: 'zone-1' },
      disableWorkersDev: true,
      sleep: async () => {},
      fetchImpl: healthyFetch(false),
    })

    expect(result.url).toBe('wss://clara-relay.example.workers.dev')
    expect(result.hostname).toBe('clara-relay.example.workers.dev')
    expect(result.customDomain?.ready).toBe(false)
    expect(result.customDomainError).toContain('five minutes')
    expect(result.disableWorkersDev).toBe(false)
    expect(subdomainBodies).toEqual([{ enabled: true, previews_enabled: false }])
  })

  it('disables workers.dev only after the custom host is healthy', async () => {
    const subdomainBodies: unknown[] = []
    const result = await deployRelay({
      client: customClient({ subdomainBodies }),
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      customDomain: { hostname: 'relay.example.com', zoneId: 'zone-1' },
      disableWorkersDev: true,
      sleep: async () => {},
      fetchImpl: healthyFetch(true),
    })

    expect(subdomainBodies).toEqual([
      { enabled: true, previews_enabled: false },
      { enabled: false, previews_enabled: false },
    ])
    expect(result.url).toBe('wss://relay.example.com')
    expect(result.disableWorkersDev).toBe(true)
  })

  it('never disables workers.dev without a custom hostname', async () => {
    const subdomainBodies: unknown[] = []
    const result = await deployRelay({
      client: customClient({ subdomainBodies }),
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      disableWorkersDev: true,
      sleep: async () => {},
      fetchImpl: healthyFetch(true),
    })

    expect(subdomainBodies).toEqual([{ enabled: true, previews_enabled: false }])
    expect(result.disableWorkersDev).toBe(false)
    expect(result.url).toBe('wss://clara-relay.example.workers.dev')
  })

  it('resolves the zone from the hostname when none is supplied', async () => {
    let attachZone = ''
    const client = customClient({})
    const original = client.attachWorkerDomain.bind(client)
    client.attachWorkerDomain = (input) => {
      attachZone = input.zoneId
      return original(input)
    }

    const result = await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      customDomain: { hostname: 'relay.example.com' },
      sleep: async () => {},
      fetchImpl: healthyFetch(true),
    })

    expect(attachZone).toBe('zone-1')
    expect(result.customDomain?.zoneId).toBe('zone-1')
  })
})

describe('custom hostname validation', () => {
  it.each([
    'https://relay.example.com',
    'relay.example.com/room',
    '*.example.com',
    'relay.example.com?x=1',
    'relay.example.com#fragment',
    'relay.workers.dev',
    'workers.dev',
    'not a host',
    'relay',
  ])('rejects %s before any Cloudflare call', async (hostname) => {
    const client = new CloudflareClient('token', async () => {
      throw new Error('The client must not be called for invalid input')
    })

    await expect(
      deployRelay({
        client,
        artifact,
        account: { id: 'account', name: 'Account' },
        scriptName: 'clara-relay',
        customDomain: { hostname },
        sleep: async () => {},
      })
    ).rejects.toMatchObject({ code: 'invalid_custom_domain' })
  })

  it('normalizes a valid hostname to lowercase', () => {
    expect(validateCustomHostname(' Relay.Example.COM ')).toBe('relay.example.com')
  })
})

describe('deployRelay health check', () => {
  function deploymentClient(): CloudflareClient {
    return new CloudflareClient('token', async (input) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) return json(undefined, 404)
      if (url.endsWith('/subdomain')) return json({ enabled: true })
      return json({ id: 'script' })
    })
  }

  function deploy(
    client: CloudflareClient,
    fetchImpl: typeof fetch
  ): ReturnType<typeof deployRelay> {
    return deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      sleep: async () => {},
      fetchImpl,
    })
  }

  it('accepts a health payload that reports the current relay version', async () => {
    const result = await deploy(
      deploymentClient(),
      async () => new Response(JSON.stringify({ ok: true, relay: 2 }), { status: 200 })
    )

    expect(result.reachable).toBe(true)
    expect(result.healthError).toBeUndefined()
  })

  it('retries until the new workers.dev host answers', async () => {
    let healthCalls = 0
    const client = new CloudflareClient('token', async (input) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) return json(undefined, 404)
      if (url.endsWith('/subdomain')) return json({ enabled: true })
      return json({ id: 'script' })
    })

    const result = await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      sleep: async () => {},
      fetchImpl: async () => {
        healthCalls += 1
        return healthCalls === 1
          ? new Response('not ready', { status: 503 })
          : new Response(JSON.stringify({ ok: true, relay: 2 }), { status: 200 })
      },
    })

    expect(result.reachable).toBe(true)
    expect(result.url).toBe('wss://clara-relay.example.workers.dev')
    expect(healthCalls).toBe(2)
  })

  it('reports an outdated relay when the health payload has no relay version', async () => {
    let healthCalls = 0
    const result = await deploy(deploymentClient(), async () => {
      healthCalls += 1
      return new Response(JSON.stringify({ ok: true, protocol: 2 }), { status: 200 })
    })

    expect(result.reachable).toBe(false)
    expect(result.healthError).toBe('The deployed relay is outdated; redeploy the Worker')
    expect(healthCalls).toBeGreaterThan(1)
  })

  it('reports an outdated relay when the health payload names an older version', async () => {
    const result = await deploy(
      deploymentClient(),
      async () => new Response(JSON.stringify({ ok: true, relay: 1 }), { status: 200 })
    )

    expect(result.reachable).toBe(false)
    expect(result.healthError).toBe('The deployed relay is outdated; redeploy the Worker')
  })

  it('retries a health payload that has no relay version', async () => {
    let healthCalls = 0
    const result = await deploy(deploymentClient(), async () => {
      healthCalls += 1
      return healthCalls === 1
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify({ ok: true, relay: 2 }), { status: 200 })
    })

    expect(result.reachable).toBe(true)
    expect(healthCalls).toBe(2)
  })

  it('returns the deployment with reachable false when health never answers', async () => {
    const client = new CloudflareClient('token', async (input) => {
      const url = String(input)
      if (url.endsWith('/workers/subdomain')) return json({ subdomain: 'example' })
      if (url.includes('/workers/services/')) return json(undefined, 404)
      if (url.endsWith('/subdomain')) return json({ enabled: true })
      return json({ id: 'script' })
    })

    const result = await deployRelay({
      client,
      artifact,
      account: { id: 'account', name: 'Account' },
      scriptName: 'clara-relay',
      sleep: async () => {},
      fetchImpl: async () => new Response('nope', { status: 502 }),
    })

    expect(result.reachable).toBe(false)
    expect(result.healthError).toContain('502')
  })
})

describe('cloudflare deployment panel route', () => {
  function deployRequest(body: unknown): {
    feature: ReturnType<typeof createCloudflarePanelFeature>
    context: PanelFeatureRequest
    response: { status?: number; body?: unknown }
    deployed: () => unknown
  } {
    let deployed: unknown
    const state = {
      deploy: async (input: unknown) => {
        deployed = input
        return { deployment: { available: true } }
      },
    } as unknown as CloudflareDeploymentState
    const response: { status?: number; body?: unknown } = {}
    const context = {
      method: 'POST',
      pathname: '/panel/api/v1/relay/cloudflare/deploy',
      readJson: async () => ({ ok: true, value: body }),
      sendJson: (status: number, payload: unknown) => {
        response.status = status
        response.body = payload
      },
      requireMutation: () => true,
      log: () => {},
    } as unknown as PanelFeatureRequest
    const feature = createCloudflarePanelFeature(state)
    return { feature, context, response, deployed: () => deployed }
  }

  it('rejects a non-boolean previewUrls value', async () => {
    const request = deployRequest({ accountId: 'a'.repeat(32), previewUrls: 'yes' })

    expect(await request.feature.handleRequest(request.context)).toBe(true)
    expect(request.response.status).toBe(400)
    expect(request.response.body).toEqual({
      error: { code: 'invalid_body', message: 'Invalid or unknown field: previewUrls' },
    })
    expect(request.deployed()).toBeUndefined()
  })

  it('forwards a boolean previewUrls value', async () => {
    const request = deployRequest({ accountId: 'a'.repeat(32), previewUrls: true })

    expect(await request.feature.handleRequest(request.context)).toBe(true)
    expect(request.response.status).toBe(200)
    expect(request.deployed()).toEqual({ accountId: 'a'.repeat(32), previewUrls: true })
  })

  it('forwards a custom hostname and the workers.dev switch', async () => {
    const request = deployRequest({
      accountId: 'a'.repeat(32),
      customDomain: { hostname: 'Relay.Example.com', zoneId: 'zone-1' },
      disableWorkersDev: true,
    })

    expect(await request.feature.handleRequest(request.context)).toBe(true)
    expect(request.response.status).toBe(200)
    expect(request.deployed()).toEqual({
      accountId: 'a'.repeat(32),
      customDomain: { hostname: 'relay.example.com', zoneId: 'zone-1' },
      disableWorkersDev: true,
    })
  })

  it.each([
    [{ customDomain: 'relay.example.com' }, 'customDomain'],
    [{ customDomain: { hostname: 7 } }, 'customDomain.hostname'],
    [{ customDomain: { hostname: 'relay.example.com', extra: true } }, 'customDomain.extra'],
    [{ customDomain: { hostname: 'relay.example.com', zoneId: 7 } }, 'customDomain.zoneId'],
    [{ disableWorkersDev: 'yes' }, 'disableWorkersDev'],
  ])('rejects malformed deploy fields %j', async (fields, field) => {
    const request = deployRequest({ accountId: 'a'.repeat(32), ...fields })

    expect(await request.feature.handleRequest(request.context)).toBe(true)
    expect(request.response.status).toBe(400)
    expect(request.response.body).toEqual({
      error: { code: 'invalid_body', message: `Invalid or unknown field: ${field}` },
    })
    expect(request.deployed()).toBeUndefined()
  })

  it.each([
    'https://relay.example.com',
    'relay.example.com/path',
    '*.example.com',
    'relay.workers.dev',
  ])('rejects the invalid hostname %s before deploying', async (hostname) => {
    const request = deployRequest({
      accountId: 'a'.repeat(32),
      customDomain: { hostname },
    })

    expect(await request.feature.handleRequest(request.context)).toBe(true)
    expect(request.response.status).toBe(400)
    expect(request.response.body).toMatchObject({
      error: { code: 'invalid_custom_domain' },
    })
    expect(request.deployed()).toBeUndefined()
  })

  it('lists zones for the selected account', async () => {
    let received: unknown
    const state = {
      listZones: async (input: unknown) => {
        received = input
        return [{ id: 'zone-1', name: 'example.com' }]
      },
    } as unknown as CloudflareDeploymentState
    const response: { status?: number; body?: unknown } = {}
    const context = {
      method: 'POST',
      pathname: '/panel/api/v1/relay/cloudflare/zones',
      readJson: async () => ({
        ok: true,
        value: { token: 'token', accountId: 'a'.repeat(32) },
      }),
      sendJson: (status: number, payload: unknown) => {
        response.status = status
        response.body = payload
      },
      requireMutation: () => true,
      log: () => {},
    } as unknown as PanelFeatureRequest
    const feature = createCloudflarePanelFeature(state)

    expect(await feature.handleRequest(context)).toBe(true)
    expect(response).toEqual({
      status: 200,
      body: { zones: [{ id: 'zone-1', name: 'example.com' }] },
    })
    expect(received).toEqual({ token: 'token', accountId: 'a'.repeat(32) })
  })
})

describe('cloudflare deployment rollback', () => {
  function config(dir: string): ServerConfig {
    return {
      local: { host: '127.0.0.1', bindHost: '127.0.0.1', port: 8788 },
      relay: {
        url: 'wss://relay.example.com',
        room: 'room-123',
        agentToken: 'sentinel-agent-token',
      },
      pairingBaseUrl: 'https://clara.example',
      configDir: dir,
      configPath: join(dir, 'server.json'),
      dataDir: dir,
      dbPath: join(dir, 'clara.db'),
      sources: {
        localHost: 'default',
        localBindHost: 'default',
        localPort: 'default',
        relayUrl: 'file',
        relayRoom: 'file',
        agentToken: 'file',
        pairingBaseUrl: 'default',
      },
    }
  }

  it('detaches the stored custom domain when the deployment is forgotten', async () => {
    const dir = tempDir()
    const key = await secretKey()
    saveRelayDeployment(dir, {
      accountId: 'account',
      scriptName: 'clara-relay',
      hostname: 'relay.example.com',
      deployedAt: '2026-01-01T00:00:00.000Z',
      reachable: true,
      previewUrls: false,
      customDomain: {
        hostname: 'relay.example.com',
        zoneId: 'zone-1',
        domainId: 'domain-1',
        ready: true,
      },
      disableWorkersDev: true,
    })
    await saveCloudflareToken(dir, key, 'cloudflare-token')

    const requests: Array<{ url: string; method?: string }> = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), ...(init?.method ? { method: init.method } : {}) })
      return json({})
    })

    const state = new CloudflareDeploymentState({
      config: config(dir),
      secretKey: key,
      log: () => {},
    })
    await state.forgetDeployment()

    expect(requests).toEqual([
      {
        url: 'https://api.cloudflare.com/client/v4/accounts/account/workers/domains/domain-1',
        method: 'DELETE',
      },
    ])
    expect(loadRelayDeployment(dir)).toBeUndefined()
  })
})

function json(result: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      success: status < 400,
      result,
      errors:
        status < 400 ? [] : [{ code: status, message: status === 404 ? 'not found' : 'error' }],
    }),
    { status, headers: { 'content-type': 'application/json' } }
  )
}
