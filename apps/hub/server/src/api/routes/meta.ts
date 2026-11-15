import { describeRoute, resolver, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import { PROTOCOL_VERSION } from '@clara/shared-types'
import { apiInfoSchema, claraServerInfoSchema, type ApiInfo } from '@clara/api-contract'
import { SERVER_VERSION } from '../../version.ts'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import { forwardDtoTo, parseClaraServerInfo } from '../dto.ts'
import { requireHarnessContext } from '../harness-scope.ts'
import { jsonResponse, responses } from '../schemas.ts'

export function registerMetaRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'clara-server',
      version: SERVER_VERSION,
      protocol: PROTOCOL_VERSION,
      sessions: deps.sessionCount(),
    })
  )

  app.get(
    '/v1/info',
    describeRoute({
      tags: ['meta'],
      operationId: 'getInfo',
      summary: 'Read hub, harness, and API status',
      responses: responses(jsonResponse(resolver(apiInfoSchema), 'Hub information')),
    }),
    (c) => {
      // Controller-side endpoints are for adapters only; the browser already
      // knows how it reached the hub.
      const agent = { ...deps.info }
      delete agent.endpoints
      const info: ApiInfo = {
        server: {
          version: SERVER_VERSION,
          protocol: PROTOCOL_VERSION,
          startedAt: deps.startedAt,
          pid: process.pid,
        },
        harness: {
          configured: deps.harness.configured,
          generation: deps.harness.generation,
          paired: deps.harness.list().length,
          online: deps.harness.list().filter((connection) => connection.online).length,
          lastError: deps.harness.lastError ?? null,
        },
        agent,
        api: {
          version: 'v1',
          openapi: '/openapi.json',
          docs: '/docs',
        },
      }
      return c.json(info)
    }
  )

  app.get(
    '/v1/harness/info',
    describeRoute({
      tags: ['meta'],
      operationId: 'getHarnessInfo',
      summary: 'Read one harness server information',
      responses: responses(jsonResponse(resolver(claraServerInfoSchema), 'Harness information')),
    }),
    validator('query', z.object({ harnessID: z.string().min(1).optional() })),
    async (c) => {
      const harnessID = requireHarnessContext(deps, c.req.valid('query').harnessID)
      const info = await forwardDtoTo(
        deps,
        harnessID,
        { method: 'GET', path: '/harness/info' },
        c.req.raw.signal,
        parseClaraServerInfo
      )
      return c.json(info)
    }
  )
}
