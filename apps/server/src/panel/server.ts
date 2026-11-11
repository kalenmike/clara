import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import type { Server } from 'node:http'
import {
  isSyncIntervalMs,
  type PanelAuthInfo,
  type PanelConfigUpdate,
  type PanelFeatureName,
  type PanelMutationResponse,
} from '@clara/shared-types'
import { SERVER_VERSION } from '../version.ts'
import { PanelAuth, PanelAuthError, type PanelAuthUser } from './auth.ts'
import { readControlFailure, type PanelControlService } from './controls.ts'
import { checkPanelRequest } from './security.ts'
import type { PanelDataSource } from './runtime.ts'
import { parseShellPolicy } from '../shell-policy.ts'

const API_PATH = '/panel/api/v1/status'
const SESSION_PATH = '/panel/api/v1/session'
const SETUP_PATH = '/panel/api/v1/setup'
const PASSWORD_PATH = '/panel/api/v1/account/password'
const FEATURES_PATH = '/panel/api/v1/features'
const AGENT_PATH = '/panel/api/v1/agent'
const SHELL_PATH = '/panel/api/v1/shell'
const MONITORING_PATH = '/panel/api/v1/monitoring'
const SYNC_PATH = '/panel/api/v1/sync'
const ORCHESTRATION_PATH = '/panel/api/v1/orchestration'
const CONFIG_PATH = '/panel/api/v1/config'
const HARNESSES_PREFIX = '/panel/api/v1/harnesses'
const DEVICES_PREFIX = '/panel/api/v1/devices'
const HEALTH_PATH = '/health'
const ASSETS_PREFIX = '/assets/'
const PANEL_HEADER = 'x-clara-panel'
const MAX_BODY_BYTES = 8 * 1024
const FEATURE_NAMES: PanelFeatureName[] = ['opencode', 'local', 'relay', 'push']

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-dns-prefetch-control': 'off',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

export type PanelServerOptions = {
  source: PanelDataSource
  controls?: PanelControlService
  auth: PanelAuth
  port: number
  host?: string
  allowRemote?: boolean
  assetsDir?: string
  log?: (message: string, detail?: unknown) => void
}

export type PanelServer = {
  url: string
  port: number
  close: () => Promise<void>
}

export async function startPanelServer(options: PanelServerOptions): Promise<PanelServer> {
  const assetsRoot = resolveAssetsRoot(options.assetsDir)
  const indexHtml = readIndexHtml(assetsRoot)
  let port = options.port
  const host = options.host ?? '127.0.0.1'

  // Cookies are host-scoped, so unrelated apps on 127.0.0.1 can share a jar
  // larger than Node's 16k default.
  const server = createServer({ maxHeaderSize: 64 * 1024 }, (request, response) => {
    void handleRequest(request, response, {
      source: options.source,
      controls: options.controls,
      auth: options.auth,
      port,
      allowRemote: options.allowRemote === true,
      assetsRoot,
      indexHtml,
      log: options.log,
    }).catch((cause) => {
      options.log?.('panel request failed', cause)
      if (!response.headersSent) {
        sendJson(response, request.method, 500, {
          error: { code: 'internal', message: 'The agent panel could not complete the request' },
        })
      } else {
        response.end()
      }
    })
  })

  await listen(server, host, options.port)
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('The panel server did not report a TCP address')
  }
  port = address.port

  const advertisedHost = isUnspecifiedHost(host) ? '127.0.0.1' : host
  return {
    url: `http://${formatHost(advertisedHost)}:${port}/`,
    port,
    close: () => closeServer(server),
  }
}

