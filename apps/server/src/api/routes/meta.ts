import { describeRoute, resolver } from 'hono-openapi'
import type { Hono } from 'hono'
import { PROTOCOL_VERSION } from '@clara/shared-types'
import { apiInfoSchema, claraServerInfoSchema, type ApiInfo } from '@clara/api-contract'
import { SERVER_VERSION } from '../../version.ts'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import { forwardDto, parseClaraServerInfo } from '../dto.ts'
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
          active: deps.harness.active
            ? { kind: deps.harness.active.kind, label: deps.harness.active.label }
            : null,
          lastError: deps.harness.lastError ?? null,
        },
        agent: deps.info,
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
      summary: 'Read the active OpenCode server information',
      responses: responses(
        jsonResponse(resolver(claraServerInfoSchema), 'OpenCode server information')
      ),
    }),
    async (c) => {
      const info = await forwardDto(
        deps,
        { method: 'GET', path: '/api/info' },
        c.req.raw.signal,
        parseClaraServerInfo
      )
      return c.json(info)
    }
  )
}
