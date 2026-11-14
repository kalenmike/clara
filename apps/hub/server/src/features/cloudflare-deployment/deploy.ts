import { bytesToBase64Url, randomBytes } from '@clara/crypto'
import type { RelayArtifact } from './artifact.ts'
import type {
  CloudflareAccount,
  CloudflareClient,
  CloudflareWorkerDomain,
} from './cloudflare-client.ts'

const SCRIPT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const CUSTOM_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i
const CUSTOM_HOSTNAME_ERROR =
  'Enter a DNS hostname such as relay.example.com, without a scheme, path, or wildcard, and not a workers.dev name.'
const HEALTH_ATTEMPTS = 8
const HEALTH_DELAYS_MS = [500, 1_000, 2_000, 3_000, 4_000, 5_000, 5_000]
const HEALTH_TIMEOUT_MS = 8_000
/**
 * A new custom hostname waits on Cloudflare DNS and certificate issuance, so it
 * gets a longer window than workers.dev. Delays are capped so the total request
 * volume stays bounded while the certificate activates.
 */
const CUSTOM_HEALTH_WINDOW_MS = 5 * 60_000
const CUSTOM_HEALTH_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 10_000, 15_000]
/**
 * The oldest route-envelope version this hub can talk to. The Worker reports
 * its version on `GET /health`, so an outdated deployment is caught here
 * instead of at the first WebSocket upgrade. The v4 core lane raises this to 3
 * once the newer envelope ships.
 */
const MIN_RELAY_WIRE_VERSION = 2
const OUTDATED_RELAY = 'The deployed relay is outdated; redeploy the Worker'

export type DeployCustomDomain = {
  hostname: string
  zoneId?: string
}

export type DeployedCustomDomain = {
  hostname: string
  zoneId: string
  domainId: string
  ready: boolean
}

export type PreviousCustomDomain = {
  hostname: string
  zoneId: string
  domainId: string
}

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
  /** Attach this hostname as a Worker custom domain after the upload. */
  customDomain?: DeployCustomDomain
  /**
   * Turn the workers.dev host off after the custom hostname answers. Never
   * applied without a ready custom hostname.
   */
  disableWorkersDev?: boolean
  /** The stored binding from the previous deployment, detached after a replace. */
  previousCustomDomain?: PreviousCustomDomain
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
  customDomain?: DeployedCustomDomain
  customDomainError?: string
  /** True only when the workers.dev host was actually turned off. */
  disableWorkersDev: boolean
  workersDevDisableError?: string
}

export class RelayDeploymentError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RelayDeploymentError'
    this.code = code
  }
}

/**
 * A custom relay host must be a bare DNS name in a zone the token can manage.
 * Cloudflare attaches the Worker to the zone itself, so a scheme, path, or
 * wildcard is never valid input here.
 */
