import { z } from 'zod'
import { claraFormSchema, claraFormValueSchema } from './forms.ts'
import { claraJsonValueSchema } from './json.ts'
import { claraSessionErrorSchema, claraToolContentTupleSchema } from './messages.ts'
import { claraModelRefSchema, claraTokenUsageSchema } from './models.ts'
import { claraPermissionRequestSchema, claraPermissionRuleSchema } from './permissions.ts'
import { passthroughObject } from './schema.ts'
import { claraLocationRefSchema } from './server.ts'
import {
  claraProjectSchema,
  claraSessionForkBoundarySchema,
  claraSessionInboxDeliverySchema,
  claraSessionInboxItemSchema,
  claraSessionMetadataSchema,
  claraSessionRevertSchema,
  claraSessionStatusSchema,
} from './sessions.ts'

export const claraShellInfoSchema = passthroughObject({
  id: z.string(),
  status: z.enum(['running', 'exited', 'timeout', 'killed']),
  command: z.string(),
  cwd: z.string(),
  shell: z.string(),
  file: z.string(),
  pid: z.number().optional(),
  exit: z
    .union([z.number(), z.literal('Infinity'), z.literal('-Infinity'), z.literal('NaN')])
    .optional(),
  signal: z.string().optional(),
  metadata: z.record(z.string(), claraJsonValueSchema),
  time: passthroughObject({
    started: z.number(),
    completed: z.number().optional(),
  }),
}).meta({ id: 'ClaraShellInfo' })

const eventBaseShape = {
  id: z.string(),
  created: z.number(),
  metadata: z.record(z.string(), claraJsonValueSchema).optional(),
  durable: passthroughObject({
    aggregateID: z.string(),
    seq: z.number(),
    version: z.number(),
  }).optional(),
  location: claraLocationRefSchema.optional(),
}

function event<const T extends string>(type: T, data: z.ZodType) {
  return passthroughObject({
    ...eventBaseShape,
    type: z.literal(type),
    data,
  })
}

const sessionIDShape = {
  sessionID: z.string(),
}

const shellOutputSchema = passthroughObject({
  output: z.string(),
  cursor: z.number(),
  size: z.number(),
  truncated: z.boolean(),
})

