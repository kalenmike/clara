import type { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import { z } from 'zod'
import { claraActivitySessionsResponseSchema } from '@clara/api-contract'
import { ActivitySessionsService } from '../../activity/sessions.ts'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import { optionalBooleanQuery } from '../query.ts'
import { jsonResponse, responses } from '../schemas.ts'

export function registerActivityRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  const service = new ActivitySessionsService(deps)

  app.get(
    '/v1/activity/sessions',
    describeRoute({
      tags: ['activity'],
      operationId: 'listActivitySessions',
      summary: 'List Inbox and Outbox sessions across paired harnesses',
      responses: responses(
        jsonResponse(
          resolver(claraActivitySessionsResponseSchema),
          'Activity sessions and harness status'
        )
      ),
    }),
    validator('query', z.object({ refresh: optionalBooleanQuery })),
    async (c) => {
      const { refresh } = c.req.valid('query')
      return c.json(await service.load(c.req.raw.signal, { refresh: refresh === true }))
    }
  )

  app.get(
    '/v1/activity/running',
    describeRoute({
      tags: ['activity'],
      operationId: 'listRunningSessions',
      summary: 'List running sessions across paired harnesses',
      deprecated: true,
      responses: responses(
        jsonResponse(
          resolver(claraActivitySessionsResponseSchema),
          'Running sessions and harness status'
        )
      ),
    }),
    validator('query', z.object({ refresh: optionalBooleanQuery })),
    async (c) => {
      const { refresh } = c.req.valid('query')
      return c.json(
        await service.load(c.req.raw.signal, { refresh: refresh === true, runningOnly: true })
      )
    }
  )
}
