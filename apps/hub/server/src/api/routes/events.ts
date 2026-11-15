import { describeRoute, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import { forwardTo, upstreamError } from '../harness.ts'
import { requireHarnessContext } from '../harness-scope.ts'
import { errorResponse } from '../schemas.ts'

export function registerEventRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  app.get(
    '/v1/events',
    describeRoute({
      tags: ['events'],
      operationId: 'subscribeEvents',
      summary: 'Stream harness events as server-sent events',
      responses: {
        200: {
          description: 'Harness event stream',
          content: {
            'text/event-stream': {
              schema: { type: 'string' },
            },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        502: errorResponse,
        503: errorResponse,
      },
    }),
    validator('query', z.object({ harnessID: z.string().min(1).optional() })),
    async (c) => {
      const { harnessID } = c.req.valid('query')
      const harness = requireHarnessContext(deps, harnessID)
      const request = {
        method: 'GET' as const,
        path: '/events',
        headers: { accept: 'text/event-stream' },
      }
      const response = await forwardTo(deps, harness, request, c.req.raw.signal)
      if (!response.ok) throw await upstreamError(response)
      return response
    }
  )
}
