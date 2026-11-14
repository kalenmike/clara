import { bytesToBase64Url, randomBytes } from '@clara/crypto'
import type { RelayArtifact } from './artifact.ts'
import type { CloudflareAccount, CloudflareClient } from './cloudflare-client.ts'

const SCRIPT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const HEALTH_ATTEMPTS = 8
const HEALTH_DELAYS_MS = [500, 1_000, 2_000, 3_000, 4_000, 5_000, 5_000]
const HEALTH_TIMEOUT_MS = 8_000
/**
 * The oldest route-envelope version this hub can talk to. The Worker reports
 * its version on `GET /health`, so an outdated deployment is caught here
 * instead of at the first WebSocket upgrade. The v4 core lane raises this to 3
 * once the newer envelope ships.
 */
const MIN_RELAY_WIRE_VERSION = 2
const OUTDATED_RELAY = 'The deployed relay is outdated; redeploy the Worker'

export type DeployRelayOptions = {
  client: CloudflareClient
  artifact: RelayArtifact
  account: CloudflareAccount
  scriptName: string
  room?: string
  agentToken?: string
  clientToken?: string
  allowExisting?: boolean
  /** Serve preview/version URLs for the Worker. Off unless explicitly enabled. */
  previewUrls?: boolean
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
  previewUrls: boolean
  previewUrlsError?: string
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
  if (existing && options.allowExisting !== true) {
    throw new RelayDeploymentError(
      'script_exists',
      `A Worker named ${scriptName} already exists. Choose a different Worker name, or delete it in Cloudflare before deploying.`
    )
  }
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
  const previewUrls = options.previewUrls === true

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
  // Cloudflare has no preview field in upload metadata; `previews_enabled` on
  // the subdomain endpoint is the supported switch, sent on every deploy so an
  // older Worker gets cleared too.
  let appliedPreviewUrls = previewUrls
  let previewUrlsError: string | undefined
  try {
    await options.client.configureSubdomain({
      accountId: options.account.id,
      scriptName,
      enabled: true,
      previewsEnabled: previewUrls,
    })
  } catch (cause) {
    // Fall back to the legacy body so the workers.dev hostname is still
    // enabled when Cloudflare rejects the preview field for this Worker. If
    // this retry fails too, the deployment fails before its health check.
    await options.client.configureSubdomain({
      accountId: options.account.id,
      scriptName,
      enabled: true,
    })
    appliedPreviewUrls = false
    previewUrlsError = cause instanceof Error ? cause.message : String(cause)
  }

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
    previewUrls: appliedPreviewUrls,
    ...(previewUrlsError ? { previewUrlsError } : {}),
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
        if (isRecord(body) && body.ok === true) {
          const relay = body.relay
          if (
            typeof relay === 'number' &&
            Number.isFinite(relay) &&
            relay >= MIN_RELAY_WIRE_VERSION
          ) {
            return { ok: true }
          }
          // A Worker that predates the version field cannot tag client frames
          // with a peer id, so refuse it before the hub tries to connect.
          lastError = OUTDATED_RELAY
        } else {
          lastError = 'The relay health check returned an unexpected response'
        }
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