type RequestContext = {
  source: PanelDataSource
  controls?: PanelControlService
  auth: PanelAuth
  port: number
  allowRemote: boolean
  assetsRoot: string | undefined
  indexHtml: Buffer | undefined
  log?: (message: string, detail?: unknown) => void
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext
): Promise<void> {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value)
  }

  const check = checkPanelRequest(request, context.port, { allowRemote: context.allowRemote })
  if (!check.ok) {
    sendJson(response, request.method, check.status, {
      error: { code: 'forbidden', message: check.message },
    })
    return
  }

  const method = request.method ?? 'GET'

  let pathname: string
  try {
    pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  } catch {
    sendJson(response, method, 400, {
      error: { code: 'bad_request', message: 'Invalid request path' },
    })
    return
  }

  if (pathname === HEALTH_PATH && (method === 'GET' || method === 'HEAD')) {
    sendJson(response, method, 200, {
      ok: true,
      service: 'clara-server',
      version: SERVER_VERSION,
      mode: isContainerized() ? 'container' : 'local',
    })
    return
  }

  if (pathname === SESSION_PATH) {
    await handleSession(request, response, context, method)
    return
  }

  if (pathname === SETUP_PATH) {
    await handleSetup(request, response, context, method)
    return
  }

  if (pathname.startsWith('/panel/api/')) {
    const user = context.auth.session(PanelAuth.readCookie(request.headers.cookie))
    if (!user) {
      sendJson(response, method, 401, {
        error: { code: 'unauthorized', message: 'Sign in to the agent panel' },
      })
      return
    }

    if (pathname === API_PATH) {
      if (method !== 'GET' && method !== 'HEAD') {
        response.setHeader('allow', 'GET, HEAD')
        sendJson(response, method, 405, {
          error: { code: 'method_not_allowed', message: 'The status endpoint is read-only' },
        })
        return
      }
      try {
        const snapshot = await context.source.snapshot(authInfo(user))
        sendJson(response, method, 200, snapshot)
      } catch (cause) {
        context.log?.('could not build the panel snapshot', cause)
        sendJson(response, method, 500, {
          error: { code: 'snapshot_failed', message: 'Could not read the agent status' },
        })
      }
      return
    }

    if (pathname === PASSWORD_PATH) {
      await handlePassword(request, response, context, method, user)
      return
    }

    if (pathname === HARNESSES_PREFIX || pathname.startsWith(`${HARNESSES_PREFIX}/`)) {
      await handleHarness(request, response, context, method, pathname)
      return
    }

    if (pathname === DEVICES_PREFIX || pathname.startsWith(`${DEVICES_PREFIX}/`)) {
      await handleDevices(request, response, context, method, pathname)
      return
    }

    if (method === 'POST') {
      await handleMutation(request, response, context, pathname)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD')
      sendJson(response, method, 405, {
        error: { code: 'method_not_allowed', message: 'Unknown panel endpoint' },
      })
      return
    }

    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'Unknown panel endpoint' },
    })
    return
  }

  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD')
    sendJson(response, method, 405, {
      error: { code: 'method_not_allowed', message: 'The agent panel is read-only' },
    })
    return
  }

  if (pathname === '/' || pathname === '/index.html') {
    if (!context.indexHtml) {
      sendText(
        response,
        method,
        503,
        'text/plain; charset=utf-8',
        'The Clara agent panel is not built. Run `pnpm build` in the repository, then restart the agent.\n'
      )
      return
    }
    sendBuffer(response, method, 200, 'text/html; charset=utf-8', context.indexHtml, 'no-store')
    return
  }

  const assetPath =
    pathname === '/favicon.svg'
      ? pathname
      : pathname.startsWith(ASSETS_PREFIX)
        ? pathname
        : undefined
  if (!assetPath) {
    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'Not found' },
    })
    return
  }

  const file = resolveAsset(context.assetsRoot, assetPath)
  const contentType = file ? CONTENT_TYPES[extname(file)] : undefined
  if (!file || !contentType) {
    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'Not found' },
    })
    return
  }

  try {
    const body = readFileSync(file)
    const cache = pathname.startsWith(ASSETS_PREFIX)
      ? 'public, max-age=31536000, immutable'
      : 'no-store'
    sendBuffer(response, method, 200, contentType, body, cache)
  } catch (cause) {
    context.log?.('could not read a panel asset', cause)
    sendJson(response, method, 500, {
      error: { code: 'asset_failed', message: 'Could not read the panel asset' },
    })
  }
}

