import { Hono, type Context } from 'hono'
import { AdapterError } from './errors.ts'
import {
  parseClaraAgentList,
  parseClaraCommandList,
  parseClaraFiles,
  parseClaraForms,
  parseClaraLocation,
  parseClaraModelList,
  parseClaraPermissionRequests,
  parseClaraProject,
  parseClaraProjects,
  parseClaraProviderList,
  parseClaraReferenceList,
  parseClaraServerInfo,
  parseClaraSession,
  parseClaraSessionActive,
  parseClaraSessionInbox,
  parseClaraSessionInboxCompaction,
  parseClaraSessionInboxSynthetic,
  parseClaraSessionInboxUser,
  parseClaraSessionInterrupt,
  parseClaraSessionMessages,
  parseClaraSessionMessagesResponse,
  parseClaraSessions,
  parseClaraSkillList,
  parseClaraVcs,
  parseClaraVcsBase,
  parseClaraVcsDiff,
  parseClaraVcsStatus,
  parseClaraWorktrees,
} from './dto.ts'
import { loadGitLog } from './git.ts'
import { OpenCodeClient, type OpenCodeRequest } from './opencode.ts'

export type AdapterContext = {
  opencode: OpenCodeClient
  info: {
    adapter: { name: string; version: string }
    harness: { kind: string; version?: string }
    capabilities: Record<string, unknown>
  }
}

type Parse<T> = (value: unknown) => T

