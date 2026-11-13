import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Hono, type Context } from 'hono'
import { booleanQuery, jsonBody, numberQuery } from '@clara/adapter-runtime'
import type { AdapterInfo } from '@clara/adapter-runtime'
import { AdapterError } from './errors.ts'
import { EventBus } from './events.ts'
import type { ClaudeGateway } from './sdk.ts'
import type {
  CreateSessionInput,
  MessageListInput,
  SessionListInput,
  SessionService,
  UpdateSessionInput,
} from './sessions.ts'

export type AdapterContext = {
  claude: ClaudeGateway
  sessions: SessionService
  info: AdapterInfo
  events: EventBus
}

export type AdapterApp = {
  app: Hono
  events: EventBus
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

  app.get('/harness/v1/health', async (c) => c.json(await context.claude.probe(1_500)))

  app.get('/harness/v1/harness/info', async (c) => {
    const probe = await context.claude.probe(1_500)
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
  app.get('/harness/v1/sessions/active', (c) => c.json({}))

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
    return c.json(await context.sessions.fork(c.req.param('sessionID'), body.before))
  })
  app.post('/harness/v1/sessions/:sessionID/move', async (c) => {
    const body = await jsonBody<{ directory?: string }>(c)
    if (!body.directory) {
      throw new AdapterError(400, 'invalid_request', 'A target directory is required')
    }
    await context.sessions.move(c.req.param('sessionID'), body.directory)
    return c.body(null, 204)
  })
  app.post('/harness/v1/sessions/:sessionID/view', (c) => c.body(null, 204))

  app.get('/harness/v1/sessions/:sessionID/messages', async (c) =>
    c.json(await context.sessions.messages(c.req.param('sessionID'), messageListInput(c)))
  )

  app.get('/harness/v1/sessions/:sessionID/context', (c) => c.json([]))
  app.get('/harness/v1/sessions/:sessionID/forms', (c) => c.json([]))
  app.get('/harness/v1/sessions/:sessionID/inbox', (c) => c.json([]))
  app.get('/harness/v1/permissions', (c) =>
    c.json({ location: { directory: directory(c) }, data: [] })
  )

  app.get('/harness/v1/agents', (c) => c.json({ location: { directory: directory(c) }, data: [] }))
  app.get('/harness/v1/models', (c) => c.json({ location: { directory: directory(c) }, data: [] }))
  app.get('/harness/v1/providers', (c) =>
    c.json({ location: { directory: directory(c) }, data: [] })
  )
  app.get('/harness/v1/commands', (c) =>
    c.json({ location: { directory: directory(c) }, data: [] })
  )
  app.get('/harness/v1/skills', (c) => c.json({ location: { directory: directory(c) }, data: [] }))
  app.get('/harness/v1/references', (c) =>
    c.json({ location: { directory: directory(c) }, data: [] })
  )

  app.get('/harness/v1/files/find', (c) =>
    c.json({ location: { directory: directory(c) }, data: [] })
  )

  app.get('/harness/v1/vcs', (c) =>
    c.json({ location: { directory: directory(c) }, data: { branch: {} } })
  )
  app.get('/harness/v1/vcs/base', (c) =>
    c.json({ location: { directory: directory(c) }, data: null })
  )
  app.get('/harness/v1/vcs/status', (c) =>
    c.json({ location: { directory: directory(c) }, data: [] })
  )
  app.get('/harness/v1/vcs/diff', (c) =>
    c.json({ location: { directory: directory(c) }, data: [] })
  )

  app.get('/harness/v1/worktrees', (c) => c.json([]))
  app.post('/harness/v1/worktrees/refresh', (c) => c.body(null, 204))

  app.get('/harness/v1/git/log', (c) => c.json([]))

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

function directory(c: Context): string {
  return c.req.query('directory') ?? c.req.query('location[directory]') ?? ''
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
