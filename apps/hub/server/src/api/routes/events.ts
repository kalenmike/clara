import { describeRoute } from 'hono-openapi'
import type { Hono } from 'hono'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import { forward, upstreamError } from '../harness.ts'
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
    async (c) => {
      const response = await forward(
        deps,
        {
          method: 'GET',
          path: '/events',
          headers: { accept: 'text/event-stream' },
        },
        c.req.raw.signal
      )
      if (!response.ok) throw await upstreamError(response)
      return response
    }
  )
}
