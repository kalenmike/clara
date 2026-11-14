const API_BASE = 'https://api.cloudflare.com/client/v4'
const USER_AGENT = 'clara-hub-cloudflare-deployment'

export type CloudflareAccount = {
  id: string
  name: string
}

export type CloudflareScript = {
  migrationTag?: string
}

export type CloudflareZone = {
  id: string
  name: string
}

export type CloudflareWorkerDomain = {
  id: string
  zoneId: string
  zoneName?: string
  hostname: string
  service: string
  environment?: string
}

export type AttachWorkerDomainInput = {
  accountId: string
  scriptName: string
  zoneId: string
  hostname: string
}

export type UploadRelayScriptInput = {
  accountId: string
  scriptName: string
  metadata: Record<string, unknown>
  moduleName: string
  module: string
}

export type ConfigureSubdomainInput = {
  accountId: string
  scriptName: string
  enabled: boolean
  /** Omit to send the legacy body that leaves the API default in place. */
  previewsEnabled?: boolean
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export class CloudflareError extends Error {
  readonly status: number
  readonly code?: number
  readonly documentationUrl?: string
  readonly retryable: boolean

  constructor(
    message: string,
    options: {
      status: number
      code?: number
      documentationUrl?: string
      retryable?: boolean
    }
  ) {
    super(message)
    this.name = 'CloudflareError'
    this.status = options.status
    this.code = options.code
    this.documentationUrl = options.documentationUrl
    this.retryable = options.retryable === true
  }
}

export class CloudflareClient {
  private readonly token: string
  private readonly fetchImpl: FetchLike

  constructor(token: string, fetchImpl: FetchLike = fetch) {
    this.token = token
    this.fetchImpl = fetchImpl
  }

  async listAccounts(): Promise<CloudflareAccount[]> {
    const result = await this.request<unknown>('/accounts?per_page=50', { method: 'GET' })
    if (!Array.isArray(result)) throw new Error('Cloudflare returned an unexpected account list')
    return result.flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return []
      return [{ id: item.id, name: item.name }]
    })
  }

  async getSubdomain(accountId: string): Promise<string | undefined> {
    try {
      const result = await this.request<unknown>(
        `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
        { method: 'GET' }
      )
      return isRecord(result) && typeof result.subdomain === 'string' ? result.subdomain : undefined
    } catch (cause) {
      if (cause instanceof CloudflareError && cause.status === 404) return undefined
      throw cause
    }
  }

  async getScript(accountId: string, scriptName: string): Promise<CloudflareScript | undefined> {
    try {
      const result = await this.request<unknown>(
        `/accounts/${encodeURIComponent(accountId)}/workers/services/${encodeURIComponent(scriptName)}`,
        { method: 'GET' }
      )
      if (!isRecord(result)) return undefined
      const environment = result.default_environment
      if (!isRecord(environment)) return undefined
      const script = environment.script
      if (!isRecord(script)) return undefined
      return typeof script.migration_tag === 'string' ? { migrationTag: script.migration_tag } : {}
    } catch (cause) {
      if (cause instanceof CloudflareError && cause.status === 404) return undefined
      throw cause
    }
  }

  /** Zones available to the token's account; `Zone:Read`. */
  async listZones(accountId: string): Promise<CloudflareZone[]> {
    const result = await this.request<unknown>(
      `/zones?account.id=${encodeURIComponent(accountId)}&per_page=50`,
      { method: 'GET' }
    )
    if (!Array.isArray(result)) throw new Error('Cloudflare returned an unexpected zone list')
    return result.flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return []
      return [{ id: item.id, name: item.name }]
    })
  }

  /** Worker custom-domain bindings; the service filter keeps redeploys idempotent. */
  async listWorkerDomains(
    accountId: string,
    scriptName: string
  ): Promise<CloudflareWorkerDomain[]> {
    const result = await this.request<unknown>(
      `/accounts/${encodeURIComponent(accountId)}/workers/domains?service=${encodeURIComponent(scriptName)}`,
      { method: 'GET' }
    )
    if (!Array.isArray(result)) {
      throw new Error('Cloudflare returned an unexpected Worker domain list')
    }
    return result.flatMap((item) => {
      const domain = readWorkerDomain(item)
      return domain ? [domain] : []
    })
  }

  /**
   * Attach a hostname in one of the account's zones to the Worker. Cloudflare
   * creates the DNS record and certificate asynchronously, so the host does not
   * answer immediately after this call.
   */
  async attachWorkerDomain(input: AttachWorkerDomainInput): Promise<CloudflareWorkerDomain> {
    const result = await this.request<unknown>(
      `/accounts/${encodeURIComponent(input.accountId)}/workers/domains`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          zone_id: input.zoneId,
          hostname: input.hostname,
          service: input.scriptName,
          environment: 'production',
        }),
      }
    )
    const domain = readWorkerDomain(result)
    if (!domain) throw new Error('Cloudflare returned an unexpected Worker domain')
    return domain
  }

  /** A missing binding is already detached, so rollback stays idempotent. */
  async detachWorkerDomain(accountId: string, domainId: string): Promise<void> {
    try {
      await this.request(
        `/accounts/${encodeURIComponent(accountId)}/workers/domains/${encodeURIComponent(domainId)}`,
        { method: 'DELETE' }
      )
    } catch (cause) {
      if (cause instanceof CloudflareError && cause.status === 404) return
      throw cause
    }
  }

  async uploadScript(input: UploadRelayScriptInput): Promise<void> {
    const form = new FormData()
    form.append(
      'metadata',
      new Blob([JSON.stringify(input.metadata)], { type: 'application/json' })
    )
    form.append(
      input.moduleName,
      new Blob([input.module], { type: 'application/javascript+module' }),
      input.moduleName
    )
    await this.request(
      `/accounts/${encodeURIComponent(input.accountId)}/workers/scripts/${encodeURIComponent(input.scriptName)}`,
      { method: 'PUT', body: form }
    )
  }

  /**
   * `previews_enabled` on the script subdomain endpoint is the Cloudflare
   * setting that turns preview/version URLs on or off; upload metadata has no
   * preview field. Wrangler sends the same body and API-date header for its
   * `preview_urls` config, so this call needs no extra token scope beyond
   * Workers Scripts: Edit.
   */
  async configureSubdomain(input: ConfigureSubdomainInput): Promise<void> {
    await this.request(
      `/accounts/${encodeURIComponent(input.accountId)}/workers/scripts/${encodeURIComponent(input.scriptName)}/subdomain`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Cloudflare-Workers-Script-Api-Date': '2025-08-01',
        },
        body: JSON.stringify({
          enabled: input.enabled,
          ...(input.previewsEnabled === undefined
            ? {}
            : { previews_enabled: input.previewsEnabled }),
        }),
      }
    )
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${this.token}`)
    headers.set('accept', 'application/json')
    headers.set('user-agent', USER_AGENT)

    let response: Response
    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(30_000),
      })
    } catch (cause) {
      throw new CloudflareError(
        `Could not reach Cloudflare: ${cause instanceof Error ? cause.message : String(cause)}`,
        { status: 0, retryable: true }
      )
    }

    const text = await response.text()
    let body: unknown
    try {
      body = text ? (JSON.parse(text) as unknown) : undefined
    } catch {
      throw new CloudflareError(
        response.ok
          ? 'Cloudflare returned an unreadable response'
          : `Cloudflare rejected the request (${response.status})`,
        { status: response.status, retryable: response.status >= 500 }
      )
    }

    if (!response.ok || (isRecord(body) && body.success === false)) {
      throw cloudflareFailure(response.status, body)
    }
    return (isRecord(body) ? body.result : undefined) as T
  }
}