async function handleSession(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  method: string
): Promise<void> {
  if (method === 'GET' || method === 'HEAD') {
    const status = context.auth.status(PanelAuth.readCookie(request.headers.cookie))
    sendJson(response, method, 200, status)
    return
  }

  if (method === 'DELETE') {
    const user = context.auth.session(PanelAuth.readCookie(request.headers.cookie))
    if (!user) {
      sendJson(response, method, 401, {
        error: { code: 'unauthorized', message: 'Sign in to the agent panel' },
      })
      return
    }
    if (!requireMutationHeader(request, response, method)) return
    context.auth.logout(PanelAuth.readCookie(request.headers.cookie))
    sendJson(
      response,
      method,
      200,
      { ok: true },
      { 'set-cookie': context.auth.clearCookieHeader() }
    )
    return
  }

  if (method !== 'POST') {
    response.setHeader('allow', 'GET, HEAD, POST, DELETE')
    sendJson(response, method, 405, {
      error: { code: 'method_not_allowed', message: 'Unsupported session method' },
    })
    return
  }

  if (!requireMutationHeader(request, response, method, true)) return
  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, method, body.status, { error: { code: body.code, message: body.message } })
    return
  }
  if (!isRecord(body.value)) {
    sendJson(response, method, 400, {
      error: { code: 'invalid_body', message: 'The request body must be a JSON object' },
    })
    return
  }
  const unknown = unknownFields(body.value, ['username', 'password'])
  if (unknown) return invalidField(response, method, unknown)
  const username = body.value.username
  const password = body.value.password
  if (typeof username !== 'string' || typeof password !== 'string') {
    return invalidField(response, method, 'username or password')
  }

  try {
    const result = await context.auth.login(username, password, requestSource(request))
    sendJson(
      response,
      method,
      200,
      { user: result.user },
      { 'set-cookie': context.auth.cookieHeader(result.token, result.maxAgeSeconds) }
    )
  } catch (cause) {
    sendAuthFailure(response, method, cause)
  }
}

async function handleSetup(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  method: string
): Promise<void> {
  if (method !== 'POST') {
    response.setHeader('allow', 'POST')
    sendJson(response, method, 405, {
      error: { code: 'method_not_allowed', message: 'Use POST to set up the panel' },
    })
    return
  }
  if (!requireMutationHeader(request, response, method, true)) return
  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, method, body.status, { error: { code: body.code, message: body.message } })
    return
  }
  if (!isRecord(body.value)) {
    sendJson(response, method, 400, {
      error: { code: 'invalid_body', message: 'The request body must be a JSON object' },
    })
    return
  }
  const unknown = unknownFields(body.value, ['token', 'username', 'password'])
  if (unknown) return invalidField(response, method, unknown)
  const token = body.value.token
  const username = body.value.username
  const password = body.value.password
  if (typeof token !== 'string') return invalidField(response, method, 'token')
  if (typeof username !== 'string') return invalidField(response, method, 'username')
  if (typeof password !== 'string') return invalidField(response, method, 'password')

  try {
    const result = await context.auth.setup(token, username, password)
    sendJson(
      response,
      method,
      200,
      { user: result.user },
      { 'set-cookie': context.auth.cookieHeader(result.token, result.maxAgeSeconds) }
    )
  } catch (cause) {
    sendAuthFailure(response, method, cause)
  }
}

async function handlePassword(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  method: string,
  user: PanelAuthUser
): Promise<void> {
  if (method !== 'POST') {
    response.setHeader('allow', 'POST')
    sendJson(response, method, 405, {
      error: { code: 'method_not_allowed', message: 'Use POST to change the password' },
    })
    return
  }
  if (!requireMutationHeader(request, response, method, true)) return
  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, method, body.status, { error: { code: body.code, message: body.message } })
    return
  }
  if (!isRecord(body.value)) {
    sendJson(response, method, 400, {
      error: { code: 'invalid_body', message: 'The request body must be a JSON object' },
    })
    return
  }
  const unknown = unknownFields(body.value, ['currentPassword', 'newPassword'])
  if (unknown) return invalidField(response, method, unknown)
  const currentPassword = body.value.currentPassword
  const newPassword = body.value.newPassword
  if (typeof currentPassword !== 'string') return invalidField(response, method, 'currentPassword')
  if (typeof newPassword !== 'string') return invalidField(response, method, 'newPassword')

  try {
    const result = await context.auth.changePassword(user.id, currentPassword, newPassword)
    sendJson(
      response,
      method,
      200,
      { user: result.user },
      { 'set-cookie': context.auth.cookieHeader(result.token, result.maxAgeSeconds) }
    )
  } catch (cause) {
    sendAuthFailure(response, method, cause)
  }
}

