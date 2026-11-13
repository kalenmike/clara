import { bytesToBase64Url, randomBytes } from '@clara/crypto'
import type { RelayArtifact } from './artifact.ts'
import type { CloudflareAccount, CloudflareClient } from './cloudflare-client.ts'

const SCRIPT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const HEALTH_ATTEMPTS = 8
const HEALTH_DELAYS_MS = [500, 1_000, 2_000, 3_000, 4_000, 5_000, 5_000]
const HEALTH_TIMEOUT_MS = 8_000

export type DeployRelayOptions = {
  client: CloudflareClient
  artifact: RelayArtifact
  account: CloudflareAccount
  scriptName: string
  room?: string
  agentToken?: string
  clientToken?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type DeployRelayResult = {
  account: CloudflareAccount
  scriptName: string
  hostname: string
  url: string
  room: string
  agentToken: string
  clientToken: string
  deployedAt: string
  reachable: boolean
  healthError?: string
}

export class RelayDeploymentError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RelayDeploymentError'
    this.code = code
  }
}

export async function deployRelay(options: DeployRelayOptions): Promise<DeployRelayResult> {
  const scriptName = options.scriptName.trim()
  if (!SCRIPT_NAME_PATTERN.test(scriptName)) {
    throw new RelayDeploymentError(
      'invalid_script_name',
      'The Worker name must use lowercase letters, numbers, and hyphens, and be at most 63 characters.'
    )
  }

  const subdomain = await options.client.getSubdomain(options.account.id)
  if (!subdomain) {
    throw new RelayDeploymentError(
      'workers_dev_unavailable',
      'This Cloudflare account has no workers.dev subdomain. Create one in the Cloudflare dashboard, then try again.'
    )
  }

  const existing = await options.client.getScript(options.account.id, scriptName)
  if (existing && !existing.migrationTag) {
    throw new RelayDeploymentError(
      'script_exists',
      `A Worker named ${scriptName} already exists without a Clara relay migration. Choose a different Worker name.`
    )
  }
  if (existing?.migrationTag && existing.migrationTag !== options.artifact.migrationTag) {
    throw new RelayDeploymentError(
      'unexpected_migration',
      `The existing ${scriptName} Worker uses an unknown migration tag (${existing.migrationTag}). Use a different Worker name.`
    )
  }

  const migrate = !existing
  const agentToken = options.agentToken ?? generateToken()
  const clientToken = options.clientToken ?? generateToken()
  const room = options.room ?? bytesToBase64Url(randomBytes(16))

  const metadata = {
    main_module: options.artifact.mainModule,
    compatibility_date: options.artifact.compatibilityDate,
    bindings: [
      {
        type: 'durable_object_namespace',
        name: options.artifact.durableObject.binding,
        class_name: options.artifact.durableObject.className,
      },
      { type: 'secret_text', name: 'CLARA_AGENT_TOKEN', text: agentToken },
      { type: 'secret_text', name: 'CLARA_CLIENT_TOKEN', text: clientToken },
    ],
    ...(migrate
      ? {
          migrations: {
            new_tag: options.artifact.migrationTag,
            steps: [{ new_sqlite_classes: [options.artifact.durableObject.className] }],
          },
        }
      : {}),
  }

  await options.client.uploadScript({
    accountId: options.account.id,
    scriptName,
    metadata,
    moduleName: options.artifact.mainModule,
    module: options.artifact.code,
  })
  await options.client.enableSubdomain(options.account.id, scriptName)

  const hostname = `${scriptName}.${subdomain}.workers.dev`
  const health = await waitForHealth(hostname, options.fetchImpl ?? fetch, options.sleep)

  return {
    account: options.account,
    scriptName,
    hostname,
    url: `wss://${hostname}`,
    room,
    agentToken,
    clientToken,
    deployedAt: new Date().toISOString(),
    reachable: health.ok,
    ...(health.error ? { healthError: health.error } : {}),
  }
}

export function generateToken(): string {
  return bytesToBase64Url(randomBytes(32))
}

async function waitForHealth(
  hostname: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<{ ok: boolean; error?: string }> {
  let lastError = 'The relay did not answer its health check'
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(`https://${hostname}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })
      if (response.ok) {
        const body = (await response.json()) as unknown
        if (isRecord(body) && body.ok === true) return { ok: true }
        lastError = 'The relay health check returned an unexpected response'
      } else {
        lastError = `The relay health check returned HTTP ${response.status}`
      }
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause)
    }
    const delay = HEALTH_DELAYS_MS[attempt]
    if (delay !== undefined) await sleep(delay)
  }
  return { ok: false, error: lastError }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