export function validateCustomHostname(value: string): string {
  const hostname = value.trim()
  const invalid = (): never => {
    throw new RelayDeploymentError('invalid_custom_domain', CUSTOM_HOSTNAME_ERROR)
  }
  if (!hostname || /[:/?#*\s]/.test(hostname)) invalid()
  const normalized = hostname.toLowerCase()
  if (normalized === 'workers.dev' || normalized.endsWith('.workers.dev')) invalid()
  if (!CUSTOM_HOSTNAME_PATTERN.test(normalized)) invalid()
  return normalized
}

export async function deployRelay(options: DeployRelayOptions): Promise<DeployRelayResult> {
  const scriptName = options.scriptName.trim()
  if (!SCRIPT_NAME_PATTERN.test(scriptName)) {
    throw new RelayDeploymentError(
      'invalid_script_name',
      'The Worker name must use lowercase letters, numbers, and hyphens, and be at most 63 characters.'
    )
  }

  const customDomain = options.customDomain
    ? {
        hostname: validateCustomHostname(options.customDomain.hostname),
        zoneId: options.customDomain.zoneId?.trim() || undefined,
      }
    : undefined
  const disableWorkersDev = options.disableWorkersDev === true

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

  const workersDevHostname = `${scriptName}.${subdomain}.workers.dev`
  const fetchImpl = options.fetchImpl ?? fetch

  // Attach the custom domain after the upload. Listing first keeps a redeploy
  // idempotent: the same hostname in the same zone reuses its existing binding
  // instead of creating a duplicate.
  let customBinding: CloudflareWorkerDomain | undefined
  if (customDomain) {
    const zoneId =
      customDomain.zoneId ??
      (await resolveZone(options.client, options.account.id, customDomain.hostname))
    const domains = await options.client.listWorkerDomains(options.account.id, scriptName)
    const matching = domains.find(
      (domain) => sameHostname(domain.hostname, customDomain.hostname) && domain.zoneId === zoneId
    )
    if (matching) {
      customBinding = matching
    } else {
      // A hostname can only be bound once. Detach a stale binding in another
      // zone before attaching the requested one.
      for (const stale of domains.filter((domain) =>
        sameHostname(domain.hostname, customDomain.hostname)
      )) {
        await options.client.detachWorkerDomain(options.account.id, stale.id)
      }
      customBinding = await options.client.attachWorkerDomain({
        accountId: options.account.id,
        scriptName,
        zoneId,
        hostname: customDomain.hostname,
      })
    }
  }

  const workersDevHealth = await waitForHealth(workersDevHostname, fetchImpl, options.sleep)

  let readyCustomDomain: DeployedCustomDomain | undefined
  let customDomainError: string | undefined
  if (customDomain && customBinding) {
    const customHealth = await waitForCustomHealth(customDomain.hostname, fetchImpl, options.sleep)
    readyCustomDomain = {
      hostname: customDomain.hostname,
      zoneId: customBinding.zoneId,
      domainId: customBinding.id,
      ready: customHealth.ok,
    }
    if (!customHealth.ok) {
      customDomainError = `The custom hostname did not answer its health check within five minutes. The relay stays on the workers.dev hostname; try again once the certificate is active.${customHealth.error ? ` (${customHealth.error})` : ''}`
    }
  }

  // Replacing the hostname (or removing it) releases the old binding. Skip the
  // detach when the deploy reused the same binding.
  const previous = options.previousCustomDomain
  if (previous && previous.domainId !== readyCustomDomain?.domainId) {
    await options.client.detachWorkerDomain(options.account.id, previous.domainId)
  }

  // Never remove the fallback host until the custom hostname actually answers.
  let workersDevDisabled = false
  let workersDevDisableError: string | undefined
  if (disableWorkersDev && readyCustomDomain?.ready) {
    try {
      await options.client.configureSubdomain({
        accountId: options.account.id,
        scriptName,
        enabled: false,
        previewsEnabled: false,
      })
      workersDevDisabled = true
    } catch (cause) {
      workersDevDisableError = cause instanceof Error ? cause.message : String(cause)
    }
  }

  const useCustomHostname = readyCustomDomain?.ready === true
  const hostname =
    useCustomHostname && readyCustomDomain ? readyCustomDomain.hostname : workersDevHostname
  const reachable = useCustomHostname ? true : workersDevHealth.ok

  return {
    account: options.account,
    scriptName,
    hostname,
    url: `wss://${hostname}`,
    room,
    agentToken,
    clientToken,
    deployedAt: new Date().toISOString(),
    reachable,
    previewUrls: workersDevDisabled ? false : appliedPreviewUrls,
    ...(previewUrlsError ? { previewUrlsError } : {}),
    ...(workersDevHealth.error && !useCustomHostname
      ? { healthError: workersDevHealth.error }
      : {}),
    ...(readyCustomDomain ? { customDomain: readyCustomDomain } : {}),
    ...(customDomainError ? { customDomainError } : {}),
    disableWorkersDev: workersDevDisabled,
    ...(workersDevDisableError ? { workersDevDisableError } : {}),
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
    const check = await checkRelayHealth(hostname, fetchImpl)
    if (check.ok) return check
    lastError = check.error ?? lastError
    const delay = HEALTH_DELAYS_MS[attempt]
    if (delay !== undefined) await sleep(delay)
  }
  return { ok: false, error: lastError }
}

async function waitForCustomHealth(
  hostname: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<{ ok: boolean; error?: string }> {
  let lastError = 'The custom hostname did not answer its health check'
  let elapsed = 0
  let attempt = 0
  while (elapsed < CUSTOM_HEALTH_WINDOW_MS) {
    const check = await checkRelayHealth(hostname, fetchImpl)
    if (check.ok) return check
    lastError = check.error ?? lastError
    const delay =
      CUSTOM_HEALTH_DELAYS_MS[Math.min(attempt, CUSTOM_HEALTH_DELAYS_MS.length - 1)] ??
      CUSTOM_HEALTH_DELAYS_MS[CUSTOM_HEALTH_DELAYS_MS.length - 1]
    elapsed += delay
    if (elapsed >= CUSTOM_HEALTH_WINDOW_MS) break
    await sleep(delay)
    attempt += 1
  }
  return { ok: false, error: lastError }
}

async function checkRelayHealth(
  hostname: string,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetchImpl(`https://${hostname}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      return { ok: false, error: `The relay health check returned HTTP ${response.status}` }
    }
    const body = (await response.json()) as unknown
    if (!isRecord(body) || body.ok !== true) {
      return { ok: false, error: 'The relay health check returned an unexpected response' }
    }
    const relay = body.relay
    if (typeof relay === 'number' && Number.isFinite(relay) && relay >= MIN_RELAY_WIRE_VERSION) {
      return { ok: true }
    }
    // A Worker that predates the version field cannot tag client frames with a
    // peer id, so refuse it before the hub tries to connect.
    return { ok: false, error: OUTDATED_RELAY }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

async function resolveZone(
  client: CloudflareClient,
  accountId: string,
  hostname: string
): Promise<string> {
  const zones = await client.listZones(accountId)
  const matching = zones
    .filter((zone) => sameHostname(hostname, zone.name) || isSubdomainOf(hostname, zone.name))
    .sort((left, right) => right.name.length - left.name.length)[0]
  if (!matching) {
    throw new RelayDeploymentError(
      'custom_domain_zone',
      `No zone on this Cloudflare account handles ${hostname}. Add the domain to the account, choose its zone, then try again.`
    )
  }
  return matching.id
}

function sameHostname(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function isSubdomainOf(hostname: string, zone: string): boolean {
  return sameHostname(hostname, zone) || hostname.toLowerCase().endsWith(`.${zone.toLowerCase()}`)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