async function handleHarness(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  method: string,
  pathname: string
): Promise<void> {
  const controls = context.controls
  if (!controls) {
    sendJson(response, method, 503, {
      error: { code: 'controls_unavailable', message: 'Agent controls are not available' },
    })
    return
  }
  if (!requireMutationHeader(request, response, method, method === 'POST')) return

  const rest = pathname.slice(HARNESSES_PREFIX.length)
  const parts = rest.split('/').filter(Boolean).map(decodeSegment)
  if (parts.some((part) => part === undefined)) {
    sendJson(response, method, 400, {
      error: { code: 'bad_request', message: 'Invalid harness id' },
    })
    return
  }
  const [id, action] = parts as string[]

  try {
    if (method === 'POST' && !id) {
      const body = await readJsonBody(request)
      if (!body.ok) return sendBodyFailure(response, method, body)
      if (!isRecord(body.value)) {
        return sendJson(response, method, 400, {
          error: { code: 'invalid_body', message: 'The request body must be a JSON object' },
        })
      }
      const unknown = harnessUnknownField(body.value)
      if (unknown) return invalidField(response, method, unknown)
      const result = await controls.saveHarness(body.value)
      sendJson(response, method, 200, result)
      return
    }

    if (method === 'POST' && id && !action) {
      const body = await readJsonBody(request)
      if (!body.ok) return sendBodyFailure(response, method, body)
      if (!isRecord(body.value)) {
        return sendJson(response, method, 400, {
          error: { code: 'invalid_body', message: 'The request body must be a JSON object' },
        })
      }
      const unknown = harnessUnknownField(body.value)
      if (unknown) return invalidField(response, method, unknown)
      const result = await controls.saveHarness(body.value, id)
      sendJson(response, method, 200, result)
      return
    }

    if (method === 'POST' && id && action === 'test') {
      const body = await readJsonBody(request)
      if (!body.ok) return sendBodyFailure(response, method, body)
      if (!isRecord(body.value)) {
        return sendJson(response, method, 400, {
          error: { code: 'invalid_body', message: 'The request body must be a JSON object' },
        })
      }
      const unknown = harnessUnknownField(body.value)
      if (unknown) return invalidField(response, method, unknown)
      sendJson(response, method, 200, await controls.testHarness(body.value, id))
      return
    }

    if (method === 'POST' && id && action === 'activate') {
      sendJson(response, method, 200, await controls.activateHarness(id))
      return
    }

    if (method === 'DELETE' && id && !action) {
      sendJson(response, method, 200, await controls.deleteHarness(id))
      return
    }

    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'Unknown harness endpoint' },
    })
  } catch (cause) {
    const failure = readControlFailure(cause)
    if (failure) {
      sendJson(response, method, failure.status, {
        error: { code: failure.code, message: failure.message },
      })
      return
    }
    context.log?.('harness control failed', cause)
    sendJson(response, method, 500, {
      error: { code: 'harness_failed', message: 'Could not apply the harness change' },
    })
  }
}

