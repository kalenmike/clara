import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Hono, type Context } from 'hono'
import type { AdapterInfo } from '@clara/adapter-runtime'
import { AdapterError } from './errors.ts'
import { EventBus } from './events.ts'
import type { ClaudeGateway } from './sdk.ts'

export type AdapterContext = {
  claude: ClaudeGateway
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

  app.get('/harness/v1/projects', (c) => c.json([]))

  app.get('/harness/v1/sessions', (c) =>
    c.json({ data: [], cursor: { previous: null, next: null } })
  )

  app.get('/harness/v1/sessions/active', (c) => c.json({}))

  app.get('/harness/v1/sessions/:sessionID', (c) =>
    c.json({ error: { code: 'not_implemented', message: 'Session reads are not wired yet' } }, 501)
  )

  app.get('/harness/v1/sessions/:sessionID/messages', (c) =>
    c.json({ data: [], cursor: { previous: null, next: null } })
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
