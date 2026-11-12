import { describeRoute, resolver, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import {
  claraFormSchema,
  claraPermissionRequestListOutputSchema,
  claraSessionActiveOutputSchema,
  claraSessionInboxCompactionSchema,
  claraSessionInboxInfoSchema,
  claraSessionInboxSyntheticSchema,
  claraSessionInboxUserSchema,
  claraSessionInterruptResponseSchema,
  claraSessionMessageSchema,
  claraSessionMessagesResponseSchema,
  claraSessionSchema,
  type ClaraSession,
  type ClaraSessionsResponse,
  claraSessionsResponseSchema,
} from '@clara/api-contract'
import type { ApiDependencies, ApiVariables } from '../context.ts'
import {
  forwardDto,
  parseClaraForms,
  parseClaraPermissionRequests,
  parseClaraSession,
  parseClaraSessionActive,
  parseClaraSessionInbox,
  parseClaraSessionInboxCompaction,
  parseClaraSessionInboxSynthetic,
  parseClaraSessionInboxUser,
  parseClaraSessionInterrupt,
  parseClaraSessionMessages,
  parseClaraSessionMessagesResponse,
  parseClaraSessions,
} from '../dto.ts'
import { forwardResult, query } from '../harness.ts'
import { resolveHarnessProjectIds, unmappedProjectError } from '../project-links.ts'
import { decodeMergedSessionCursor, mergeSessionPages, type SessionPage } from '../session-pages.ts'
import { emptyResponse, jsonResponse, responses, statusResponses } from '../schemas.ts'
import { optionalBooleanQuery, optionalPositiveIntQuery } from '../query.ts'

const sessionParam = z.object({ sessionID: z.string().min(1) })
const sessionFormParam = z.object({
  sessionID: z.string().min(1),
  formID: z.string().min(1),
})
const sessionInboxParam = z.object({
  sessionID: z.string().min(1),
  inboxID: z.string().min(1),
})
const sessionPermissionParam = z.object({
  sessionID: z.string().min(1),
  requestID: z.string().min(1),
})

const createBody = z
  .object({
    id: z.string().optional(),
    parentID: z.string().optional(),
    title: z.string().optional(),
    agent: z.string().optional(),
    model: z.unknown().optional(),
    location: z.object({ directory: z.string().optional() }).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    permissions: z.unknown().optional(),
  })
  .passthrough()

const updateBody = z
  .object({
    title: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    permissions: z.unknown().optional(),
    archived: z.boolean().optional(),
  })
  .passthrough()

const promptBody = z
  .object({
    id: z.string().optional(),
    text: z.string(),
    files: z.array(z.unknown()).optional(),
    agents: z.array(z.unknown()).optional(),
    skills: z.array(z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    delivery: z.enum(['steer', 'queue']).optional(),
    resume: z.boolean().optional(),
  })
  .passthrough()

const syntheticBody = z
  .object({
    id: z.string().optional(),
    text: z.string(),
    description: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    delivery: z.enum(['steer', 'queue']).optional(),
    resume: z.boolean().optional(),
  })
  .passthrough()

const commandBody = z
  .object({
    name: z.string().min(1),
    text: z.string(),
    files: z.array(z.unknown()).optional(),
    agents: z.array(z.unknown()).optional(),
    skills: z.array(z.unknown()).optional(),
    delivery: z.enum(['steer', 'queue']).optional(),
  })
  .passthrough()

const forkBody = z.object({ before: z.string().optional() }).passthrough()

const moveBody = z
  .object({
    directory: z.string().min(1),
    delivery: z.enum(['steer', 'queue']).optional(),
  })
  .passthrough()

const viewBody = z.object({ idle: z.boolean().optional() }).passthrough()

const interruptBody = z.object({ resume: z.boolean().optional() }).passthrough()

const compactBody = z
  .object({
    id: z.string().optional(),
    delivery: z.enum(['steer', 'queue']).optional(),
  })
  .passthrough()

const agentBody = z.object({ agent: z.string().min(1) }).passthrough()

const modelBody = z
  .object({
    model: z
      .object({
        id: z.string(),
        providerID: z.string(),
        variant: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough()

const formReplyBody = z.object({
  answer: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
})

const formCancelBody = z.object({ message: z.string().optional() }).passthrough()

const permissionReplyBody = z.object({
  decision: z.enum(['once', 'always', 'reject']),
  message: z.string().optional(),
})

export function registerSessionRoutes(
  app: Hono<{ Variables: ApiVariables }>,
  deps: ApiDependencies
): void {
  app.get(
    '/v1/sessions',
    describeRoute({
      tags: ['sessions'],
      operationId: 'listSessions',
      summary: 'List sessions',
      responses: responses(jsonResponse(resolver(claraSessionsResponseSchema), 'Sessions')),
    }),
    validator(
      'query',
      z.object({
        limit: optionalPositiveIntQuery,
        order: z.enum(['asc', 'desc']).optional(),
        search: z.string().optional(),
        parentID: z.string().optional(),
        archived: optionalBooleanQuery,
        directory: z.string().optional(),
        project: z.string().optional(),
        subpath: z.string().optional(),
        cursor: z.string().optional(),
      })
    ),
    async (c) => {
      const params = c.req.valid('query')
      const projectIds = params.project
        ? await resolveHarnessProjectIds(deps, params.project, c.req.raw.signal)
        : []
      if (params.project && projectIds.length === 0) {
        throw unmappedProjectError(params.project)
      }

      const result =
        projectIds.length > 1
          ? mergeSessionPages(
              await listSessionPages(deps, params, projectIds, c.req.raw.signal),
              params.order
            )
          : await listSingleSessionPage(deps, params, projectIds[0], c.req.raw.signal)
      const overlaid = deps.harness.overlaySessionList(result)
      const data =
        params.archived === undefined
          ? overlaid.data
          : overlaid.data.filter((session) => Boolean(session.time.archived) === params.archived)
      return c.json({ ...overlaid, data })
    }
  )

  app.post(
    '/v1/sessions',
    describeRoute({
      tags: ['sessions'],
      operationId: 'createSession',
      summary: 'Create a session',
      responses: responses(jsonResponse(resolver(claraSessionSchema), 'Created session')),
    }),
    validator('json', createBody),
    async (c) => {
      const body = c.req.valid('json')
      const session = await forwardDto(
        deps,
        {
          method: 'POST',
          path: '/sessions',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        c.req.raw.signal,
        parseClaraSession,
        true
      )
      return c.json(overlaySession(deps, session))
    }
  )

  app.get(
    '/v1/sessions/active',
    describeRoute({
      tags: ['sessions'],
      operationId: 'listActiveSessions',
      summary: 'List active session state',
      responses: responses(
        jsonResponse(resolver(claraSessionActiveOutputSchema), 'Active sessions')
      ),
    }),
    async (c) => {
      const result = await forwardDto(
        deps,
        { method: 'GET', path: '/sessions/active' },
        c.req.raw.signal,
        parseClaraSessionActive,
        true
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/sessions/:sessionID',
    describeRoute({
      tags: ['sessions'],
      operationId: 'getSession',
      summary: 'Read one session',
      responses: responses(jsonResponse(resolver(claraSessionSchema), 'Session')),
    }),
    validator('param', sessionParam),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const session = await forwardDto(
        deps,
        {
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionID)}`,
        },
        c.req.raw.signal,
        parseClaraSession,
        true
      )
      return c.json(overlaySession(deps, session))
    }
  )

  app.patch(
    '/v1/sessions/:sessionID',
    describeRoute({
      tags: ['sessions'],
      operationId: 'updateSession',
      summary: 'Update session metadata',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionParam),
    validator('json', updateBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const body = c.req.valid('json')
      await forwardResult(
        deps,
        {
          method: 'PATCH',
          path: `/sessions/${encodeURIComponent(sessionID)}`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        c.req.raw.signal
      )
      const harnessId = deps.harness.harnessId
      if (harnessId) {
        if (typeof body.archived === 'boolean') {
          deps.harness.metadata.setArchived(harnessId, sessionID, body.archived)
        }
        if (body.metadata && typeof body.metadata === 'object') {
          deps.harness.metadata.setSnoozed(harnessId, sessionID, body.metadata.snoozed === true)
        }
        if (typeof body.title === 'string') {
          deps.harness.metadata.setTitle(harnessId, sessionID, body.title)
        }
      }
      return c.body(null, 204)
    }
  )

  app.delete(
    '/v1/sessions/:sessionID',
    describeRoute({
      tags: ['sessions'],
      operationId: 'deleteSession',
      summary: 'Delete a session',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionParam),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'DELETE',
          path: `/sessions/${encodeURIComponent(sessionID)}`,
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/fork',
    describeRoute({
      tags: ['sessions'],
      operationId: 'forkSession',
      summary: 'Fork a session',
      responses: responses(jsonResponse(resolver(claraSessionSchema), 'Forked session')),
    }),
    validator('param', sessionParam),
    validator('json', forkBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const session = await forwardDto(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/fork`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
        parseClaraSession,
        true
      )
      return c.json(overlaySession(deps, session))
    }
  )

  app.post(
    '/v1/sessions/:sessionID/move',
    describeRoute({
      tags: ['sessions'],
      operationId: 'moveSession',
      summary: 'Move a session to another directory',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionParam),
    validator('json', moveBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/move`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/view',
    describeRoute({
      tags: ['sessions'],
      operationId: 'viewSession',
      summary: 'Mark a session as viewed',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionParam),
    validator('json', viewBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/view`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      const harnessId = deps.harness.harnessId
      if (harnessId) deps.harness.metadata.setViewed(harnessId, sessionID)
      return c.body(null, 204)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/prompt',
    describeRoute({
      tags: ['sessions'],
      operationId: 'promptSession',
      summary: 'Send a prompt to a session',
      responses: responses(jsonResponse(resolver(claraSessionInboxUserSchema), 'Queued prompt')),
    }),
    validator('param', sessionParam),
    validator('json', promptBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardDto(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/prompt`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
        parseClaraSessionInboxUser,
        true
      )
      return c.json(result)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/synthetic',
    describeRoute({
      tags: ['sessions'],
      operationId: 'syntheticSession',
      summary: 'Send a synthetic prompt to a session',
      responses: responses(
        jsonResponse(resolver(claraSessionInboxSyntheticSchema), 'Queued synthetic prompt')
      ),
    }),
    validator('param', sessionParam),
    validator('json', syntheticBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardDto(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/synthetic`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
        parseClaraSessionInboxSynthetic,
        true
      )
      return c.json(result)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/command',
    describeRoute({
      tags: ['sessions'],
      operationId: 'runSessionCommand',
      summary: 'Run a slash command in a session',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionParam),
    validator('json', commandBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/command`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/interrupt',
    describeRoute({
      tags: ['sessions'],
      operationId: 'interruptSession',
      summary: 'Interrupt a running session',
      responses: responses(
        jsonResponse(resolver(claraSessionInterruptResponseSchema), 'Interrupt result')
      ),
    }),
    validator('param', sessionParam),
    validator('json', interruptBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardDto(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/interrupt`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
        parseClaraSessionInterrupt,
        true
      )
      return c.json(result)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/compact',
    describeRoute({
      tags: ['sessions'],
      operationId: 'compactSession',
      summary: 'Compact a session',
      responses: responses(
        jsonResponse(resolver(claraSessionInboxCompactionSchema), 'Queued compaction')
      ),
    }),
    validator('param', sessionParam),
    validator('json', compactBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardDto(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/compact`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
        parseClaraSessionInboxCompaction,
        true
      )
      return c.json(result)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/agent',
    describeRoute({
      tags: ['sessions'],
      operationId: 'switchSessionAgent',
      summary: 'Switch the session agent',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionParam),
    validator('json', agentBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/agent`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/model',
    describeRoute({
      tags: ['sessions'],
      operationId: 'switchSessionModel',
      summary: 'Switch the session model',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionParam),
    validator('json', modelBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/model`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )

  app.get(
    '/v1/sessions/:sessionID/context',
    describeRoute({
      tags: ['sessions'],
      operationId: 'getSessionContext',
      summary: 'Read session context messages',
      responses: responses(
        jsonResponse(resolver(z.array(claraSessionMessageSchema)), 'Context messages')
      ),
    }),
    validator('param', sessionParam),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionID)}/context`,
        },
        c.req.raw.signal,
        parseClaraSessionMessages,
        true
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/sessions/:sessionID/messages',
    describeRoute({
      tags: ['messages'],
      operationId: 'listMessages',
      summary: 'List session messages',
      responses: responses(jsonResponse(resolver(claraSessionMessagesResponseSchema), 'Messages')),
    }),
    validator('param', sessionParam),
    validator(
      'query',
      z.object({
        order: z.enum(['asc', 'desc']).optional(),
        limit: optionalPositiveIntQuery,
        cursor: z.string().optional(),
        type: z.string().optional(),
      })
    ),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const params = c.req.valid('query')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionID)}/messages`,
          search: query(params),
        },
        c.req.raw.signal,
        parseClaraSessionMessagesResponse
      )
      return c.json(result)
    }
  )

  app.get(
    '/v1/sessions/:sessionID/forms',
    describeRoute({
      tags: ['forms'],
      operationId: 'listForms',
      summary: 'List pending session forms',
      responses: responses(jsonResponse(resolver(z.array(claraFormSchema)), 'Pending forms')),
    }),
    validator('param', sessionParam),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionID)}/forms`,
        },
        c.req.raw.signal,
        parseClaraForms,
        true
      )
      return c.json(result)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/forms/:formID/reply',
    describeRoute({
      tags: ['forms'],
      operationId: 'replyForm',
      summary: 'Answer a session form',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionFormParam),
    validator('json', formReplyBody),
    async (c) => {
      const { sessionID, formID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/forms/${encodeURIComponent(formID)}/reply`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )

  app.delete(
    '/v1/sessions/:sessionID/forms/:formID',
    describeRoute({
      tags: ['forms'],
      operationId: 'cancelForm',
      summary: 'Cancel a session form',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionFormParam),
    validator('json', formCancelBody),
    async (c) => {
      const { sessionID, formID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'DELETE',
          path: `/sessions/${encodeURIComponent(sessionID)}/forms/${encodeURIComponent(formID)}`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )

  app.get(
    '/v1/sessions/:sessionID/inbox',
    describeRoute({
      tags: ['inbox'],
      operationId: 'listInbox',
      summary: 'List a session inbox',
      responses: responses(
        jsonResponse(resolver(z.array(claraSessionInboxInfoSchema)), 'Inbox items')
      ),
    }),
    validator('param', sessionParam),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionID)}/inbox`,
        },
        c.req.raw.signal,
        parseClaraSessionInbox,
        true
      )
      return c.json(result)
    }
  )

  app.delete(
    '/v1/sessions/:sessionID/inbox/:inboxID',
    describeRoute({
      tags: ['inbox'],
      operationId: 'cancelInbox',
      summary: 'Cancel an inbox item',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionInboxParam),
    async (c) => {
      const { sessionID, inboxID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'DELETE',
          path: `/sessions/${encodeURIComponent(sessionID)}/inbox/${encodeURIComponent(inboxID)}`,
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )

  app.get(
    '/v1/permissions',
    describeRoute({
      tags: ['permissions'],
      operationId: 'listPermissions',
      summary: 'List pending permission requests',
      responses: responses(
        jsonResponse(resolver(claraPermissionRequestListOutputSchema), 'Permission requests')
      ),
    }),
    validator('query', z.object({ directory: z.string().optional() })),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/permissions',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal,
        parseClaraPermissionRequests
      )
      return c.json(result)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/permissions/:requestID/reply',
    describeRoute({
      tags: ['permissions'],
      operationId: 'replyPermission',
      summary: 'Answer a permission request',
      responses: statusResponses(204, emptyResponse()),
    }),
    validator('param', sessionPermissionParam),
    validator('json', permissionReplyBody),
    async (c) => {
      const { sessionID, requestID } = c.req.valid('param')
      await forwardResult(
        deps,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(requestID)}/reply`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )
}

type SessionListParams = {
  limit?: number
  order?: 'asc' | 'desc'
  search?: string
  parentID?: string
  archived?: boolean
  directory?: string
  project?: string
  subpath?: string
  cursor?: string
}

/**
 * List sessions for a Clara project that currently owns a single harness
 * record. A composite cursor left over from when the project owned several
 * records is translated to that record's cursor instead of being forwarded to
 * the harness as-is.
 */
async function listSingleSessionPage(
  deps: ApiDependencies,
  params: SessionListParams,
  projectID: string | undefined,
  signal: AbortSignal
): Promise<ClaraSessionsResponse> {
  const merged = decodeMergedSessionCursor(params.cursor)
  const cursor = projectID && merged ? merged.projects[projectID] : params.cursor
  if (cursor === null) {
    return { data: [], cursor: { previous: null, next: null } }
  }
  return forwardDto(
    deps,
    {
      method: 'GET',
      path: '/sessions',
      search: query({
        ...params,
        cursor,
        ...(projectID ? { project: projectID } : {}),
      }),
    },
    signal,
    parseClaraSessions
  )
}

/**
 * Fetch one page from every harness project record linked to a Clara project.
 * Each record keeps its own cursor, so the hub can merge the pages without
 * losing or repeating rows. Exhausted records return no data and stay in the
 * page list so the next cursor can mark them done.
 */
async function listSessionPages(
  deps: ApiDependencies,
  params: SessionListParams,
  projectIds: string[],
  signal: AbortSignal
): Promise<SessionPage[]> {
  const merged = decodeMergedSessionCursor(params.cursor)
  return Promise.all(
    projectIds.map(async (projectID): Promise<SessionPage> => {
      const cursor = merged?.projects[projectID]
      if (cursor === null) {
        return { projectID, data: [], cursor: { previous: null, next: null } }
      }
      const result: ClaraSessionsResponse = await forwardDto(
        deps,
        {
          method: 'GET',
          path: '/sessions',
          search: query({
            ...params,
            cursor: cursor ?? undefined,
            project: projectID,
          }),
        },
        signal,
        parseClaraSessions
      )
      return { projectID, ...result }
    })
  )
}

function overlaySession(deps: ApiDependencies, session: ClaraSession): ClaraSession {
  const harnessId = deps.harness.harnessId
  return harnessId ? deps.harness.overlaySession(harnessId, session) : session
}
