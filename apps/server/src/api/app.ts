import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { generateSpecs } from 'hono-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { SERVER_VERSION } from '../version.ts'
import { ApiRequestError, type ApiApp, type ApiDependencies, type ApiVariables } from './context.ts'
import { registerCatalogRoutes } from './routes/catalog.ts'
import { registerEventRoutes } from './routes/events.ts'
import { registerGitRoutes } from './routes/git.ts'
import { registerMetaRoutes } from './routes/meta.ts'
import { registerProjectRoutes } from './routes/projects.ts'
import { registerSessionRoutes } from './routes/sessions.ts'
import { errorResponse } from './schemas.ts'

const AGENT_HEADER = 'x-clara-agent'
const READONLY_HEADER = 'x-clara-readonly'

export type ApiAppOptions = {
  /** Bearer token for the loopback HTTP listener. Empty disables local HTTP auth. */
  token: string
}

export function createApiApp(deps: ApiDependencies, options: ApiAppOptions): ApiApp {
  const app = new Hono<{ Variables: ApiVariables }>()

  app.use('/v1/*', async (c, next) => {
    if (c.req.header(AGENT_HEADER) === '1') {
      c.set('authenticated', true)
    } else {
      const token = bearer(c.req.header('authorization'))
      if (!token || !sameToken(token, options.token)) {
        return c.json(
          { error: { code: 'unauthorized', message: 'A valid API token is required' } },
          401
        )
      }
      c.set('authenticated', true)
    }

    if (
      c.req.header(READONLY_HEADER) === '1' &&
      c.req.method !== 'GET' &&
      c.req.method !== 'HEAD'
    ) {
      return c.json({ error: { code: 'read_only', message: 'This API client is read-only' } }, 403)
    }

    await next()
  })

  registerMetaRoutes(app, deps)
  registerProjectRoutes(app, deps)
  registerSessionRoutes(app, deps)
  registerCatalogRoutes(app, deps)
  registerGitRoutes(app, deps)
  registerEventRoutes(app, deps)

  let spec: Record<string, unknown> | undefined
  const openapi = async (): Promise<Record<string, unknown>> => {
    if (!spec) {
      spec = (await generateSpecs(app, {
        documentation: {
          openapi: '3.1.0',
          info: {
            title: 'Clara Hub API',
            version: SERVER_VERSION,
            description:
              'Typed API for the Clara hub. The browser uses this API over the E2EE WebSocket; ' +
              'the loopback HTTP listener is for local tools and MCP.',
          },
          servers: [{ url: '/' }],
          tags: [
            { name: 'meta', description: 'Hub and harness status' },
            { name: 'projects', description: 'Projects, locations, files, VCS, and worktrees' },
            { name: 'sessions', description: 'Session lifecycle and prompts' },
            { name: 'messages', description: 'Session messages' },
            { name: 'forms', description: 'Agent question forms' },
            { name: 'inbox', description: 'Session inbox items' },
            { name: 'permissions', description: 'Permission requests' },
            {
              name: 'catalog',
              description: 'Agents, models, providers, commands, skills, and references',
            },
            { name: 'git', description: 'Git history' },
            { name: 'events', description: 'Live harness events' },
          ],
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
              },
            },
          },
          security: [{ bearerAuth: [] }],
        },
        defaultValidationErrorResponse: errorResponse,
        exclude: ['/health', '/openapi.json', '/docs'],
      })) as Record<string, unknown>
    }
    return spec
  }

  app.get('/openapi.json', async (c) => c.json(await openapi()))
  app.get('/docs', swaggerUI({ url: '/openapi.json' }))

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Unknown API endpoint' } }, 404)
  )

  app.onError((error, c) => {
    if (error instanceof ApiRequestError) {
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

    deps.log('api request failed', error)
    return c.json(
      { error: { code: 'internal', message: 'The hub API could not complete the request' } },
      500
    )
  })

  return {
    fetch: async (request) => app.fetch(request),
    openapi,
  }
}

function bearer(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match?.[1]?.trim()
}

function sameToken(left: string, right: string): boolean {
  if (!right) return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.byteLength !== b.byteLength) return false
  return timingSafeEqual(a, b)
}