async function handleDevices(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  method: string,
  pathname: string
): Promise<void> {
  const controls = context.controls
  if (!controls) {
    sendJson(response, method, 503, {
      error: { code: 'controls_unavailable', message: 'Agent controls are not available' },
    })
    return
  }

  const rest = pathname.startsWith(`${DEVICES_PREFIX}/`)
    ? pathname.slice(DEVICES_PREFIX.length + 1)
    : ''
  const parts = rest.split('/')
  let id: string
  let action: string | undefined
  try {
    id = parts[0] ? decodeURIComponent(parts[0]) : ''
    action = parts[1] ? decodeURIComponent(parts[1]) : undefined
  } catch {
    sendJson(response, method, 400, {
      error: { code: 'bad_request', message: 'Invalid device path' },
    })
    return
  }
  if (!id || id.includes('/') || parts.length > 2 || (action && action !== 'purge')) {
    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'Unknown device endpoint' },
    })
    return
  }

  if (action === 'purge') {
    if (method !== 'POST') {
      response.setHeader('allow', 'POST')
      sendJson(response, method, 405, {
        error: { code: 'method_not_allowed', message: 'Use POST to purge a revoked device' },
      })
      return
    }
    if (!requireMutationHeader(request, response, method)) return
    try {
      const device = controls.purgeDevice(id)
      if (!device) {
        sendJson(response, method, 404, {
          error: { code: 'not_found', message: 'That device no longer exists' },
        })
        return
      }
      sendJson(response, method, 200, { id: device.id })
    } catch (cause) {
      const failure = readControlFailure(cause)
      if (failure) {
        sendJson(response, method, failure.status, {
          error: { code: failure.code, message: failure.message },
        })
        return
      }
      context.log?.('device purge failed', cause)
      sendJson(response, method, 500, {
        error: { code: 'device_purge_failed', message: 'Could not delete the device record' },
      })
    }
    return
  }

  if (method !== 'DELETE') {
    response.setHeader('allow', 'DELETE')
    sendJson(response, method, 405, {
      error: { code: 'method_not_allowed', message: 'Use DELETE to revoke a device' },
    })
    return
  }

  if (!requireMutationHeader(request, response, method)) return
  const device = controls.revokeDevice(id)
  if (!device) {
    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'That device no longer exists' },
    })
    return
  }
  sendJson(response, method, 200, { id: device.id })
}