export function createAdapterApp(context: AdapterContext): Hono {
  const app = new Hono()
  const client = context.opencode

  app.get('/harness/v1/info', (c) =>
    c.json({
      protocol: 1,
      adapter: context.info.adapter,
      harness: context.info.harness,
      capabilities: context.info.capabilities,
    })
  )

  app.get('/harness/v1/harness/info', async (c) =>
    json(c, 'GET', '/api/info', undefined, parseClaraServerInfo)
  )

  app.get('/harness/v1/projects', async (c) =>
    json(c, 'GET', '/api/project', undefined, parseClaraProjects, c.req.query())
  )

  app.patch('/harness/v1/projects/:projectID', async (c) =>
    json(
      c,
      'PATCH',
      `/api/project/${encodeURIComponent(c.req.param('projectID'))}`,
      await body(c),
      parseClaraProject,
      undefined,
      true
    )
  )

  app.get('/harness/v1/locations', async (c) =>
    json(c, 'GET', '/api/location', undefined, parseClaraLocation, queryLocation(c.req.query()))
  )

  app.get('/harness/v1/files/find', async (c) =>
    json(c, 'GET', '/api/fs/find', undefined, parseClaraFiles, queryLocation(c.req.query()))
  )

  app.get('/harness/v1/vcs', async (c) =>
    json(c, 'GET', '/api/vcs', undefined, parseClaraVcs, queryLocation(c.req.query()))
  )
  app.get('/harness/v1/vcs/base', async (c) =>
    json(c, 'GET', '/api/vcs/base', undefined, parseClaraVcsBase, queryLocation(c.req.query()))
  )
  app.get('/harness/v1/vcs/status', async (c) =>
    json(c, 'GET', '/api/vcs/status', undefined, parseClaraVcsStatus, queryLocation(c.req.query()))
  )
  app.get('/harness/v1/vcs/diff', async (c) =>
    json(c, 'POST', '/api/vcs/diff', undefined, parseClaraVcsDiff, queryLocation(c.req.query()))
  )

  app.get('/harness/v1/worktrees', async (c) =>
    json(c, 'GET', '/api/worktree', undefined, parseClaraWorktrees, c.req.query())
  )
  app.post('/harness/v1/worktrees/refresh', async (c) => {
    await empty(c, 'POST', '/api/worktree/refresh', await body(c))
    return c.body(null, 204)
  })

  app.get('/harness/v1/sessions', async (c) =>
    json(c, 'GET', '/api/session', undefined, parseClaraSessions, c.req.query())
  )
  app.post('/harness/v1/sessions', async (c) =>
    json(c, 'POST', '/api/session', await body(c), parseClaraSession, undefined, true)
  )
  app.get('/harness/v1/sessions/active', async (c) =>
    json(c, 'GET', '/api/session/active', undefined, parseClaraSessionActive, undefined, true)
  )
  app.get('/harness/v1/sessions/:sessionID', async (c) =>
    json(
      c,
      'GET',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}`,
      undefined,
      parseClaraSession,
      undefined,
      true
    )
  )
  app.patch('/harness/v1/sessions/:sessionID', async (c) => {
    await empty(
      c,
      'PATCH',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}`,
      await body(c)
    )
    return c.body(null, 204)
  })
  app.delete('/harness/v1/sessions/:sessionID', async (c) => {
    await empty(c, 'DELETE', `/api/session/${encodeURIComponent(c.req.param('sessionID'))}`)
    return c.body(null, 204)
  })

  registerSessionAction(app, 'fork', parseClaraSession, true)
  registerSessionAction(app, 'move')
  registerSessionAction(app, 'view')
  registerSessionAction(app, 'prompt', parseClaraSessionInboxUser, true)
  registerSessionAction(app, 'synthetic', parseClaraSessionInboxSynthetic, true)
  registerSessionAction(app, 'command')
  registerSessionAction(app, 'interrupt', parseClaraSessionInterrupt, true)
  registerSessionAction(app, 'compact', parseClaraSessionInboxCompaction, true)
  registerSessionAction(app, 'agent')
  registerSessionAction(app, 'model')

  app.get('/harness/v1/sessions/:sessionID/messages', async (c) =>
    json(
      c,
      'GET',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}/message`,
      undefined,
      parseClaraSessionMessagesResponse,
      c.req.query()
    )
  )
  app.get('/harness/v1/sessions/:sessionID/context', async (c) =>
    json(
      c,
      'GET',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}/context`,
      undefined,
      parseClaraSessionMessages,
      undefined,
      true
    )
  )
  app.get('/harness/v1/sessions/:sessionID/forms', async (c) =>
    json(
      c,
      'GET',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}/form`,
      undefined,
      parseClaraForms,
      undefined,
      true
    )
  )
  app.post('/harness/v1/sessions/:sessionID/forms/:formID/reply', async (c) => {
    await empty(
      c,
      'POST',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}/form/${encodeURIComponent(c.req.param('formID'))}/reply`,
      await body(c)
    )
    return c.body(null, 204)
  })
  app.delete('/harness/v1/sessions/:sessionID/forms/:formID', async (c) => {
    await empty(
      c,
      'DELETE',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}/form/${encodeURIComponent(c.req.param('formID'))}`,
      await body(c)
    )
    return c.body(null, 204)
  })
  app.get('/harness/v1/sessions/:sessionID/inbox', async (c) =>
    json(
      c,
      'GET',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}/inbox`,
      undefined,
      parseClaraSessionInbox,
      undefined,
      true
    )
  )
  app.delete('/harness/v1/sessions/:sessionID/inbox/:inboxID', async (c) => {
    await empty(
      c,
      'DELETE',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}/inbox/${encodeURIComponent(c.req.param('inboxID'))}`
    )
    return c.body(null, 204)
  })

  app.get('/harness/v1/permissions', async (c) =>
    json(
      c,
      'GET',
      '/api/permission/request',
      undefined,
      parseClaraPermissionRequests,
      queryLocation(c.req.query())
    )
  )
  app.post('/harness/v1/sessions/:sessionID/permissions/:requestID/reply', async (c) => {
    await empty(
      c,
      'POST',
      `/api/session/${encodeURIComponent(c.req.param('sessionID'))}/permission/${encodeURIComponent(c.req.param('requestID'))}/reply`,
      await body(c)
    )
    return c.body(null, 204)
  })

  app.get('/harness/v1/agents', async (c) =>
    json(c, 'GET', '/api/agent', undefined, parseClaraAgentList)
  )
  app.get('/harness/v1/models', async (c) =>
    json(c, 'GET', '/api/model', undefined, parseClaraModelList)
  )
  app.get('/harness/v1/providers', async (c) =>
    json(c, 'GET', '/api/provider', undefined, parseClaraProviderList)
  )
  app.get('/harness/v1/commands', async (c) =>
    json(c, 'GET', '/api/command', undefined, parseClaraCommandList)
  )
  app.get('/harness/v1/skills', async (c) =>
    json(c, 'GET', '/api/skill', undefined, parseClaraSkillList, queryLocation(c.req.query()))
  )
  app.get('/harness/v1/references', async (c) =>
    json(
      c,
      'GET',
      '/api/reference',
      undefined,
      parseClaraReferenceList,
      queryLocation(c.req.query())
    )
  )

  app.get('/harness/v1/git/log', async (c) =>
    c.json(
      await loadGitLog(
        client,
        {
          directory: c.req.query('directory') ?? '',
          since: Number(c.req.query('since')),
          ...(c.req.query('until') ? { until: Number(c.req.query('until')) } : {}),
        },
        c.req.raw.signal
      )
    )
  )

  app.get('/harness/v1/events', async (c) => {
    const response = await client.request(
      { method: 'GET', path: '/api/event', headers: { accept: 'text/event-stream' } },
      c.req.raw.signal
    )
    if (!response.ok) throw await upstreamError(response)
    return response
  })

  app.onError((error, c) => {
    if (error instanceof AdapterError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        error.status as 400
      )
    }
    return c.json(
      {
        error: {
          code: 'adapter_error',
          message: error instanceof Error ? error.message : String(error),
        },
      },
      500
    )
  })

  function registerSessionAction(
    target: Hono,
    action: string,
    parse?: Parse<unknown>,
    unwrapData = false
  ): void {
    target.post(`/harness/v1/sessions/:sessionID/${action}`, async (c) => {
      return json(
        c,
        'POST',
        `/api/session/${encodeURIComponent(c.req.param('sessionID'))}/${action}`,
        await body(c),
        parse,
        undefined,
        unwrapData
      )
    })
  }

  async function json<T>(
    c: Context,
    method: OpenCodeRequest['method'],
    path: string,
    bodyValue?: string,
    parse?: Parse<T>,
    search?: Record<string, string | string[] | undefined>,
    unwrapData = false
  ): Promise<Response> {
    const response = await client.request(
      {
        method,
        path,
        ...(search ? { search: toSearch(search) } : {}),
        ...(bodyValue === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: bodyValue }),
      },
      c.req.raw.signal
    )
    if (!response.ok) throw await upstreamError(response)
    if (response.status === 204 || response.status === 205) return c.body(null, 204)
    const text = await response.text()
    if (!text) return c.body(null, 204)
    const value = JSON.parse(text) as unknown
    const unwrapped =
      unwrapData && value && typeof value === 'object' && 'data' in value
        ? (value as { data: unknown }).data
        : value
    const parsed = parse ? parse(unwrapped) : (unwrapped as T)
    return c.json(parsed)
  }

  async function empty(
    c: Context,
    method: OpenCodeRequest['method'],
    path: string,
    bodyValue?: string
  ): Promise<void> {
    const response = await client.request(
      {
        method,
        path,
        ...(bodyValue === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: bodyValue }),
      },
      c.req.raw.signal
    )
    if (!response.ok) throw await upstreamError(response)
  }

  return app
}

async function body(c: { req: { json: <T>() => Promise<T> } }): Promise<string> {
  try {
    return JSON.stringify(await c.req.json())
  } catch {
    return ''
  }
}

function queryLocation(
  input: Record<string, string | string[] | undefined>
): Record<string, string> {
  const directory = input.directory
  return typeof directory === 'string' && directory ? { 'location[directory]': directory } : {}
}

function toSearch(input: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item)
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

async function upstreamError(response: Response): Promise<AdapterError> {
  const text = await response.text().catch(() => '')
  let code = 'upstream_error'
  let message = text.trim() || `OpenCode responded with ${response.status}`
  if (text) {
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: string; message?: string }
        message?: string
      }
      if (parsed.error?.code) code = parsed.error.code
      if (parsed.error?.message) message = parsed.error.message
      else if (typeof parsed.message === 'string') message = parsed.message
    } catch {
      // Keep the raw text.
    }
  }
  if (response.status === 401 || response.status === 403) {
    return new AdapterError(
      502,
      'harness_auth',
      message || 'OpenCode rejected the adapter credentials'
    )
  }
  return new AdapterError(response.status >= 500 ? 502 : response.status, code, message)
}
