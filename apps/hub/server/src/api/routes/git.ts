import { describeRoute, resolver, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import { gitCommitSchema, gitLogQuerySchema } from '@clara/api-contract'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import { loadGitLog } from '../git.ts'
import { jsonResponse, responses } from '../schemas.ts'

export function registerGitRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  app.get(
    '/v1/git/log',
    describeRoute({
      tags: ['git'],
      operationId: 'getGitLog',
      summary: 'Read recent commits in a directory window',
      responses: responses(jsonResponse(resolver(z.array(gitCommitSchema)), 'Commits')),
    }),
    validator('query', gitLogQuerySchema),
    async (c) => {
      const query = c.req.valid('query')
      const commits = await loadGitLog(deps, query, c.req.raw.signal)
      return c.json(commits)
    }
  )
}
