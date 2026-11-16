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
  claraSessionSignalsResponseSchema,
  type ClaraSession,
  type ClaraSessionsHarnessStatus,
  type ClaraSessionsResponse,
  claraSessionsResponseSchema,
} from '@clara/api-contract'
import { ApiRequestError, type ApiDependencies, type ApiVariables } from '../context.ts'
import { SessionSignalsService, type SessionSignalRequest } from '../../activity/session-signals.ts'
import {
  forwardDtoTo,
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
import { forwardResultTo, locationQuery, query } from '../harness.ts'
import {
  requireHarness,
  requireHarnessContext,
  resolveHarnessForDirectory,
  resolveHarnessForSession,
  resolveHarnessProjectGroups,
  type HarnessProjectGroup,
} from '../harness-scope.ts'
import { unmappedProjectError } from '../project-links.ts'
import {
  cursorForRecord,
  decodeMergedSessionCursor,
  mergeSessionPages,
  type SessionPage,
} from '../session-pages.ts'
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
    harnessID: z.string().min(1).optional(),
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

const viewBody = z.object({ idle: z.number().optional() }).passthrough()

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
  deps: ApiDependencies,
  signals: SessionSignalsService
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
        harnessID: z.string().min(1).optional(),
        project: z.string().optional(),
        subpath: z.string().optional(),
        cursor: z.string().optional(),
      })
    ),
    async (c) => {
      const params = c.req.valid('query')
      // `harnessID` is a hub routing hint and must never reach the harness.
      const { harnessID, ...filters } = params
      let result: ClaraSessionsResponse
      if (params.project) {
        result = await listProjectSessions(
          deps,
          filters,
          params.project,
          c.req.raw.signal,
          harnessID
        )
      } else {
        const targetHarnessID = harnessID
          ? requireHarness(deps, harnessID)
          : params.directory
            ? resolveHarnessForDirectory(deps, params.directory)
            : params.parentID
              ? resolveHarnessForSession(deps, params.parentID)
              : requireHarnessContext(deps, undefined)
        result = overlaySessionListFor(
          deps,
          targetHarnessID,
          await forwardScopedDto(
            deps,
            targetHarnessID,
            { method: 'GET', path: '/sessions', search: query(filters) },
            c.req.raw.signal,
            parseClaraSessions
          )
        )
      }
      const data =
        params.archived === undefined
          ? result.data
          : result.data.filter((session) => Boolean(session.time.archived) === params.archived)
      return c.json({ ...result, data })
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
      const { harnessID: requestedHarnessID, ...forward } = body
      const harnessID = requestedHarnessID
        ? requireHarness(deps, requestedHarnessID)
        : body.location?.directory
          ? resolveHarnessForDirectory(deps, body.location.directory)
          : body.parentID
            ? resolveHarnessForSession(deps, body.parentID)
            : requireHarnessContext(deps, undefined)
      const session = await forwardScopedDto(
        deps,
        harnessID,
        {
          method: 'POST',
          path: '/sessions',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(forward),
        },
        c.req.raw.signal,
        parseClaraSession,
        true
      )
      return c.json(overlaySession(deps, harnessID, session))
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
    validator('query', z.object({ harnessID: z.string().min(1).optional() })),
    async (c) => {
      const requested = c.req.valid('query').harnessID
      if (requested) {
        const result = await forwardDtoTo(
          deps,
          requireHarness(deps, requested),
          { method: 'GET', path: '/sessions/active' },
          c.req.raw.signal,
          parseClaraSessionActive,
          true
        )
        return c.json(result)
      }

      const connections = deps.harness.list().filter((connection) => connection.online)
      if (connections.length === 0) return c.json({})

      const results = await Promise.allSettled(
        connections.map((connection) =>
          forwardDtoTo(
            deps,
            connection.harnessId,
            { method: 'GET', path: '/sessions/active' },
            c.req.raw.signal,
            parseClaraSessionActive,
            true
          )
        )
      )
      const merged: Record<string, { type: 'running' }> = {}
      let succeeded = false
      let firstError: unknown
      for (const item of results) {
        if (item.status === 'fulfilled') {
          succeeded = true
          Object.assign(merged, item.value)
        } else if (firstError === undefined) {
          firstError = item.reason
        }
      }
      if (!succeeded) throw asApiError(firstError)
      return c.json(merged)
    }
  )

  app.get(
    '/v1/sessions/signals',
    describeRoute({
      tags: ['sessions'],
      operationId: 'listSessionSignals',
      summary: 'Read mailbox signals for many sessions at once',
      description:
        'Pass `sessions` as a comma-separated list of `sessionID@updated` pairs, ' +
        'where `updated` is the value from the session `time.updated`. Unknown ' +
        'or offline sessions are omitted.',
      responses: responses(
        jsonResponse(resolver(claraSessionSignalsResponseSchema), 'Session mailbox signals')
      ),
    }),
    validator(
      'query',
      z.object({
        sessions: z.string().min(1),
      })
    ),
    async (c) => {
      const requests = parseSessionSignalQuery(c.req.valid('query').sessions)
      return c.json({
        // A sidebar refetches one session at a time after an event, so the
        // batch reads fresh signals instead of risking a stale form state.
        data: await signals.load(requests, c.req.raw.signal, { refresh: true }),
      })
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
      const harnessID = resolveHarnessForSession(deps, sessionID)
      const session = await forwardScopedDto(
        deps,
        harnessID,
        {
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionID)}`,
        },
        c.req.raw.signal,
        parseClaraSession,
        true
      )
      return c.json(overlaySession(deps, harnessID, session))
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
      const harnessID = resolveHarnessForSession(deps, sessionID)
      await forwardScopedResult(
        deps,
        harnessID,
        {
          method: 'PATCH',
          path: `/sessions/${encodeURIComponent(sessionID)}`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        c.req.raw.signal
      )
      if (harnessID) {
        if (typeof body.archived === 'boolean') {
          deps.harness.metadata.setArchived(harnessID, sessionID, body.archived)
        }
        if (body.metadata && typeof body.metadata === 'object') {
          deps.harness.metadata.setSnoozed(harnessID, sessionID, body.metadata.snoozed === true)
        }
        if (typeof body.title === 'string') {
          deps.harness.metadata.setTitle(harnessID, sessionID, body.title)
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
      await forwardScopedResult(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      const harnessID = resolveHarnessForSession(deps, sessionID)
      const session = await forwardScopedDto(
        deps,
        harnessID,
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
      return c.json(overlaySession(deps, harnessID, session))
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
      await forwardScopedResult(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      const body = c.req.valid('json')
      const harnessID = resolveHarnessForSession(deps, sessionID)
      await forwardScopedResult(
        deps,
        harnessID,
        {
          method: 'POST',
          path: `/sessions/${encodeURIComponent(sessionID)}/view`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        c.req.raw.signal
      )
      // Record the watermark the viewer actually saw, not the hub wall clock:
      // the adapter may run on a machine with a different clock.
      if (harnessID) deps.harness.metadata.setViewed(harnessID, sessionID, body.idle)
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
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      await forwardScopedResult(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      await forwardScopedResult(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      await forwardScopedResult(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      await forwardScopedResult(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      await forwardScopedResult(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
      await forwardScopedResult(
        deps,
        resolveHarnessForSession(deps, sessionID),
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
    validator(
      'query',
      z.object({
        directory: z.string().optional(),
        harnessID: z.string().min(1).optional(),
      })
    ),
    async (c) => {
      const { directory, harnessID } = c.req.valid('query')
      const result = await forwardScopedDto(
        deps,
        resolveHarnessForDirectory(deps, directory, harnessID),
        {
          method: 'GET',
          path: '/permissions',
          search: locationQuery(directory),
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
      await forwardScopedResult(
        deps,
        resolveHarnessForSession(deps, sessionID),
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

type GroupLoad = {
  group: HarnessProjectGroup
  pages: SessionPage[]
  error?: ApiRequestError
}

/**
 * Fetch the project's page from every harness that owns a linked record. A
 * harness that is offline or fails is reported in `harnesses` instead of
 * failing the whole list, so one unavailable machine never hides the others.
 * The request only fails when no harness returned anything.
 */
async function listProjectSessions(
  deps: ApiDependencies,
  params: SessionListParams,
  projectID: string,
  signal: AbortSignal,
  harnessID?: string
): Promise<ClaraSessionsResponse> {
  const groups = (await resolveHarnessProjectGroups(deps, projectID, signal)).filter(
    (group) => !harnessID || group.harnessID === harnessID
  )
  if (groups.length === 0) throw unmappedProjectError(projectID)

  const merged = decodeMergedSessionCursor(params.cursor)
  const totalRecords = groups.reduce((count, group) => count + group.projectIDs.length, 0)
  // A cursor that is not a hub envelope belongs to the harness. It can only be
  // passed through when the project has exactly one harness record.
  const passThrough = merged || totalRecords !== 1 ? undefined : params.cursor
  const loads = await Promise.all(
    groups.map((group) => loadGroup(deps, group, params, signal, merged, passThrough))
  )
  const pages = loads.flatMap((load) => load.pages)
  if (pages.length === 0) {
    const failure = loads.find((load) => load.error)?.error
    throw failure ?? new ApiRequestError(502, 'upstream_error', 'No harness returned sessions')
  }
  const harnesses =
    groups.length > 1 || loads.some((load) => load.error)
      ? loads.map((load) => harnessStatus(deps, load))
      : undefined

  const singlePage = totalRecords === 1 ? pages[0] : undefined
  if (singlePage) {
    return {
      data: singlePage.data,
      cursor: singlePage.cursor,
      ...(harnesses ? { harnesses } : {}),
    }
  }

  const result = mergeSessionPages(pages, params.order)
  return { ...result, ...(harnesses ? { harnesses } : {}) }
}

async function loadGroup(
  deps: ApiDependencies,
  group: HarnessProjectGroup,
  params: SessionListParams,
  signal: AbortSignal,
  merged: ReturnType<typeof decodeMergedSessionCursor>,
  passThrough: string | undefined
): Promise<GroupLoad> {
  const settled = await Promise.allSettled(
    group.projectIDs.map((projectID) =>
      loadRecord(deps, group.harnessID, projectID, params, signal, merged, passThrough)
    )
  )
  const pages: SessionPage[] = []
  let error: ApiRequestError | undefined
  for (const item of settled) {
    if (item.status === 'fulfilled') pages.push(item.value)
    else if (!error) error = asApiError(item.reason)
  }
  return { group, pages, ...(error ? { error } : {}) }
}

/**
 * Archive state is hub-owned, so a harness page can be mostly rows the caller
 * filters out. Bound how far one request scans before returning a short page
 * and a cursor that resumes the scan on the next call.
 */
const ARCHIVED_SCAN_ROW_LIMIT = 500
const ARCHIVED_SCAN_PAGE_LIMIT = 25

/**
 * Fetch one harness project record. Each record keeps its own cursor, so the
 * hub can merge the pages without losing or repeating rows. An exhausted record
 * returns no data and stays in the page list so the next cursor marks it done.
 *
 * An archived list reads further pages until the record fills the requested
 * page with matching rows, because the harness does not know which sessions
 * Clara archived.
 */
async function loadRecord(
  deps: ApiDependencies,
  harnessID: string,
  projectID: string,
  params: SessionListParams,
  signal: AbortSignal,
  merged: ReturnType<typeof decodeMergedSessionCursor>,
  passThrough: string | undefined
): Promise<SessionPage> {
  const resolved = cursorForRecord(merged, harnessID, projectID)
  let cursor = resolved === undefined ? passThrough : resolved
  if (cursor === null) {
    return { harnessID, projectID, data: [], cursor: { previous: null, next: null } }
  }

  const target =
    params.archived === true && params.limit !== undefined && params.limit > 0
      ? params.limit
      : undefined
  const rows = new Map<string, ClaraSession>()
  let previous: string | null | undefined
  let next: string | null
  let scanned = 0

  for (let page = 0; ; page += 1) {
    const result: ClaraSessionsResponse = await forwardDtoTo(
      deps,
      harnessID,
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
    if (previous === undefined) previous = result.cursor?.previous
    next = result.cursor?.next ?? null
    for (const session of result.data) {
      const overlaid = deps.harness.overlaySession(harnessID, session)
      if (!rows.has(overlaid.id)) rows.set(overlaid.id, overlaid)
    }
    scanned += result.data.length
    const data = [...rows.values()]
    const matched = data.filter((session) => Boolean(session.time.archived)).length
    if (
      target === undefined ||
      next === null ||
      result.data.length === 0 ||
      matched >= target ||
      scanned >= ARCHIVED_SCAN_ROW_LIMIT ||
      page + 1 >= ARCHIVED_SCAN_PAGE_LIMIT
    ) {
      return { harnessID, projectID, data, cursor: { previous: previous ?? null, next } }
    }
    cursor = next
  }
}

function harnessStatus(deps: ApiDependencies, load: GroupLoad): ClaraSessionsHarnessStatus {
  const connection = deps.harness.connection(load.group.harnessID)
  return {
    harnessID: load.group.harnessID,
    label: connection?.label ?? load.group.harnessID,
    kind: connection?.kind ?? '',
    online: connection?.online ?? false,
    ok: load.error === undefined,
    ...(load.error ? { code: load.error.code, message: load.error.message } : {}),
  }
}

function asApiError(cause: unknown): ApiRequestError {
  if (cause instanceof ApiRequestError) return cause
  return new ApiRequestError(
    502,
    'upstream_error',
    cause instanceof Error ? cause.message : String(cause)
  )
}

/** One sidebar's worth of sessions; the query string stays well under a frame. */
const MAX_SIGNAL_SESSIONS = 100

/**
 * Parse `?sessions=id@updated,id@updated`. The updated stamp lets the hub serve
 * cached signals for unchanged sessions and re-read only the ones that moved.
 */
function parseSessionSignalQuery(value: string): SessionSignalRequest[] {
  const requests = new Map<string, SessionSignalRequest>()
  for (const item of value.split(',')) {
    const separator = item.lastIndexOf('@')
    const sessionID = separator > 0 ? item.slice(0, separator) : ''
    const rawUpdated = separator > 0 ? item.slice(separator + 1).trim() : ''
    const updated = rawUpdated ? Number(rawUpdated) : Number.NaN
    if (!sessionID || !Number.isFinite(updated) || updated < 0) {
      throw new ApiRequestError(
        400,
        'invalid_request',
        'Session signals need a session ID and its updated time'
      )
    }
    requests.set(sessionID, { sessionID, updated })
    if (requests.size > MAX_SIGNAL_SESSIONS) {
      throw new ApiRequestError(
        400,
        'invalid_request',
        `Ask for at most ${MAX_SIGNAL_SESSIONS} sessions at a time`
      )
    }
  }
  return [...requests.values()]
}

function forwardScopedDto<T>(
  deps: ApiDependencies,
  harnessID: string,
  request: Parameters<typeof forwardDtoTo>[2],
  signal: AbortSignal,
  parse: (value: unknown) => T,
  unwrapData = false
): Promise<T> {
  return forwardDtoTo(deps, harnessID, request, signal, parse, unwrapData)
}

function forwardScopedResult<T>(
  deps: ApiDependencies,
  harnessID: string,
  request: Parameters<typeof forwardResultTo>[2],
  signal: AbortSignal,
  unwrapData = false
): Promise<T> {
  return forwardResultTo<T>(deps, harnessID, request, signal, unwrapData)
}

function overlaySession(
  deps: ApiDependencies,
  harnessID: string,
  session: ClaraSession
): ClaraSession {
  return deps.harness.overlaySession(harnessID, session)
}

/** Overlay a session page with the harness that served it. */
function overlaySessionListFor(
  deps: ApiDependencies,
  harnessID: string,
  value: ClaraSessionsResponse
): ClaraSessionsResponse {
  return {
    ...value,
    data: value.data.map((session) => deps.harness.overlaySession(harnessID, session)),
  }
}