async function handleMutation(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  pathname: string
): Promise<void> {
  const method = request.method ?? 'POST'

  if (pathname === API_PATH) {
    response.setHeader('allow', 'GET, HEAD')
    sendJson(response, method, 405, {
      error: { code: 'method_not_allowed', message: 'The status endpoint is read-only' },
    })
    return
  }

  const kind =
    pathname === FEATURES_PATH
      ? 'features'
      : pathname === AGENT_PATH
        ? 'agent'
        : pathname === SHELL_PATH
          ? 'shell'
          : pathname === MONITORING_PATH
            ? 'monitoring'
            : pathname === SYNC_PATH
              ? 'sync'
              : pathname === ORCHESTRATION_PATH
                ? 'orchestration'
                : pathname === CONFIG_PATH
                  ? 'config'
                  : undefined
  if (!kind) {
    sendJson(response, method, 404, {
      error: { code: 'not_found', message: 'Unknown panel endpoint' },
    })
    return
  }

  const controls = context.controls
  if (!controls) {
    sendJson(response, method, 503, {
      error: { code: 'controls_unavailable', message: 'Agent controls are not available' },
    })
    return
  }

  if (!requireMutationHeader(request, response, method, true)) return

  const body = await readJsonBody(request)
  if (!body.ok) {
    sendJson(response, method, body.status, { error: { code: body.code, message: body.message } })
    return
  }
  if (!isRecord(body.value)) {
    sendJson(response, method, 400, {
      error: { code: 'invalid_body', message: 'The request body must be a JSON object' },
    })
    return
  }

  try {
    let updated
    if (kind === 'features') {
      const unknown = unknownFields(body.value, ['feature', 'enabled'])
      if (unknown) return invalidField(response, method, unknown)
      const feature = body.value.feature
      if (typeof feature !== 'string' || !FEATURE_NAMES.includes(feature as PanelFeatureName)) {
        return invalidField(response, method, 'feature')
      }
      if (typeof body.value.enabled !== 'boolean') {
        return invalidField(response, method, 'enabled')
      }
      updated = await controls.setFeature(feature as PanelFeatureName, body.value.enabled)
    } else if (kind === 'agent') {
      const unknown = unknownFields(body.value, ['stopped'])
      if (unknown) return invalidField(response, method, unknown)
      if (typeof body.value.stopped !== 'boolean') {
        return invalidField(response, method, 'stopped')
      }
      updated = await controls.setStopped(body.value.stopped)
    } else if (kind === 'shell') {
      const unknown = unknownFields(body.value, ['mode', 'commands'])
      if (unknown) return invalidField(response, method, unknown)
      const parsed = parseShellPolicy(body.value.mode, body.value.commands)
      if (!parsed.ok) {
        sendJson(response, method, 400, {
          error: { code: 'invalid_body', message: parsed.message },
        })
        return
      }
      updated = await controls.setShellPolicy(parsed.policy)
    } else if (kind === 'monitoring') {
      const unknown = unknownFields(body.value, ['enabled'])
      if (unknown) return invalidField(response, method, unknown)
      if (typeof body.value.enabled !== 'boolean') {
        return invalidField(response, method, 'enabled')
      }
      updated = await controls.setMonitoring(body.value.enabled)
    } else if (kind === 'orchestration') {
      const unknown = unknownFields(body.value, ['enabled'])
      if (unknown) return invalidField(response, method, unknown)
      if (typeof body.value.enabled !== 'boolean') {
        return invalidField(response, method, 'enabled')
      }
      updated = await controls.setOrchestration(body.value.enabled)
    } else if (kind === 'config') {
      const unknown = unknownFields(body.value, ['pairingBaseUrl', 'vapidSubject'])
      if (unknown) return invalidField(response, method, unknown)

      const update: PanelConfigUpdate = {}
      if ('pairingBaseUrl' in body.value) {
        const value = body.value.pairingBaseUrl
        if (value !== null && typeof value !== 'string') {
          return invalidField(response, method, 'pairingBaseUrl')
        }
        update.pairingBaseUrl = value
      }
      if ('vapidSubject' in body.value) {
        const value = body.value.vapidSubject
        if (value !== null && typeof value !== 'string') {
          return invalidField(response, method, 'vapidSubject')
        }
        update.vapidSubject = value
      }
      if (Object.keys(update).length === 0) {
        return invalidField(response, method, 'pairingBaseUrl or vapidSubject')
      }

      const config = await controls.updateConfig(update)
      sendJson(response, method, 200, { config })
      return
    } else {
      const unknown = unknownFields(body.value, ['enabled', 'intervalMs'])
      if (unknown) return invalidField(response, method, unknown)
      if (typeof body.value.enabled !== 'boolean') {
        return invalidField(response, method, 'enabled')
      }
      if (!isSyncIntervalMs(body.value.intervalMs)) {
        return invalidField(response, method, 'intervalMs')
      }
      updated = await controls.setSync({
        enabled: body.value.enabled,
        intervalMs: body.value.intervalMs,
      })
    }

    const payload: PanelMutationResponse = { controls: updated }
    sendJson(response, method, 200, payload)
  } catch (cause) {
    const failure = readControlFailure(cause)
    if (failure) {
      sendJson(response, method, failure.status, {
        error: { code: failure.code, message: failure.message },
      })
      return
    }
    context.log?.('panel mutation failed', cause)
    sendJson(response, method, 500, {
      error: { code: 'mutation_failed', message: 'Could not apply the agent change' },
    })
  }
}

function requireMutationHeader(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  requireJson = false
): boolean {
  if (request.headers[PANEL_HEADER] !== '1') {
    sendJson(response, method, 403, {
      error: {
        code: 'missing_panel_header',
        message: `Mutations require the ${PANEL_HEADER}: 1 request header`,
      },
    })
    return false
  }
  if (requireJson && !isJsonContentType(request.headers['content-type'])) {
    sendJson(response, method, 415, {
      error: { code: 'unsupported_media_type', message: 'Use content-type: application/json' },
    })
    return false
  }
  return true
}

function sendAuthFailure(response: ServerResponse, method: string, cause: unknown): void {
  if (cause instanceof PanelAuthError) {
    sendJson(
      response,
      method,
      cause.status,
      { error: { code: cause.code, message: cause.message } },
      cause.retryAfter ? { 'retry-after': String(cause.retryAfter) } : undefined
    )
    return
  }
  sendJson(response, method, 500, {
    error: { code: 'auth_failed', message: 'Could not complete the sign-in request' },
  })
}

function authInfo(user: PanelAuthUser): PanelAuthInfo {
  return { username: user.username, role: user.role }
}

