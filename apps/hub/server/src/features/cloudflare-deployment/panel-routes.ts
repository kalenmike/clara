import type { PanelFeature, PanelFeatureRequest } from '../../panel/feature.ts'
import { CloudflareClient, CloudflareError } from './cloudflare-client.ts'
import { RelayDeploymentError, validateCustomHostname } from './deploy.ts'
import type { CloudflareDeploymentState } from './state.ts'

const ROUTE_PREFIX = '/panel/api/v1/relay/cloudflare/'
const MAX_TOKEN_LENGTH = 4_096
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const ZONE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function createCloudflarePanelFeature(state: CloudflareDeploymentState): PanelFeature {
  return {
    async handleRequest(context: PanelFeatureRequest): Promise<boolean> {
      if (!context.pathname.startsWith(ROUTE_PREFIX)) return false
      if (context.method !== 'POST') {
        context.response.setHeader('allow', 'POST')
        context.sendJson(405, {
          error: { code: 'method_not_allowed', message: 'Use POST for relay deployment' },
        })
        return true
      }

      if (context.pathname === `${ROUTE_PREFIX}accounts`) {
        await handleAccounts(context, state)
        return true
      }
      if (context.pathname === `${ROUTE_PREFIX}zones`) {
        await handleZones(context, state)
        return true
      }
      if (context.pathname === `${ROUTE_PREFIX}deploy`) {
        await handleDeploy(context, state)
        return true
      }
      if (context.pathname === `${ROUTE_PREFIX}forget`) {
        handleForget(context, state)
        return true
      }
      return false
    },
    decorateSnapshot(snapshot): void {
      snapshot.relay.cloudflare = state.snapshot()
    },
  }
}

async function handleAccounts(
  context: PanelFeatureRequest,
  state: CloudflareDeploymentState
): Promise<void> {
  if (!context.requireMutation(true)) return
  const body = await context.readJson()
  if (!body.ok) return sendBodyFailure(context, body)
  if (!isRecord(body.value)) return invalidBody(context)
  const unknown = firstUnknown(body.value, ['token'])
  if (unknown) return invalidField(context, unknown)
  const rawToken = body.value.token
  if (
    rawToken !== undefined &&
    (typeof rawToken !== 'string' || rawToken.length > MAX_TOKEN_LENGTH)
  ) {
    return invalidField(context, 'token')
  }
  const token =
    typeof rawToken === 'string' && rawToken.trim() ? rawToken.trim() : await state.storedToken()
  if (!token) return tokenRequired(context)

  try {
    const client = new CloudflareClient(token)
    const accounts = await client.listAccounts()
    context.sendJson(200, { accounts })
  } catch (cause) {
    sendCloudflareFailure(context, cause)
  }
}

async function handleZones(
  context: PanelFeatureRequest,
  state: CloudflareDeploymentState
): Promise<void> {
  if (!context.requireMutation(true)) return
  const body = await context.readJson()
  if (!body.ok) return sendBodyFailure(context, body)
  if (!isRecord(body.value)) return invalidBody(context)
  const unknown = firstUnknown(body.value, ['token', 'accountId'])
  if (unknown) return invalidField(context, unknown)
  const { token: rawToken, accountId } = body.value
  if (
    rawToken !== undefined &&
    (typeof rawToken !== 'string' || rawToken.length > MAX_TOKEN_LENGTH)
  ) {
    return invalidField(context, 'token')
  }
  if (typeof accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(accountId)) {
    return invalidField(context, 'accountId')
  }

  try {
    const zones = await state.listZones({
      ...(typeof rawToken === 'string' && rawToken.trim() ? { token: rawToken.trim() } : {}),
      accountId,
    })
    context.sendJson(200, { zones })
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'token_required') {
      return tokenRequired(context)
    }
    sendCloudflareFailure(context, cause)
  }
}

