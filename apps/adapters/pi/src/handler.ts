import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Hono, type Context } from 'hono'
import {
  booleanQuery,
  findFiles,
  gitLog,
  jsonBody,
  numberQuery,
  vcsBase,
  vcsDiff,
  vcsInfo,
  vcsStatus,
  worktrees,
} from '@clara/adapter-runtime'
import type { AdapterInfo, AdapterProbe } from '@clara/adapter-runtime'
import type { ClaraFormValue, ClaraModelRef } from '@clara/api-contract'
import { AdapterError } from './errors.ts'
import type { EventBus } from './events.ts'
import type { CatalogService } from './catalog.ts'
import type { PiRuntime } from './runtime.ts'
import type {
  CreateSessionInput,
  MessageListInput,
  SessionListInput,
  SessionService,
  UpdateSessionInput,
} from './sessions.ts'

export type AdapterContext = {
  sessions: SessionService
  runtime: PiRuntime
  catalog: CatalogService
  info: AdapterInfo
  events: EventBus
  probe: () => Promise<AdapterProbe>
}

export function createAdapterApp(context: AdapterContext): Hono {
  const app = new Hono()

  app.get('/harness/v1/info', (c) =>
    c.json({
      protocol: 1,
      adapter: context.info.adapter,
      harness: context.info.harness,
      capabilities: context.info.capabilities,
    })
  )

  app.get('/harness/v1/health', async (c) => c.json(await context.probe()))

  app.get('/harness/v1/harness/info', async (c) => {
    const probe = await context.probe()
    return c.json({
      version: probe.version ?? 'unknown',
      pid: process.pid,
      urls: [],
      paths: { tmp: tmpdir() },
      capabilities: { persistentPty: false },
    })
  })

  app.get('/harness/v1/locations', (c) => c.json(location(c)))

  app.get('/harness/v1/projects', async (c) =>
    c.json(await context.sessions.projects(booleanQuery(c, 'archived') ?? false))
  )
  app.patch('/harness/v1/projects/:projectID', async (c) => {
    const projects = await context.sessions.projects(false)
    const project = projects.find((item) => item.id === c.req.param('projectID'))
    if (!project) {
      throw new AdapterError(404, 'ProjectNotFoundError', 'That project was not found')
    }
    return c.json(project)
  })
  app.post('/harness/v1/projects/:projectID/archive', (c) => c.json({ affected: 0 }))
  app.post('/harness/v1/projects/:projectID/unarchive', (c) => c.json({ affected: 0 }))
  app.delete('/harness/v1/projects/:projectID', (c) => c.json({ affected: 0 }))

  app.get('/harness/v1/sessions', async (c) =>
    c.json(await context.sessions.list(sessionListInput(c)))
  )
  app.post('/harness/v1/sessions', async (c) =>
    c.json(await context.sessions.create(await jsonBody<CreateSessionInput>(c)))
  )
  app.get('/harness/v1/sessions/active', (c) => c.json(context.runtime.activeSessions()))

  app.get('/harness/v1/sessions/:sessionID', async (c) =>
    c.json(
      await context.sessions.get(
        c.req.param('sessionID'),
        c.req.query('directory') ?? c.req.query('location[directory]')
      )
    )
  )
  app.patch('/harness/v1/sessions/:sessionID', async (c) => {
    await context.sessions.update(c.req.param('sessionID'), await jsonBody<UpdateSessionInput>(c))
    return c.body(null, 204)
  })
  app.delete('/harness/v1/sessions/:sessionID', async (c) => {
    await context.sessions.remove(c.req.param('sessionID'))
    return c.body(null, 204)
  })
  app.post('/harness/v1/sessions/:sessionID/fork', async (c) => {
    const body = await jsonBody<{ before?: string }>(c)
    return c.json(await context.runtime.fork(c.req.param('sessionID'), body.before))
  })
  app.post('/harness/v1/sessions/:sessionID/move', () => {
    throw new AdapterError(
      400,
      'unsupported',
      'Pi binds a session to its working directory; fork it into the new directory instead'
    )
  })
  app.post('/harness/v1/sessions/:sessionID/view', (c) => c.body(null, 204))

  app.get('/harness/v1/sessions/:sessionID/messages', async (c) =>
    c.json(await context.sessions.messages(c.req.param('sessionID'), messageListInput(c)))
  )

  app.post('/harness/v1/sessions/:sessionID/prompt', async (c) => {
    const body = await jsonBody<PromptBody>(c)
    return c.json(await context.runtime.prompt(c.req.param('sessionID'), body))
  })
  app.post('/harness/v1/sessions/:sessionID/synthetic', async (c) => {
    const body = await jsonBody<SyntheticBody>(c)
    return c.json(await context.runtime.synthetic(c.req.param('sessionID'), body))
  })
  app.post('/harness/v1/sessions/:sessionID/command', async (c) => {
    const body = await jsonBody<CommandBody>(c)
    await context.runtime.command(c.req.param('sessionID'), body)
    return c.body(null, 204)
  })
  app.post('/harness/v1/sessions/:sessionID/interrupt', async (c) =>
    c.json(await context.runtime.interrupt(c.req.param('sessionID')))
  )
  app.post('/harness/v1/sessions/:sessionID/compact', async (c) => {
    const body = await jsonBody<{ delivery?: 'steer' | 'queue'; customInstructions?: string }>(c)
    return c.json(await context.runtime.compact(c.req.param('sessionID'), body))
  })
  app.post('/harness/v1/sessions/:sessionID/agent', async (c) => {
    const body = await jsonBody<{ agent?: string }>(c)
    if (!body.agent) throw new AdapterError(400, 'invalid_request', 'An agent is required')
    await context.runtime.setAgent(c.req.param('sessionID'), body.agent)
    return c.body(null, 204)
  })
  app.post('/harness/v1/sessions/:sessionID/model', async (c) => {
    const body = await jsonBody<{ model?: ClaraModelRef }>(c)
    if (!body.model) throw new AdapterError(400, 'invalid_request', 'A model is required')
    await context.runtime.setModel(c.req.param('sessionID'), body.model)
    return c.body(null, 204)
  })
  app.post('/harness/v1/sessions/:sessionID/permissions/:requestID/reply', async (c) => {
    const body = await jsonBody<{
      decision?: 'once' | 'always' | 'reject'
      message?: string
    }>(c)
    if (!body.decision) throw new AdapterError(400, 'invalid_request', 'A decision is required')
    await context.runtime.replyPermission(
      c.req.param('sessionID'),
      c.req.param('requestID'),
      body.decision,
      body.message
    )
    return c.body(null, 204)
  })
  app.get('/harness/v1/sessions/:sessionID/inbox', (c) =>
    c.json(context.runtime.inbox(c.req.param('sessionID')))
  )
  app.delete('/harness/v1/sessions/:sessionID/inbox/:inboxID', async (c) => {
    await context.runtime.cancelInbox(c.req.param('sessionID'), c.req.param('inboxID'))
    return c.body(null, 204)
  })

  app.get('/harness/v1/sessions/:sessionID/context', (c) => c.json([]))
  app.get('/harness/v1/sessions/:sessionID/forms', (c) =>
    c.json(context.runtime.forms(c.req.param('sessionID')))
  )
  app.post('/harness/v1/sessions/:sessionID/forms/:formID/reply', async (c) => {
    const body = await jsonBody<{ answer?: Record<string, ClaraFormValue> }>(c)
    if (!body.answer) throw new AdapterError(400, 'invalid_request', 'Answers are required')
    await context.runtime.replyForm(c.req.param('sessionID'), c.req.param('formID'), body.answer)
    return c.body(null, 204)
  })
  app.delete('/harness/v1/sessions/:sessionID/forms/:formID', async (c) => {
    await context.runtime.cancelForm(c.req.param('sessionID'), c.req.param('formID'))
    return c.body(null, 204)
  })
  app.get('/harness/v1/permissions', (c) =>
    c.json({
      location: { directory: directory(c) },
      data: context.runtime.permissions(directory(c) || undefined),
    })
  )

  app.get('/harness/v1/agents', (c) => c.json(context.catalog.agents(directory(c))))
  app.get('/harness/v1/models', async (c) =>
    c.json(await context.catalog.models(directory(c) || process.cwd(), directory(c)))
  )
  app.get('/harness/v1/providers', async (c) =>
    c.json(await context.catalog.providers(directory(c) || process.cwd(), directory(c)))
  )
  app.get('/harness/v1/commands', async (c) =>
    c.json(await context.catalog.commands(directory(c) || process.cwd(), directory(c)))
  )
  app.get('/harness/v1/skills', async (c) =>
    c.json(await context.catalog.skills(directory(c) || process.cwd(), directory(c)))
  )
  app.get('/harness/v1/references', (c) => c.json(context.catalog.references(directory(c))))

  app.get('/harness/v1/files/find', (c) => {
    const location = requiredDirectory(c)
    const type = c.req.query('type')
    return c.json({
      location: { directory: location },
      data: findFiles({
        directory: location,
        query: c.req.query('query') ?? '',
        ...(type === 'file' || type === 'directory' ? { type } : {}),
        ...(numberQuery(c, 'limit') !== undefined ? { limit: numberQuery(c, 'limit') } : {}),
      }),
    })
  })

  app.get('/harness/v1/vcs', async (c) => c.json(await vcsInfo(requiredDirectory(c))))
  app.get('/harness/v1/vcs/base', async (c) => c.json(await vcsBase(requiredDirectory(c))))
  app.get('/harness/v1/vcs/status', async (c) => c.json(await vcsStatus(requiredDirectory(c))))
  app.get('/harness/v1/vcs/diff', async (c) => {
    const mode = c.req.query('mode')
    if (mode !== 'working' && mode !== 'branch' && mode !== 'committed') {
      throw new AdapterError(400, 'invalid_request', 'A valid VCS diff mode is required')
    }
    return c.json(
      await vcsDiff(requiredDirectory(c), {
        mode,
        ...(c.req.query('base') ? { base: c.req.query('base') } : {}),
        ...(numberQuery(c, 'context') !== undefined ? { context: numberQuery(c, 'context') } : {}),
      })
    )
  })

  app.get('/harness/v1/worktrees', async (c) => c.json(await worktrees(requiredDirectory(c))))
  app.post('/harness/v1/worktrees/refresh', (c) => c.body(null, 204))

  app.get('/harness/v1/git/log', async (c) =>
    c.json(
      await gitLog(requiredDirectory(c), {
        since: Number(c.req.query('since')),
        ...(c.req.query('until') ? { until: Number(c.req.query('until')) } : {}),
      })
    )
  )

  app.get('/harness/v1/events', (c) => context.events.stream(c.req.raw.signal))

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

  return app
}