function cloudflareFailure(status: number, body: unknown): CloudflareError {
  const error =
    isRecord(body) && Array.isArray(body.errors) && isRecord(body.errors[0])
      ? body.errors[0]
      : undefined
  const apiMessage =
    typeof error?.message === 'string' && error.message.trim() ? error.message : undefined
  const message =
    status === 403
      ? `Cloudflare rejected the token or it lacks a required scope. The relay deployment needs Workers Scripts: Edit, Zone: Read, and Zone: Workers Routes: Edit.${apiMessage ? ` (${apiMessage})` : ''}`
      : (apiMessage ?? `Cloudflare rejected the request (${status})`)
  return new CloudflareError(message, {
    status,
    ...(typeof error?.code === 'number' ? { code: error.code } : {}),
    ...(typeof error?.documentation_url === 'string'
      ? { documentationUrl: error.documentation_url }
      : {}),
    retryable: status === 429 || status >= 500,
  })
}

function readWorkerDomain(value: unknown): CloudflareWorkerDomain | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.zone_id !== 'string' ||
    typeof value.hostname !== 'string' ||
    typeof value.service !== 'string'
  ) {
    return undefined
  }
  return {
    id: value.id,
    zoneId: value.zone_id,
    hostname: value.hostname,
    service: value.service,
    ...(typeof value.zone_name === 'string' ? { zoneName: value.zone_name } : {}),
    ...(typeof value.environment === 'string' ? { environment: value.environment } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