async function handleDeploy(
  context: PanelFeatureRequest,
  state: CloudflareDeploymentState
): Promise<void> {
  if (!context.requireMutation(true)) return
  const body = await context.readJson()
  if (!body.ok) return sendBodyFailure(context, body)
  if (!isRecord(body.value)) return invalidBody(context)
  const unknown = firstUnknown(body.value, [
    'token',
    'accountId',
    'scriptName',
    'rememberToken',
    'replaceExisting',
    'previewUrls',
    'customDomain',
    'disableWorkersDev',
  ])
  if (unknown) return invalidField(context, unknown)

  const { token, accountId, scriptName, rememberToken, replaceExisting, previewUrls } = body.value
  if (token !== undefined && (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH)) {
    return invalidField(context, 'token')
  }
  if (typeof accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(accountId)) {
    return invalidField(context, 'accountId')
  }
  if (scriptName !== undefined && typeof scriptName !== 'string') {
    return invalidField(context, 'scriptName')
  }
  if (rememberToken !== undefined && typeof rememberToken !== 'boolean') {
    return invalidField(context, 'rememberToken')
  }
  if (replaceExisting !== undefined && typeof replaceExisting !== 'boolean') {
    return invalidField(context, 'replaceExisting')
  }
  if (previewUrls !== undefined && typeof previewUrls !== 'boolean') {
    return invalidField(context, 'previewUrls')
  }
  if (
    body.value.disableWorkersDev !== undefined &&
    typeof body.value.disableWorkersDev !== 'boolean'
  ) {
    return invalidField(context, 'disableWorkersDev')
  }

  let customDomain: { hostname: string; zoneId?: string } | undefined
  if (body.value.customDomain !== undefined) {
    if (!isRecord(body.value.customDomain)) return invalidField(context, 'customDomain')
    const customUnknown = firstUnknown(body.value.customDomain, ['hostname', 'zoneId'])
    if (customUnknown) return invalidField(context, `customDomain.${customUnknown}`)
    const hostname = body.value.customDomain.hostname
    const zoneId = body.value.customDomain.zoneId
    if (typeof hostname !== 'string') return invalidField(context, 'customDomain.hostname')
    if (zoneId !== undefined && (typeof zoneId !== 'string' || !ZONE_ID_PATTERN.test(zoneId))) {
      return invalidField(context, 'customDomain.zoneId')
    }
    try {
      customDomain = {
        hostname: validateCustomHostname(hostname),
        ...(typeof zoneId === 'string' ? { zoneId } : {}),
      }
    } catch (cause) {
      if (cause instanceof RelayDeploymentError) {
        context.sendJson(400, { error: { code: cause.code, message: cause.message } })
        return
      }
      throw cause
    }
  }

  try {
    const outcome = await state.deploy({
      ...(typeof token === 'string' ? { token } : {}),
      accountId,
      ...(typeof scriptName === 'string' ? { scriptName } : {}),
      ...(typeof rememberToken === 'boolean' ? { rememberToken } : {}),
      ...(typeof replaceExisting === 'boolean' ? { replaceExisting } : {}),
      ...(typeof previewUrls === 'boolean' ? { previewUrls } : {}),
      ...(customDomain ? { customDomain } : {}),
      ...(typeof body.value.disableWorkersDev === 'boolean'
        ? { disableWorkersDev: body.value.disableWorkersDev }
        : {}),
    })
    context.sendJson(200, outcome)
  } catch (cause) {
    if (cause instanceof RelayDeploymentError) {
      context.sendJson(400, { error: { code: cause.code, message: cause.message } })
      return
    }
    if (cause instanceof CloudflareError) {
      sendCloudflareFailure(context, cause)
      return
    }
    if (cause instanceof Error && STATE_ERRORS.has(cause.message)) {
      context.sendJson(stateErrorStatus(cause.message), {
        error: { code: cause.message, message: stateErrorMessage(cause.message) },
      })
      return
    }
    context.log('cloudflare relay deployment failed', cause)
    context.sendJson(502, {
      error: {
        code: 'deploy_failed',
        message: cause instanceof Error ? cause.message : String(cause),
      },
    })
  }
}

function handleForget(context: PanelFeatureRequest, state: CloudflareDeploymentState): void {
  if (!context.requireMutation()) return
  context.sendJson(200, { deployment: state.forgetToken() })
}

const STATE_ERRORS = new Set(['deploy_in_progress', 'env_managed', 'token_required'])

function stateErrorStatus(code: string): number {
  return code === 'token_required' ? 400 : 409
}

function stateErrorMessage(code: string): string {
  switch (code) {
    case 'deploy_in_progress':
      return 'A relay deployment is already running'
    case 'env_managed':
      return 'Relay settings come from the environment. Remove CLARA_RELAY_URL, CLARA_RELAY_ROOM, and the relay tokens before deploying from the panel.'
    case 'token_required':
      return 'Enter a Cloudflare API token'
    default:
      return 'The relay deployment could not start'
  }
}

function sendCloudflareFailure(context: PanelFeatureRequest, cause: unknown): void {
  if (!(cause instanceof CloudflareError)) {
    context.log('cloudflare request failed', cause)
    context.sendJson(502, {
      error: { code: 'cloudflare_failed', message: 'The Cloudflare request failed' },
    })
    return
  }
  if (cause.status === 401 || cause.status === 403) {
    context.sendJson(403, {
      error: {
        code: 'cloudflare_unauthorized',
        message:
          'Cloudflare rejected the token or it lacks a required scope. The relay deployment needs Workers Scripts: Edit, Zone: Read, and Zone: Workers Routes: Edit.',
      },
    })
    return
  }
  if (cause.retryable) {
    context.sendJson(503, {
      error: {
        code: 'cloudflare_unavailable',
        message: 'Cloudflare is temporarily unavailable. Try again in a moment.',
      },
    })
    return
  }
  context.sendJson(502, {
    error: {
      code: 'cloudflare_failed',
      message: cause.message,
      ...(cause.documentationUrl ? { documentationUrl: cause.documentationUrl } : {}),
    },
  })
}

function sendBodyFailure(
  context: PanelFeatureRequest,
  body: Extract<Awaited<ReturnType<PanelFeatureRequest['readJson']>>, { ok: false }>
): void {
  context.sendJson(body.status, { error: { code: body.code, message: body.message } })
}

function invalidBody(context: PanelFeatureRequest): void {
  context.sendJson(400, {
    error: { code: 'invalid_body', message: 'The request body must be a JSON object' },
  })
}

function tokenRequired(context: PanelFeatureRequest): void {
  context.sendJson(400, {
    error: { code: 'token_required', message: 'Enter a Cloudflare API token' },
  })
}

function invalidField(context: PanelFeatureRequest, field: string): void {
  context.sendJson(400, {
    error: { code: 'invalid_body', message: `Invalid or unknown field: ${field}` },
  })
}

function firstUnknown(body: Record<string, unknown>, allowed: string[]): string | undefined {
  return Object.keys(body).find((key) => !allowed.includes(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
