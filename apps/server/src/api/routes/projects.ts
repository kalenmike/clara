import { describeRoute, resolver, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import {
  claraFileFindOutputSchema,
  claraLocationSchema,
  claraProjectSchema,
  claraVcsBaseOutputSchema,
  claraVcsDiffOutputSchema,
  claraVcsGetOutputSchema,
  claraVcsStatusOutputSchema,
  claraWorktreeListSchema,
} from '@clara/api-contract'
import { ApiRequestError, type ApiDependencies, type ApiVariables } from '../context.ts'
import {
  forwardDto,
  parseClaraFiles,
  parseClaraLocation,
  parseClaraProjects,
  parseClaraVcs,
  parseClaraVcsBase,
  parseClaraVcsDiff,
  parseClaraVcsStatus,
  parseClaraWorktrees,
} from '../dto.ts'
import { forwardResult, query } from '../harness.ts'
import { emptyResponse, jsonResponse, responses, statusResponses } from '../schemas.ts'
import { optionalBooleanQuery, optionalPositiveIntQuery } from '../query.ts'

const directoryQuery = z.object({
  directory: z.string().min(1).optional(),
})

const projectUpdateBody = z.object({
  canonical: z.string().optional(),
  name: z.string().optional(),
  icon: z.unknown().optional(),
  commands: z.unknown().optional(),
})

export function registerProjectRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  app.get(
    '/v1/projects',
    describeRoute({
      tags: ['projects'],
      operationId: 'listProjects',
      summary: 'List projects',
      responses: responses(jsonResponse(resolver(z.array(claraProjectSchema)), 'Projects')),
    }),
    validator('query', z.object({ archived: optionalBooleanQuery })),
    async (c) => {
      const { archived } = c.req.valid('query')
      const projects = await forwardDto(
        deps,
        { method: 'GET', path: '/projects', search: query({ archived }) },
        c.req.raw.signal,
        parseClaraProjects
      )
      return c.json(deps.harness.overlayProjectList(projects))
    }
  )

  app.patch(
    '/v1/projects/:projectID',
    describeRoute({
      tags: ['projects'],
      operationId: 'updateProject',
      summary: 'Update project metadata',
      responses: responses(jsonResponse(resolver(claraProjectSchema), 'Updated project')),
    }),
    validator('param', z.object({ projectID: z.string().min(1) })),
    validator('json', projectUpdateBody),
    async (c) => {
      const { projectID } = c.req.valid('param')
      const body = c.req.valid('json')
      const projects = await forwardDto(
        deps,
        { method: 'GET', path: '/projects' },
        c.req.raw.signal,
        parseClaraProjects
      )
      const current = deps.harness
        .overlayProjectList(projects)
        .find((item) => item.id === projectID)
      if (!current) throw new ApiRequestError(404, 'not_found', 'That project no longer exists')
      const updated = deps.harness.updateProject(projectID, {
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.commands !== undefined ? { commands: body.commands } : {}),
      })
      return c.json(updated ?? current)
    }
  )

  app.get(
    '/v1/locations',
    describeRoute({
      tags: ['projects'],
      operationId: 'getLocation',
      summary: 'Resolve a directory location',
      responses: responses(jsonResponse(resolver(claraLocationSchema), 'Resolved location')),
    }),
    validator('query', directoryQuery),
    async (c) => {
      const { directory } = c.req.valid('query')
      const location = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/locations',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal,
        parseClaraLocation
      )
      return c.json(location)
    }
  )

  app.get(
    '/v1/files/find',
    describeRoute({
      tags: ['files'],
      operationId: 'findFiles',
      summary: 'Search files and directories in a location',
      responses: responses(jsonResponse(resolver(claraFileFindOutputSchema), 'Matching files')),
    }),
    validator(
      'query',
      z.object({
        directory: z.string().min(1).optional(),
        query: z.string(),
        type: z.enum(['file', 'directory']).optional(),
        limit: optionalPositiveIntQuery,
      })
    ),
    async (c) => {
      const { directory, query: text, type, limit } = c.req.valid('query')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/files/find',
          search: query({ location: { directory }, query: text, type, limit }),
        },
        c.req.raw.signal,
        parseClaraFiles
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/vcs',
    describeRoute({
      tags: ['vcs'],
      operationId: 'getVcs',
      summary: 'Read repository information for a location',
      responses: responses(
        jsonResponse(resolver(claraVcsGetOutputSchema), 'Repository information')
      ),
    }),
    validator('query', directoryQuery),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/vcs',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal,
        parseClaraVcs
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/vcs/base',
    describeRoute({
      tags: ['vcs'],
      operationId: 'getVcsBase',
      summary: 'Read the branch base for a location',
      responses: responses(jsonResponse(resolver(claraVcsBaseOutputSchema), 'Branch base')),
    }),
    validator('query', directoryQuery),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/vcs/base',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal,
        parseClaraVcsBase
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/vcs/status',
    describeRoute({
      tags: ['vcs'],
      operationId: 'getVcsStatus',
      summary: 'Read working-tree changes for a location',
      responses: responses(
        jsonResponse(resolver(claraVcsStatusOutputSchema), 'Working-tree changes')
      ),
    }),
    validator('query', directoryQuery),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/vcs/status',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal,
        parseClaraVcsStatus
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/vcs/diff',
    describeRoute({
      tags: ['vcs'],
      operationId: 'getVcsDiff',
      summary: 'Read a diff for a location',
      responses: responses(jsonResponse(resolver(claraVcsDiffOutputSchema), 'Diff')),
    }),
    validator(
      'query',
      z.object({
        directory: z.string().min(1).optional(),
        mode: z.enum(['working', 'branch', 'committed']),
        base: z.string().optional(),
        context: optionalPositiveIntQuery,
      })
    ),
    async (c) => {
      const { directory, mode, base, context } = c.req.valid('query')
      const result = await forwardDto(
        deps,
        {
          method: 'POST',
          path: '/vcs/diff',
          search: query({ location: { directory }, mode, base, context }),
        },
        c.req.raw.signal,
        parseClaraVcsDiff
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/worktrees',
    describeRoute({
      tags: ['worktrees'],
      operationId: 'listWorktrees',
      summary: 'List worktrees for a project',
      responses: responses(jsonResponse(resolver(claraWorktreeListSchema), 'Worktrees')),
    }),
    validator('query', z.object({ project: z.string().min(1).optional() })),
    async (c) => {
      const { project } = c.req.valid('query')
      const mappedProject = project ? deps.harness.harnessProjectId(project) : undefined
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/worktrees',
          search: query({ projectID: mappedProject ?? project }),
        },
        c.req.raw.signal,
        parseClaraWorktrees
      )
      return c.json(result)
    }
  )

  app.post(
    '/v1/worktrees/refresh',
    describeRoute({
      tags: ['worktrees'],
      operationId: 'refreshWorktrees',
      summary: 'Refresh worktrees for a project',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('json', z.object({ projectID: z.string().min(1) })),
    async (c) => {
      const body = c.req.valid('json')
      await forwardResult(
        deps,
        {
          method: 'POST',
          path: '/worktrees/refresh',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )
}
