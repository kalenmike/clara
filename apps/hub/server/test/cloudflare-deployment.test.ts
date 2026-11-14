import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateSecretKey, loadSecretKey } from '@clara/crypto'
import type { SecretKeyInfo } from '../src/store/secret-key.ts'
import { CloudflareClient } from '../src/features/cloudflare-deployment/cloudflare-client.ts'
import { deployRelay } from '../src/features/cloudflare-deployment/deploy.ts'
import { createCloudflarePanelFeature } from '../src/features/cloudflare-deployment/panel-routes.ts'
import type { CloudflareDeploymentState } from '../src/features/cloudflare-deployment/state.ts'
import type { PanelFeatureRequest } from '../src/panel/feature.ts'
import {
  forgetCloudflareToken,
  hasCloudflareToken,
  loadCloudflareToken,
  saveCloudflareToken,
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
    const relay = { agentToken: 'agent-token', clientToken: 'client-token' }

    await saveRelayCredentials(dir, key, relay)
    await saveCloudflareToken(dir, key, 'cloudflare-token')

    expect(await loadRelayCredentials(dir, key)).toEqual(relay)
    expect(await loadCloudflareToken(dir, key)).toBe('cloudflare-token')
    expect(hasCloudflareToken(dir)).toBe(true)

    forgetCloudflareToken(dir)
    expect(hasCloudflareToken(dir)).toBe(false)
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
        expect.objectContaining({ type: 'secret_text', name: 'CLARA_CLIENT_TOKEN' }),
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