export const claraEventSchema = z
  .discriminatedUnion('type', [
    event('project.updated', claraProjectSchema),
    event(
      'session.created',
      passthroughObject({
        ...sessionIDShape,
        projectID: z.string(),
        location: claraLocationRefSchema,
        subpath: z.string().optional(),
        parentID: z.string().optional(),
        slug: z.string(),
        title: z.string().optional(),
        agent: z.string().optional(),
        model: claraModelRefSchema.optional(),
        metadata: claraSessionMetadataSchema.optional(),
        permissions: z.array(claraPermissionRuleSchema).optional(),
        version: z.string(),
      })
    ),
    event(
      'session.agent.selected',
      passthroughObject({
        ...sessionIDShape,
        agent: z.string(),
        previous: z.string().optional(),
      })
    ),
    event(
      'session.model.selected',
      passthroughObject({
        ...sessionIDShape,
        model: claraModelRefSchema,
        previous: claraModelRefSchema.optional(),
      })
    ),
    event(
      'session.moved',
      passthroughObject({
        ...sessionIDShape,
        location: claraLocationRefSchema,
        projectID: z.string(),
        subpath: z.string().optional(),
      })
    ),
    event(
      'session.renamed',
      passthroughObject({
        ...sessionIDShape,
        title: z.string(),
      })
    ),
    event(
      'session.metadata.updated',
      passthroughObject({
        ...sessionIDShape,
        metadata: claraSessionMetadataSchema,
      })
    ),
    event(
      'session.viewed',
      passthroughObject({
        ...sessionIDShape,
        idle: z.number(),
      })
    ),
    event('session.archived', passthroughObject({ ...sessionIDShape })),
    event('session.unarchived', passthroughObject({ ...sessionIDShape })),
    event('session.deleted', passthroughObject({ ...sessionIDShape })),
    event(
      'session.forked',
      passthroughObject({
        ...sessionIDShape,
        parentID: z.string(),
        boundary: claraSessionForkBoundarySchema,
        instructions: z.record(z.string(), z.string()).optional(),
        instructionEntries: z.unknown().optional(),
      })
    ),
    event(
      'session.inbox.delivered',
      passthroughObject({
        ...sessionIDShape,
        inboxID: z.string(),
      })
    ),
    event(
      'session.inbox.enqueued',
      passthroughObject({
        ...sessionIDShape,
        inboxID: z.string(),
        item: claraSessionInboxItemSchema,
      })
    ),
    event(
      'session.inbox.cancelled',
      passthroughObject({
        ...sessionIDShape,
        inboxID: z.string(),
      })
    ),
    event(
      'session.inbox.delivery.changed',
      passthroughObject({
        ...sessionIDShape,
        inboxID: z.string(),
        delivery: claraSessionInboxDeliverySchema,
      })
    ),
    event('session.execution.started', passthroughObject({ ...sessionIDShape })),
    event('session.execution.succeeded', passthroughObject({ ...sessionIDShape })),
    event(
      'session.execution.failed',
      passthroughObject({
        ...sessionIDShape,
        error: claraSessionErrorSchema,
      })
    ),
    event(
      'session.execution.interrupted',
      passthroughObject({
        ...sessionIDShape,
        reason: z.enum(['user', 'shutdown', 'superseded', 'inactivity']),
      })
    ),
    event(
      'session.synthetic',
      passthroughObject({
        ...sessionIDShape,
        text: z.string(),
        description: z.string().optional(),
        metadata: z.record(z.string(), claraJsonValueSchema).optional(),
      })
    ),
    event(
      'session.skill.activated',
      passthroughObject({
        ...sessionIDShape,
        id: z.string(),
        name: z.string(),
        text: z.string(),
      })
    ),
    event(
      'session.shell.started',
      passthroughObject({
        ...sessionIDShape,
        shell: claraShellInfoSchema,
      })
    ),
    event(
      'session.shell.ended',
      passthroughObject({
        ...sessionIDShape,
        shell: claraShellInfoSchema,
        output: shellOutputSchema,
      })
    ),
    event(
      'session.step.started',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        agent: z.string(),
        model: claraModelRefSchema,
        snapshot: z.string().optional(),
        started: z.number(),
      })
    ),
    event(
      'session.step.ended',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        finish: z.enum(['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']),
        rawFinish: z.string().optional(),
        native: z.record(z.string(), claraJsonValueSchema).optional(),
        cost: z.number(),
        tokens: claraTokenUsageSchema,
        snapshot: z.string().optional(),
        files: z.array(z.string()).optional(),
      })
    ),
    event(
      'session.step.failed',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        error: claraSessionErrorSchema,
        finish: z.literal('content-filter').optional(),
        rawFinish: z.string().optional(),
        native: z.record(z.string(), claraJsonValueSchema).optional(),
        cost: z.number().optional(),
        tokens: claraTokenUsageSchema.optional(),
        snapshot: z.string().optional(),
        files: z.array(z.string()).optional(),
      })
    ),
    event(
      'session.text.started',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        ordinal: z.number(),
      })
    ),
    event(
      'session.text.delta',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        ordinal: z.number(),
        delta: z.string(),
      })
    ),
    event(
      'session.text.ended',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        ordinal: z.number(),
        text: z.string(),
        native: z.record(z.string(), claraJsonValueSchema).optional(),
      })
    ),
    event(
      'session.reasoning.started',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        ordinal: z.number(),
        native: z.record(z.string(), claraJsonValueSchema).optional(),
      })
    ),
    event(
      'session.reasoning.delta',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        ordinal: z.number(),
        delta: z.string(),
      })
    ),
    event(
      'session.reasoning.ended',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        ordinal: z.number(),
        text: z.string(),
        native: z.record(z.string(), claraJsonValueSchema).optional(),
      })
    ),
    event(
      'session.tool.input.started',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        id: z.string(),
        name: z.string(),
      })
    ),
    event(
      'session.tool.input.delta',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        id: z.string(),
        delta: z.string(),
      })
    ),
    event(
      'session.tool.input.ended',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        id: z.string(),
        text: z.string(),
      })
    ),
    event(
      'session.tool.called',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        id: z.string(),
        input: z.record(z.string(), claraJsonValueSchema),
        executed: z.boolean(),
        native: z.record(z.string(), claraJsonValueSchema).optional(),
      })
    ),
    event(
      'session.tool.progress',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        id: z.string(),
        metadata: z.record(z.string(), claraJsonValueSchema),
      })
    ),
    event(
      'session.tool.success',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        id: z.string(),
        content: claraToolContentTupleSchema,
        metadata: z.record(z.string(), claraJsonValueSchema).optional(),
        executed: z.boolean(),
        native: z.record(z.string(), claraJsonValueSchema).optional(),
      })
    ),
    event(
      'session.tool.failed',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        id: z.string(),
        error: claraSessionErrorSchema,
        content: claraToolContentTupleSchema.optional(),
        metadata: z.record(z.string(), claraJsonValueSchema).optional(),
        executed: z.boolean(),
        native: z.record(z.string(), claraJsonValueSchema).optional(),
      })
    ),
    event(
      'session.retry.scheduled',
      passthroughObject({
        ...sessionIDShape,
        assistantMessageID: z.string(),
        attempt: z.number(),
        at: z.number(),
        error: claraSessionErrorSchema,
      })
    ),
    event(
      'session.compaction.started',
      passthroughObject({
        ...sessionIDShape,
        reason: z.enum(['auto', 'manual']),
        inputID: z.string().optional(),
      })
    ),
    event(
      'session.compaction.ended',
      passthroughObject({
        ...sessionIDShape,
        reason: z.enum(['auto', 'manual']),
        model: claraModelRefSchema.optional(),
        native: z.record(z.string(), claraJsonValueSchema).optional(),
        text: z.string(),
        cost: z.number().optional(),
        tokens: claraTokenUsageSchema.optional(),
      })
    ),
    event(
      'session.compaction.failed',
      passthroughObject({
        ...sessionIDShape,
        reason: z.enum(['auto', 'manual']),
        error: claraSessionErrorSchema,
        inputID: z.string().optional(),
        cost: z.number().optional(),
        tokens: claraTokenUsageSchema.optional(),
      })
    ),
    event(
      'session.revert.staged',
      passthroughObject({
        ...sessionIDShape,
        revert: claraSessionRevertSchema,
      })
    ),
    event('session.revert.cleared', passthroughObject({ ...sessionIDShape })),
    event(
      'session.revert.committed',
      passthroughObject({
        ...sessionIDShape,
        to: z.string(),
      })
    ),
    event(
      'session.usage.updated',
      passthroughObject({
        ...sessionIDShape,
        cost: z.number(),
        tokens: claraTokenUsageSchema,
      })
    ),
    event(
      'session.status',
      passthroughObject({
        ...sessionIDShape,
        status: claraSessionStatusSchema,
      })
    ),
    event('session.idle', passthroughObject({ ...sessionIDShape })),
    event('permission.asked', claraPermissionRequestSchema),
    event(
      'permission.replied',
      passthroughObject({
        ...sessionIDShape,
        requestID: z.string(),
        reply: z.enum(['once', 'always', 'reject']),
      })
    ),
    event(
      'vcs.branch.updated',
      passthroughObject({
        branch: z.string().optional(),
      })
    ),
    event(
      'worktree.updated',
      passthroughObject({
        projectID: z.string(),
      })
    ),
    event(
      'worktree.resolved',
      passthroughObject({
        projectID: z.string(),
        directory: z.string(),
        previous: z.string(),
        adopted: z.array(z.string()).optional(),
      })
    ),
    event(
      'filesystem.changed',
      passthroughObject({
        file: z.string(),
        event: z.enum(['add', 'change', 'unlink']),
      })
    ),
    event(
      'form.created',
      passthroughObject({
        form: claraFormSchema,
      })
    ),
    event(
      'form.replied',
      passthroughObject({
        id: z.string(),
        sessionID: z.string(),
        answer: z.record(z.string(), claraFormValueSchema),
      })
    ),
    event(
      'form.cancelled',
      passthroughObject({
        id: z.string(),
        sessionID: z.string(),
      })
    ),
  ])
  .meta({ id: 'ClaraEvent' })

export type ClaraShellInfo = z.infer<typeof claraShellInfoSchema>
export type ClaraEvent = z.infer<typeof claraEventSchema>