type PromptBody = {
  text: string
  files?: unknown[]
  agents?: unknown[]
  skills?: unknown[]
  delivery?: 'steer' | 'queue'
  resume?: boolean
}

type SyntheticBody = {
  text: string
  description?: string
  delivery?: 'steer' | 'queue'
}

type CommandBody = {
  name: string
  text?: string
  files?: unknown[]
  delivery?: 'steer' | 'queue'
}

function directory(c: Context): string {
  return c.req.query('directory') ?? c.req.query('location[directory]') ?? ''
}

function requiredDirectory(c: Context): string {
  const value = directory(c)
  if (!value) throw new AdapterError(400, 'invalid_request', 'A directory is required')
  return value
}

function sessionListInput(c: Context): SessionListInput {
  const order = c.req.query('order')
  return {
    ...(c.req.query('project') ? { project: c.req.query('project') } : {}),
    ...(c.req.query('directory') ? { directory: c.req.query('directory') } : {}),
    ...(c.req.query('search') ? { search: c.req.query('search') } : {}),
    ...(numberQuery(c, 'limit') !== undefined ? { limit: numberQuery(c, 'limit') } : {}),
    ...(order === 'asc' || order === 'desc' ? { order } : {}),
    ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
    ...(c.req.query('parentID') ? { parentID: c.req.query('parentID') } : {}),
    ...(booleanQuery(c, 'archived') !== undefined ? { archived: booleanQuery(c, 'archived') } : {}),
    ...(c.req.query('subpath') ? { subpath: c.req.query('subpath') } : {}),
  }
}

function messageListInput(c: Context): MessageListInput {
  const order = c.req.query('order')
  return {
    ...(order === 'asc' || order === 'desc' ? { order } : {}),
    ...(numberQuery(c, 'limit') !== undefined ? { limit: numberQuery(c, 'limit') } : {}),
    ...(c.req.query('cursor') ? { cursor: c.req.query('cursor') } : {}),
    ...(c.req.query('type') ? { type: c.req.query('type') } : {}),
  }
}

function location(c: Context) {
  const requested = directory(c)
  if (!requested) throw new AdapterError(400, 'invalid_request', 'A directory is required')
  let canonical: string
  try {
    canonical = realpathSync(requested)
  } catch {
    throw new AdapterError(
      404,
      'LocationNotFoundError',
      `The directory ${requested} does not exist on the harness machine`,
      { directory: requested }
    )
  }
  return {
    directory: requested,
    project: {
      id: canonical,
      directory: canonical,
      canonical,
    },
  }
}
