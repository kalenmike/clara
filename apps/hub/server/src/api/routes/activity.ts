import type { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { claraRunningSessionsResponseSchema } from '@clara/api-contract'
import { RunningActivityService } from '../../activity/running.ts'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import { jsonResponse, responses } from '../schemas.ts'

export function registerActivityRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  const service = new RunningActivityService(deps)

  app.get(
    '/v1/activity/running',
    describeRoute({
      tags: ['activity'],
      operationId: 'listRunningSessions',
      summary: 'List running sessions across paired harnesses',
      responses: responses(
        jsonResponse(
          resolver(claraRunningSessionsResponseSchema),
          'Running sessions and harness status'
        )
      ),
    }),
    async (c) => {
      return c.json(await service.load(c.req.raw.signal))
    }
  )
}