function requestSource(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown'
}

function invalidField(response: ServerResponse, method: string, field: string): void {
  sendJson(response, method, 400, {
    error: { code: 'invalid_body', message: `Invalid or unknown field: ${field}` },
  })
}

function sendBodyFailure(
  response: ServerResponse,
  method: string,
  body: Extract<Awaited<ReturnType<typeof readJsonBody>>, { ok: false }>
): void {
  sendJson(response, method, body.status, {
    error: { code: body.code, message: body.message },
  })
}

function harnessUnknownField(body: Record<string, unknown>): string | undefined {
  return unknownFields(body, [
    'kind',
    'label',
    'baseUrl',
    'authType',
    'username',
    'password',
    'options',
  ])
}

function unknownFields(body: Record<string, unknown>, allowed: string[]): string | undefined {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) return key
  }
  return undefined
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  if (typeof value !== 'string') return false
  return value.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

type JsonBody =
  { ok: true; value: unknown } | { ok: false; status: number; code: string; message: string }

async function readJsonBody(request: IncomingMessage): Promise<JsonBody> {
  const declared = Number.parseInt(request.headers['content-length'] ?? '', 10)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'body_too_large',
      message: `The request body may be at most ${MAX_BODY_BYTES} bytes`,
    }
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += buffer.byteLength
    if (total > MAX_BODY_BYTES) {
      return {
        ok: false,
        status: 413,
        code: 'body_too_large',
        message: `The request body may be at most ${MAX_BODY_BYTES} bytes`,
      }
    }
    chunks.push(buffer)
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  } catch {
    return { ok: false, status: 400, code: 'invalid_json', message: 'The request body is not JSON' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeSegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value)
    return decoded && decoded.length <= 128 && !decoded.includes('/') ? decoded : undefined
  } catch {
    return undefined
  }
}

function resolveAssetsRoot(assetsDir: string | undefined): string | undefined {
  if (!assetsDir) return undefined
  try {
    return realpathSync(assetsDir)
  } catch {
    return undefined
  }
}

function readIndexHtml(assetsRoot: string | undefined): Buffer | undefined {
  if (!assetsRoot) return undefined
  try {
    return readFileSync(join(assetsRoot, 'index.html'))
  } catch {
    return undefined
  }
}

function resolveAsset(assetsRoot: string | undefined, requestPath: string): string | undefined {
  if (!assetsRoot) return undefined

  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return undefined
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) return undefined

  try {
    const target = realpathSync(resolve(assetsRoot, `.${decoded}`))
    if (target !== assetsRoot && !target.startsWith(`${assetsRoot}${sep}`)) return undefined
    return statSync(target).isFile() ? target : undefined
  } catch {
    return undefined
  }
}

function sendJson(
  response: ServerResponse,
  method: string | undefined,
  status: number,
  body: unknown,
  headers?: Record<string, string>
): void {
  const text = JSON.stringify(body)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-length', Buffer.byteLength(text))
  for (const [name, value] of Object.entries(headers ?? {})) response.setHeader(name, value)
  response.end(method === 'HEAD' ? undefined : text)
}

function sendText(
  response: ServerResponse,
  method: string | undefined,
  status: number,
  contentType: string,
  text: string
): void {
  sendBuffer(response, method, status, contentType, Buffer.from(text), 'no-store')
}

function sendBuffer(
  response: ServerResponse,
  method: string | undefined,
  status: number,
  contentType: string,
  body: Buffer,
  cacheControl: string
): void {
  response.statusCode = status
  response.setHeader('content-type', contentType)
  response.setHeader('cache-control', cacheControl)
  response.setHeader('content-length', body.byteLength)
  response.end(method === 'HEAD' ? undefined : body)
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onError = (cause: Error) => {
      server.off('listening', onListening)
      reject(cause)
    }
    const onListening = () => {
      server.off('error', onError)
      resolvePromise()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => {
    server.close(() => resolvePromise())
    server.closeAllConnections()
  })
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

function isUnspecifiedHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]'
}

function isContainerized(): boolean {
  const value = process.env.CLARA_SERVER_CONTAINER?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}
