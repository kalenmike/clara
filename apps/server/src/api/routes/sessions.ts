import { describeRoute, validator } from 'hono-openapi'
import type { Hono } from 'hono'
import { z } from 'zod'
import type {
  FormInfo,
  PermissionRequestListOutput,
  SessionActiveOutput,
  SessionInboxCompaction,
  SessionInboxInfo,
  SessionInboxSynthetic,
  SessionInboxUser,
  SessionInfo,
  SessionInterruptResponse,
  SessionMessageInfo,
  SessionMessagesResponse,
  SessionsResponse,
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
      responses: responses(jsonResponse(ref('SessionsResponse'), 'Sessions')),
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
      const result = await forwardResult<SessionsResponse>(
        deps,
        {
          method: 'GET',
          path: '/api/session',
          search: query(params),
        },
        c.req.raw.signal
      )
      return c.json(result)
    }
  )

  app.post(
    '/v1/sessions',
    describeRoute({
      tags: ['sessions'],
      operationId: 'createSession',
      summary: 'Create a session',
      responses: responses(jsonResponse(ref('SessionInfo'), 'Created session')),
    }),
    validator('json', createBody),
    async (c) => {
      const body = c.req.valid('json')
      const session = await forwardResult<SessionInfo>(
        deps,
        {
          method: 'POST',
          path: '/api/session',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        c.req.raw.signal,
        true
      )
      return c.json(session)
    }
  )

  app.get(
    '/v1/sessions/active',
    describeRoute({
      tags: ['sessions'],
      operationId: 'listActiveSessions',
      summary: 'List active session state',
      responses: responses(jsonResponse(ref('SessionActiveOutput'), 'Active sessions')),
    }),
    async (c) => {
      const result = await forwardResult<SessionActiveOutput>(
        deps,
        { method: 'GET', path: '/api/session/active' },
        c.req.raw.signal,
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
      responses: responses(jsonResponse(ref('SessionInfo'), 'Session')),
    }),
    validator('param', sessionParam),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const session = await forwardResult<SessionInfo>(
        deps,
        {
          method: 'GET',
          path: `/api/session/${encodeURIComponent(sessionID)}`,
        },
        c.req.raw.signal,
        true
      )
      return c.json(session)
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
      await forwardResult(
        deps,
        {
          method: 'PATCH',
          path: `/api/session/${encodeURIComponent(sessionID)}`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
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
          path: `/api/session/${encodeURIComponent(sessionID)}`,
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
      responses: responses(jsonResponse(ref('SessionInfo'), 'Forked session')),
    }),
    validator('param', sessionParam),
    validator('json', forkBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const session = await forwardResult<SessionInfo>(
        deps,
        {
          method: 'POST',
          path: `/api/session/${encodeURIComponent(sessionID)}/fork`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
        true
      )
      return c.json(session)
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
          path: `/api/session/${encodeURIComponent(sessionID)}/move`,
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
          path: `/api/session/${encodeURIComponent(sessionID)}/view`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )

  app.post(
    '/v1/sessions/:sessionID/prompt',
    describeRoute({
      tags: ['sessions'],
      operationId: 'promptSession',
      summary: 'Send a prompt to a session',
      responses: responses(jsonResponse(ref('SessionInboxUser'), 'Queued prompt')),
    }),
    validator('param', sessionParam),
    validator('json', promptBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardResult<SessionInboxUser>(
        deps,
        {
          method: 'POST',
          path: `/api/session/${encodeURIComponent(sessionID)}/prompt`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
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
      responses: responses(jsonResponse(ref('SessionInboxSynthetic'), 'Queued synthetic prompt')),
    }),
    validator('param', sessionParam),
    validator('json', syntheticBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardResult<SessionInboxSynthetic>(
        deps,
        {
          method: 'POST',
          path: `/api/session/${encodeURIComponent(sessionID)}/synthetic`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
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
          path: `/api/session/${encodeURIComponent(sessionID)}/command`,
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
      responses: responses(jsonResponse(ref('SessionInterruptResponse'), 'Interrupt result')),
    }),
    validator('param', sessionParam),
    validator('json', interruptBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardResult<SessionInterruptResponse>(
        deps,
        {
          method: 'POST',
          path: `/api/session/${encodeURIComponent(sessionID)}/interrupt`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
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
      responses: responses(jsonResponse(ref('SessionInboxCompaction'), 'Queued compaction')),
    }),
    validator('param', sessionParam),
    validator('json', compactBody),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardResult<SessionInboxCompaction>(
        deps,
        {
          method: 'POST',
          path: `/api/session/${encodeURIComponent(sessionID)}/compact`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal,
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
          path: `/api/session/${encodeURIComponent(sessionID)}/agent`,
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
          path: `/api/session/${encodeURIComponent(sessionID)}/model`,
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
      responses: responses(jsonResponse(arrayOf(ref('SessionMessageInfo')), 'Context messages')),
    }),
    validator('param', sessionParam),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardResult<SessionMessageInfo[]>(
        deps,
        {
          method: 'GET',
          path: `/api/session/${encodeURIComponent(sessionID)}/context`,
        },
        c.req.raw.signal,
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
      responses: responses(jsonResponse(ref('SessionMessagesResponse'), 'Messages')),
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
      const result = await forwardResult<SessionMessagesResponse>(
        deps,
        {
          method: 'GET',
          path: `/api/session/${encodeURIComponent(sessionID)}/message`,
          search: query(params),
        },
        c.req.raw.signal
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
      responses: responses(jsonResponse(arrayOf(ref('FormInfo')), 'Pending forms')),
    }),
    validator('param', sessionParam),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardResult<FormInfo[]>(
        deps,
        {
          method: 'GET',
          path: `/api/session/${encodeURIComponent(sessionID)}/form`,
        },
        c.req.raw.signal,
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
          path: `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}/reply`,
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
          path: `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}`,
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
      responses: responses(jsonResponse(arrayOf(ref('SessionInboxInfo')), 'Inbox items')),
    }),
    validator('param', sessionParam),
    async (c) => {
      const { sessionID } = c.req.valid('param')
      const result = await forwardResult<SessionInboxInfo[]>(
        deps,
        {
          method: 'GET',
          path: `/api/session/${encodeURIComponent(sessionID)}/inbox`,
        },
        c.req.raw.signal,
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
          path: `/api/session/${encodeURIComponent(sessionID)}/inbox/${encodeURIComponent(inboxID)}`,
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
      responses: responses(jsonResponse(ref('PermissionRequestListOutput'), 'Permission requests')),
    }),
    validator('query', z.object({ directory: z.string().optional() })),
    async (c) => {
      const { directory } = c.req.valid('query')
      const result = await forwardResult<PermissionRequestListOutput>(
        deps,
        {
          method: 'GET',
          path: '/api/permission/request',
          search: query({ location: { directory } }),
        },
        c.req.raw.signal
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
          path: `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c.req.valid('json')),
        },
        c.req.raw.signal
      )
      return c.body(null, 204)
    }
  )
}
