import { describeRoute, resolver, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import {
  claraFileFindOutputSchema,
  claraHarnessConnectionListSchema,
  claraLocationSchema,
  claraProjectArchiveResultSchema,
  claraProjectAvailableSchema,
  claraProjectDeleteResultSchema,
  claraProjectSchema,
  claraVcsBaseOutputSchema,
  claraVcsDiffOutputSchema,
  claraVcsGetOutputSchema,
  claraVcsStatusOutputSchema,
  claraWorktreeListSchema,
  type ClaraProject,
  type ClaraProjectHarnessResult,
  type ClaraWorktree,
} from '@clara/api-contract'
import { ApiRequestError, type ApiDependencies, type ApiVariables } from '../context.ts'
import {
  forwardDtoTo,
  parseClaraFiles,
  parseClaraLocation,
  parseClaraVcs,
  parseClaraVcsBase,
  parseClaraVcsDiff,
  parseClaraVcsStatus,
  parseClaraWorktrees,
} from '../dto.ts'
import { forwardResultTo, locationQuery, query } from '../harness.ts'
import {
  requireHarnessContext,
  resolveHarnessForDirectory,
  resolveHarnessProjectGroups,
} from '../harness-scope.ts'
import {
  availableProjects,
  signalProjectArchive,
  signalProjectDelete,
  syncProject,
  syncWorkspace,
} from '../project-service.ts'
import { unmappedProjectError } from '../project-links.ts'
import { emptyResponse, jsonResponse, responses, statusResponses } from '../schemas.ts'
import { optionalBooleanQuery, optionalPositiveIntQuery } from '../query.ts'
import { connectionLookup, toAvailableProject, toClaraProject } from '../../projects/present.ts'

const directoryQuery = z.object({
  directory: z.string().min(1).optional(),
  harnessID: z.string().min(1).optional(),
})

const projectCreateBody = z.object({
  name: z.string().optional(),
  icon: z.unknown().optional(),
  commands: z.unknown().optional(),
  startupScript: z.string().optional(),
})

const projectUpdateBody = z.object({
  name: z.string().optional(),
  icon: z.unknown().optional(),
  commands: z.unknown().optional(),
  startupScript: z.string().optional(),
  defaultWorkspaceID: z.string().nullable().optional(),
})

const workspaceCreateBody = z.object({
  harnessID: z.string().min(1),
  directory: z.string().min(1),
  label: z.string().optional(),
})

export function registerProjectRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  const projects = deps.harness.projects

  function present(projectID: string): ClaraProject {
    const record = projects.get(projectID)
    if (!record) throw new ApiRequestError(404, 'not_found', 'That project no longer exists')
    return toClaraProject(
      record,
      projects.linksForProject(projectID),
      connectionLookup(deps.harness.list())
    )
  }

  app.get(
    '/v1/harnesses',
    describeRoute({
      tags: ['projects'],
      operationId: 'listHarnesses',
      summary: 'List paired harness connections',
      responses: responses(
        jsonResponse(resolver(claraHarnessConnectionListSchema), 'Paired harnesses')
      ),
    }),
    async (c) => {
      return c.json(
        deps.harness.list().map((connection) => ({
          harnessID: connection.harnessId,
          kind: connection.kind,
          label: connection.label,
          online: connection.online,
          capabilities: connection.capabilities,
        }))
      )
    }
  )

  app.get(
    '/v1/projects',
    describeRoute({
      tags: ['projects'],
      operationId: 'listProjects',
      summary: 'List Clara projects',
      responses: responses(jsonResponse(resolver(z.array(claraProjectSchema)), 'Projects')),
    }),
    validator('query', z.object({ archived: optionalBooleanQuery })),
    async (c) => {
      const { archived } = c.req.valid('query')
      const records = projects.list({ archived: archived === true })
      const connections = connectionLookup(deps.harness.list())
      return c.json(
        records.map((record) =>
          toClaraProject(record, projects.linksForProject(record.project.id), connections)
        )
      )
    }
  )

  app.get(
    '/v1/projects/available',
    describeRoute({
      tags: ['projects'],
      operationId: 'listAvailableProjects',
      summary: 'List harness projects that can become workspaces',
      responses: responses(
        jsonResponse(resolver(z.array(claraProjectAvailableSchema)), 'Available harness projects')
      ),
    }),
    validator('query', z.object({ harnessID: z.string().min(1).optional() })),
    async (c) => {
      const harnessID = requireHarnessContext(deps, c.req.valid('query').harnessID)
      const candidates = await availableProjects(deps, harnessID, c.req.raw.signal)
      return c.json(
        candidates.map(({ connection, project }) => toAvailableProject(connection, project))
      )
    }
  )

  app.post(
    '/v1/projects',
    describeRoute({
      tags: ['projects'],
      operationId: 'createProject',
      summary: 'Create a Clara project',
      responses: responses(jsonResponse(resolver(claraProjectSchema), 'Created project')),
    }),
    validator('json', projectCreateBody),
    async (c) => {
      const body = c.req.valid('json')
      if (body.name?.trim()) {
        const existing = projects.findByName(body.name)
        if (existing) {
          throw new ApiRequestError(409, 'project_exists', 'A project with that name exists', {
            projectID: existing.id,
          })
        }
      }
      const project = projects.create({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.icon !== undefined ? { icon: body.icon as ClaraProject['icon'] } : {}),
        ...(body.commands !== undefined
          ? { commands: body.commands as ClaraProject['commands'] }
          : {}),
        ...(body.startupScript !== undefined ? { startupScript: body.startupScript } : {}),
      })
      return c.json(present(project.id))
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
      if (body.defaultWorkspaceID) {
        const workspace = projects.workspace(body.defaultWorkspaceID)
        if (!workspace || workspace.projectID !== projectID) {
          throw new ApiRequestError(
            400,
            'invalid_workspace',
            'That workspace is not in this project'
          )
        }
      }
      projects.update(projectID, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.icon !== undefined ? { icon: body.icon as ClaraProject['icon'] } : {}),
        ...(body.commands !== undefined
          ? { commands: body.commands as ClaraProject['commands'] }
          : {}),
        ...(body.startupScript !== undefined ? { startupScript: body.startupScript } : {}),
        ...(body.defaultWorkspaceID !== undefined
          ? { defaultWorkspaceID: body.defaultWorkspaceID }
          : {}),
      })
      return c.json(present(projectID))
    }
  )

  app.post(
    '/v1/projects/:projectID/archive',
    describeRoute({
      tags: ['projects'],
      operationId: 'archiveProject',
      summary: 'Archive a project and its harness records',
      responses: responses(
        jsonResponse(resolver(claraProjectArchiveResultSchema), 'Archive result')
      ),
    }),
    validator('param', z.object({ projectID: z.string().min(1) })),
    async (c) => {
      const { projectID } = c.req.valid('param')
      const current = projects.get(projectID)
      if (!current) throw new ApiRequestError(404, 'not_found', 'That project no longer exists')
      const harnesses = await signalProjectArchive(deps, projectID, true, c.req.raw.signal)
      projects.setArchived(projectID, true)
      return c.json({ project: present(projectID), harnesses })
    }
  )

  app.post(
    '/v1/projects/:projectID/unarchive',
    describeRoute({
      tags: ['projects'],
      operationId: 'unarchiveProject',
      summary: 'Unarchive a project and its harness records',
      responses: responses(
        jsonResponse(resolver(claraProjectArchiveResultSchema), 'Unarchive result')
      ),
    }),
    validator('param', z.object({ projectID: z.string().min(1) })),
    async (c) => {
      const { projectID } = c.req.valid('param')
      const current = projects.get(projectID)
      if (!current) throw new ApiRequestError(404, 'not_found', 'That project no longer exists')
      const harnesses = await signalProjectArchive(deps, projectID, false, c.req.raw.signal)
      projects.setArchived(projectID, false)
      return c.json({ project: present(projectID), harnesses })
    }
  )

  app.delete(
    '/v1/projects/:projectID',
    describeRoute({
      tags: ['projects'],
      operationId: 'deleteProject',
      summary: 'Delete a project, optionally propagating to harnesses',
      responses: responses(jsonResponse(resolver(claraProjectDeleteResultSchema), 'Delete result')),
    }),
    validator('param', z.object({ projectID: z.string().min(1) })),
    validator('query', z.object({ mode: z.enum(['propagate', 'disconnect']).optional() })),
    async (c) => {
      const { projectID } = c.req.valid('param')
      const { mode = 'propagate' } = c.req.valid('query')
      const current = projects.get(projectID)
      if (!current) throw new ApiRequestError(404, 'not_found', 'That project no longer exists')
      let harnesses: ClaraProjectHarnessResult[] = []
      if (mode === 'propagate') {
        harnesses = await signalProjectDelete(deps, projectID, c.req.raw.signal)
      }
      projects.delete(projectID)
      return c.json({ removed: true as const, harnesses })
    }
  )

  app.post(
    '/v1/projects/:projectID/workspaces',
    describeRoute({
      tags: ['projects'],
      operationId: 'addProjectWorkspace',
      summary: 'Add a harness workspace to a project',
      responses: responses(jsonResponse(resolver(claraProjectSchema), 'Updated project')),
    }),
    validator('param', z.object({ projectID: z.string().min(1) })),
    validator('json', workspaceCreateBody),
    async (c) => {
      const { projectID } = c.req.valid('param')
      const body = c.req.valid('json')
      const project = projects.get(projectID)
      if (!project) throw new ApiRequestError(404, 'not_found', 'That project no longer exists')
      const connection = deps.harness.connection(body.harnessID)
      if (!connection) {
        throw new ApiRequestError(404, 'harness_missing', 'That harness is no longer paired')
      }
      const existing = projects.findWorkspaceByCanonical(body.harnessID, body.directory)
      if (existing && existing.projectID !== projectID) {
        throw new ApiRequestError(
          409,
          'workspace_exists',
          'That directory is already a workspace in another Clara project',
          { projectID: existing.projectID }
        )
      }
      const directory = body.directory.trim()
      const alreadyInProject = projects
        .workspaces(projectID)
        .some((item) => item.harnessID === body.harnessID && item.directory === directory)
      const workspace = projects.addWorkspace(projectID, {
        harnessID: body.harnessID,
        directory: body.directory,
        ...(body.label !== undefined ? { label: body.label } : {}),
      })
      const result = await syncWorkspace(deps, workspace, c.req.raw.signal)
      if (result.code === 'workspace_conflict') {
        if (!alreadyInProject) projects.removeWorkspace(workspace.id)
        throw new ApiRequestError(
          409,
          result.code,
          result.message ?? 'That directory is already a workspace in another Clara project'
        )
      }
      return c.json(present(projectID))
    }
  )

  app.delete(
    '/v1/projects/:projectID/workspaces/:workspaceID',
    describeRoute({
      tags: ['projects'],
      operationId: 'removeProjectWorkspace',
      summary: 'Remove a workspace from a project',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', z.object({ projectID: z.string().min(1), workspaceID: z.string().min(1) })),
    async (c) => {
      const { projectID, workspaceID } = c.req.valid('param')
      const workspace = projects.workspace(workspaceID)
      if (!workspace || workspace.projectID !== projectID) {
        throw new ApiRequestError(404, 'not_found', 'That workspace no longer exists')
      }
      projects.removeWorkspace(workspaceID)
      return c.body(null, 204)
    }
  )

  app.post(
    '/v1/projects/:projectID/sync',
    describeRoute({
      tags: ['projects'],
      operationId: 'syncProject',
      summary: 'Resolve project workspaces through their harnesses',
      responses: responses(jsonResponse(resolver(claraProjectSchema), 'Synced project')),
    }),
    validator('param', z.object({ projectID: z.string().min(1) })),
    async (c) => {
      const { projectID } = c.req.valid('param')
      await syncProject(deps, projectID, c.req.raw.signal)
      return c.json(present(projectID))
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
      const { directory, harnessID } = c.req.valid('query')
      const location = await forwardScopedDto(
        deps,
        resolveHarnessForDirectory(deps, directory, harnessID),
        {
          method: 'GET',
          path: '/locations',
          search: locationQuery(directory),
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
        harnessID: z.string().min(1).optional(),
        query: z.string(),
        type: z.enum(['file', 'directory']).optional(),
        limit: optionalPositiveIntQuery,
      })
    ),
    async (c) => {
      const { directory, harnessID, query: text, type, limit } = c.req.valid('query')
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForDirectory(deps, directory, harnessID),
        {
          method: 'GET',
          path: '/files/find',
          search: locationQuery(directory, { query: text, type, limit }),
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
      const { directory, harnessID } = c.req.valid('query')
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForDirectory(deps, directory, harnessID),
        {
          method: 'GET',
          path: '/vcs',
          search: locationQuery(directory),
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
      const { directory, harnessID } = c.req.valid('query')
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForDirectory(deps, directory, harnessID),
        {
          method: 'GET',
          path: '/vcs/base',
          search: locationQuery(directory),
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
      const { directory, harnessID } = c.req.valid('query')
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForDirectory(deps, directory, harnessID),
        {
          method: 'GET',
          path: '/vcs/status',
          search: locationQuery(directory),
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
        harnessID: z.string().min(1).optional(),
        mode: z.enum(['working', 'branch', 'committed']),
        base: z.string().optional(),
        context: optionalPositiveIntQuery,
      })
    ),
    async (c) => {
      const { directory, harnessID, mode, base, context } = c.req.valid('query')
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForDirectory(deps, directory, harnessID),
        {
          method: 'POST',
          path: '/vcs/diff',
          search: locationQuery(directory, { mode, base, context }),
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
    validator(
      'query',
      z.object({
        project: z.string().min(1).optional(),
        harnessID: z.string().min(1).optional(),
      })
    ),
    async (c) => {
      const { project, harnessID: requestedHarnessID } = c.req.valid('query')
      if (!project) {
        const harnessID = requireHarnessContext(deps, requestedHarnessID)
        const result = await forwardDtoTo(
          deps,
          harnessID,
          { method: 'GET', path: '/worktrees', search: query({}) },
          c.req.raw.signal,
          parseClaraWorktrees
        )
        return c.json(result)
      }

      const groups = await resolveHarnessProjectGroups(deps, project, c.req.raw.signal)
      if (groups.length === 0) throw unmappedProjectError(project)

      const results = await Promise.all(
        groups.map((group) =>
          Promise.allSettled(
            group.projectIDs.map((projectID) =>
              forwardDtoTo(
                deps,
                group.harnessID,
                {
                  method: 'GET',
                  path: '/worktrees',
                  search: query({ projectID }),
                },
                c.req.raw.signal,
                parseClaraWorktrees
              )
            )
          )
        )
      )
      const byDirectory = new Map<string, ClaraWorktree>()
      let succeeded = false
      let firstError: unknown
      for (const group of results) {
        for (const item of group) {
          if (item.status === 'fulfilled') {
            succeeded = true
            for (const worktree of item.value) {
              if (!byDirectory.has(worktree.directory)) {
                byDirectory.set(worktree.directory, worktree)
              }
            }
          } else if (firstError === undefined) {
            firstError = item.reason
          }
        }
      }
      if (!succeeded) throw asApiError(firstError)
      return c.json([...byDirectory.values()])
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
      const { projectID } = c.req.valid('json')
      const groups = await resolveHarnessProjectGroups(deps, projectID, c.req.raw.signal)
      if (groups.length === 0) throw unmappedProjectError(projectID)

      const results = await Promise.allSettled(
        groups.flatMap((group) =>
          group.projectIDs.map((harnessProjectID) =>
            forwardResultTo(
              deps,
              group.harnessID,
              {
                method: 'POST',
                path: '/worktrees/refresh',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ projectID: harnessProjectID }),
              },
              c.req.raw.signal
            )
          )
        )
      )
      if (results.every((item) => item.status === 'rejected')) {
        throw asApiError(results[0]?.reason)
      }
      return c.body(null, 204)
    }
  )
}

function forwardScopedDto<T>(
  deps: ApiDependencies,
  harnessID: string,
  request: Parameters<typeof forwardDtoTo>[2],
  signal: AbortSignal,
  parse: (value: unknown) => T
): Promise<T> {
  return forwardDtoTo(deps, harnessID, request, signal, parse)
}

function asApiError(cause: unknown): ApiRequestError {
  if (cause instanceof ApiRequestError) return cause
  return new ApiRequestError(
    502,
    'upstream_error',
    cause instanceof Error ? cause.message : String(cause)
  )
}
