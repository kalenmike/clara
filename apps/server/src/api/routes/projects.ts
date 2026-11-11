import { describeRoute, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import type {
  FileFindOutput,
  LocationPublicInfo,
  Project,
  VcsBaseOutput,
  VcsDiffOutput,
  VcsGetOutput,
  VcsStatusOutput,
  WorktreeList,
} from '@opencode/client'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import { forwardResult, query } from '../harness.ts'
import {
  arrayOf,
  emptyResponse,
  jsonResponse,
  ref,
  responses,
  statusResponses,
} from '../schemas.ts'
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
      summary: 'List OpenCode projects',
      responses: responses(jsonResponse(arrayOf(ref('Project')), 'Projects')),
    }),
    validator('query', z.object({ archived: optionalBooleanQuery })),
    async (c) => {
      const { archived } = c.req.valid('query')
      const projects = await forwardResult<Project[]>(
        deps,
        { method: 'GET', path: '/api/project', search: query({ archived }) },
        c.req.raw.signal
      )
      return c.json(projects)
    }
  )

  app.patch(
    '/v1/projects/:projectID',
    describeRoute({
      tags: ['projects'],
      operationId: 'updateProject',
      summary: 'Update project metadata',
      responses: responses(jsonResponse(ref('Project'), 'Updated project')),
    }),
    validator('param', z.object({ projectID: z.string().min(1) })),
    validator('json', projectUpdateBody),
    async (c) => {
      const { projectID } = c.req.valid('param')
      const body = c.req.valid('json')
      const project = await forwardResult<Project>(
        deps,
        {
          method: 'PATCH',
          path: `/api/project/${encodeURIComponent(projectID)}`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        c.req.raw.signal,
        true
      )
      return c.json(project)
    }
  )

  app.get(
    '/v1/locations',
    describeRoute({
      tags: ['projects'],
      operationId: 'getLocation',
      summary: 'Resolve a directory location',
      responses: responses(jsonResponse(ref('LocationPublicInfo'), 'Resolved location')),
    }),
    validator('query', directoryQuery),
    async (c) => {
      const { directory } = c.req.valid('query')
      const location = await forwardResult<LocationPublicInfo>(
        deps,
        {
          method: 'GET',
          path: '/api/location',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal
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
      responses: responses(jsonResponse(ref('FileFindOutput'), 'Matching files')),
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
      const result = await forwardResult<FileFindOutput>(
        deps,
        {
          method: 'GET',
          path: '/api/fs/find',
          search: query({ location: { directory }, query: text, type, limit }),
        },
        c.req.raw.signal
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
      responses: responses(jsonResponse(ref('VcsGetOutput'), 'Repository information')),
    }),
    validator('query', directoryQuery),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardResult<VcsGetOutput>(
        deps,
        {
          method: 'GET',
          path: '/api/vcs',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal
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
      responses: responses(jsonResponse(ref('VcsBaseOutput'), 'Branch base')),
    }),
    validator('query', directoryQuery),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardResult<VcsBaseOutput>(
        deps,
        {
          method: 'GET',
          path: '/api/vcs/base',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal
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
      responses: responses(jsonResponse(ref('VcsStatusOutput'), 'Working-tree changes')),
    }),
    validator('query', directoryQuery),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardResult<VcsStatusOutput>(
        deps,
        {
          method: 'GET',
          path: '/api/vcs/status',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal
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
      responses: responses(jsonResponse(ref('VcsDiffOutput'), 'Diff')),
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
      const result = await forwardResult<VcsDiffOutput>(
        deps,
        {
          method: 'POST',
          path: '/api/vcs/diff',
          search: query({ location: { directory }, mode, base, context }),
        },
        c.req.raw.signal
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
      responses: responses(jsonResponse(ref('WorktreeList'), 'Worktrees')),
    }),
    validator('query', z.object({ project: z.string().min(1).optional() })),
    async (c) => {
      const { project } = c.req.valid('query')
      const result = await forwardResult<WorktreeList>(
        deps,
        {
          method: 'GET',
          path: '/api/worktree',
          search: query({ projectID: project }),
        },
        c.req.raw.signal
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
          path: '/api/worktree/refresh',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )
}
