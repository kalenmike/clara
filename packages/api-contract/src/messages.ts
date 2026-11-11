import { z } from 'zod'
import { claraJsonValueSchema } from './json.ts'
import { claraModelRefSchema, claraTokenUsageSchema } from './models.ts'
import {
  claraPromptAgentAttachmentSchema,
  claraPromptFileAttachmentSchema,
  claraPromptSkillAttachmentSchema,
} from './prompt.ts'
import { passthroughObject } from './schema.ts'
import { claraLocationRefSchema } from './server.ts'

export const claraToolTextContentSchema = passthroughObject({
  type: z.literal('text'),
  text: z.string(),
}).meta({ id: 'ClaraToolTextContent' })

export const claraToolFileContentSchema = passthroughObject({
  type: z.literal('file'),
  uri: z.string(),
  mime: z.string(),
  name: z.string().nullish(),
}).meta({ id: 'ClaraToolFileContent' })

export const claraToolContentSchema = z
  .discriminatedUnion('type', [claraToolTextContentSchema, claraToolFileContentSchema])
  .meta({ id: 'ClaraToolContent' })

export const claraToolContentTupleSchema = z
  .tuple([claraToolContentSchema])
  .rest(claraToolContentSchema)

export const claraSessionErrorSchema = passthroughObject({
  type: z.string(),
  message: z.string(),
  status: z.number().optional(),
  response: passthroughObject({
    body: z.string(),
  }).optional(),
}).meta({ id: 'ClaraSessionError' })

const messageBaseShape = {
  id: z.string(),
  metadata: z.record(z.string(), claraJsonValueSchema).optional(),
}

const createdTimeSchema = passthroughObject({
  created: z.number(),
})

export const claraSessionMessageAgentSelectedSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  type: z.literal('agent-switched'),
  agent: z.string(),
  previous: z.string().optional(),
}).meta({ id: 'ClaraSessionMessageAgentSelected' })

export const claraSessionMessageModelSelectedSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  type: z.literal('model-switched'),
  model: claraModelRefSchema,
  previous: claraModelRefSchema.optional(),
}).meta({ id: 'ClaraSessionMessageModelSelected' })

export const claraSessionMessageLocationSwitchedSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  type: z.literal('location-switched'),
  projectID: z.string().optional(),
  subpath: z.string().optional(),
  location: claraLocationRefSchema,
  previous: passthroughObject({
    location: claraLocationRefSchema,
    projectID: z.string().optional(),
    subpath: z.string().optional(),
  }).nullish(),
}).meta({ id: 'ClaraSessionMessageLocationSwitched' })

export const claraSessionMessageUserSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  text: z.string(),
  files: z.array(claraPromptFileAttachmentSchema).optional(),
  agents: z.array(claraPromptAgentAttachmentSchema).optional(),
  skills: z.array(claraPromptSkillAttachmentSchema).optional(),
  type: z.literal('user'),
}).meta({ id: 'ClaraSessionMessageUser' })

export const claraSessionMessageSyntheticSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  text: z.string(),
  description: z.string().optional(),
  type: z.literal('synthetic'),
}).meta({ id: 'ClaraSessionMessageSynthetic' })

export const claraSessionMessageSystemSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  type: z.literal('system'),
  text: z.string(),
  description: z.string().optional(),
}).meta({ id: 'ClaraSessionMessageSystem' })

export const claraSessionMessageSkillSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  type: z.literal('skill'),
  skill: z.string(),
  name: z.string(),
  text: z.string(),
}).meta({ id: 'ClaraSessionMessageSkill' })

export const claraSessionMessageShellSchema = passthroughObject({
  ...messageBaseShape,
  time: passthroughObject({
    created: z.number(),
    completed: z.number().optional(),
  }),
  type: z.literal('shell'),
  shellID: z.string(),
  command: z.string(),
  status: z.enum(['running', 'exited', 'timeout', 'killed']),
  exit: z
    .union([z.number(), z.literal('Infinity'), z.literal('-Infinity'), z.literal('NaN')])
    .optional(),
  output: passthroughObject({
    output: z.string(),
    cursor: z.number(),
    size: z.number(),
    truncated: z.boolean(),
  }).optional(),
}).meta({ id: 'ClaraSessionMessageShell' })

export const claraSessionMessageAssistantTextSchema = passthroughObject({
  type: z.literal('text'),
  text: z.string(),
  native: z.record(z.string(), claraJsonValueSchema).optional(),
}).meta({ id: 'ClaraSessionMessageAssistantText' })

export const claraSessionMessageAssistantReasoningSchema = passthroughObject({
  type: z.literal('reasoning'),
  text: z.string(),
  native: z.record(z.string(), claraJsonValueSchema).optional(),
  time: passthroughObject({
    created: z.number(),
    completed: z.number().optional(),
  }).optional(),
}).meta({ id: 'ClaraSessionMessageAssistantReasoning' })

export const claraSessionMessageToolStateSchema = z
  .discriminatedUnion('status', [
    passthroughObject({
      status: z.literal('streaming'),
      input: z.string(),
    }),
    passthroughObject({
      status: z.literal('running'),
      input: z.record(z.string(), claraJsonValueSchema),
      metadata: z.record(z.string(), claraJsonValueSchema),
    }),
    passthroughObject({
      status: z.literal('completed'),
      input: z.record(z.string(), claraJsonValueSchema),
      content: claraToolContentTupleSchema,
      metadata: z.record(z.string(), claraJsonValueSchema).optional(),
    }),
    passthroughObject({
      status: z.literal('error'),
      input: z.record(z.string(), claraJsonValueSchema),
      error: claraSessionErrorSchema,
      content: claraToolContentTupleSchema.optional(),
      metadata: z.record(z.string(), claraJsonValueSchema).optional(),
    }),
  ])
  .meta({ id: 'ClaraSessionMessageToolState' })

export const claraSessionMessageAssistantToolSchema = passthroughObject({
  type: z.literal('tool'),
  id: z.string(),
  name: z.string(),
  executed: z.boolean().optional(),
  native: z.record(z.string(), claraJsonValueSchema).optional(),
  state: claraSessionMessageToolStateSchema,
  time: passthroughObject({
    created: z.number(),
    ran: z.number().optional(),
    completed: z.number().optional(),
  }),
}).meta({ id: 'ClaraSessionMessageAssistantTool' })

export const claraSessionMessageAssistantContentSchema = z
  .discriminatedUnion('type', [
    claraSessionMessageAssistantTextSchema,
    claraSessionMessageAssistantReasoningSchema,
    claraSessionMessageAssistantToolSchema,
  ])
  .meta({ id: 'ClaraSessionMessageAssistantContent' })

export const claraSessionMessageAssistantRetrySchema = passthroughObject({
  attempt: z.number(),
  at: z.number(),
  error: claraSessionErrorSchema,
}).meta({ id: 'ClaraSessionMessageAssistantRetry' })

export const claraSessionMessageAssistantSchema = passthroughObject({
  ...messageBaseShape,
  time: passthroughObject({
    created: z.number(),
    streamed: z.number().optional(),
    completed: z.number().optional(),
  }),
  type: z.literal('assistant'),
  agent: z.string(),
  model: claraModelRefSchema,
  content: z.array(claraSessionMessageAssistantContentSchema),
  snapshot: passthroughObject({
    start: z.string().optional(),
    end: z.string().optional(),
    files: z.array(z.string()).optional(),
  }).optional(),
  finish: z.enum(['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']).optional(),
  rawFinish: z.string().optional(),
  native: z.record(z.string(), claraJsonValueSchema).optional(),
  cost: z.number().optional(),
  tokens: claraTokenUsageSchema.optional(),
  error: claraSessionErrorSchema.optional(),
  retry: claraSessionMessageAssistantRetrySchema.optional(),
}).meta({ id: 'ClaraSessionMessageAssistant' })

export const claraSessionMessageCompactionRunningSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  type: z.literal('compaction'),
  status: z.literal('running'),
  reason: z.enum(['auto', 'manual']),
  summary: z.string(),
}).meta({ id: 'ClaraSessionMessageCompactionRunning' })

export const claraSessionMessageCompactionCompletedSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  type: z.literal('compaction'),
  status: z.literal('completed'),
  reason: z.enum(['auto', 'manual']),
  model: claraModelRefSchema.optional(),
  native: z.record(z.string(), claraJsonValueSchema).optional(),
  summary: z.string(),
  cost: z.number().optional(),
  tokens: claraTokenUsageSchema.optional(),
}).meta({ id: 'ClaraSessionMessageCompactionCompleted' })

export const claraSessionMessageCompactionFailedSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  type: z.literal('compaction'),
  status: z.literal('failed'),
  reason: z.enum(['auto', 'manual']),
  error: claraSessionErrorSchema,
  cost: z.number().optional(),
  tokens: claraTokenUsageSchema.optional(),
}).meta({ id: 'ClaraSessionMessageCompactionFailed' })

export const claraSessionMessageCompactionSchema = z
  .union([
    claraSessionMessageCompactionRunningSchema,
    claraSessionMessageCompactionCompletedSchema,
    claraSessionMessageCompactionFailedSchema,
  ])
  .meta({ id: 'ClaraSessionMessageCompaction' })

export const claraSessionMessageIdleSchema = passthroughObject({
  ...messageBaseShape,
  time: createdTimeSchema,
  type: z.literal('idle'),
  outcome: z.enum(['succeeded', 'failed', 'interrupted']),
  error: claraSessionErrorSchema.optional(),
}).meta({ id: 'ClaraSessionMessageIdle' })

export const claraSessionMessageSchema = z
  .union([
    claraSessionMessageAgentSelectedSchema,
    claraSessionMessageModelSelectedSchema,
    claraSessionMessageLocationSwitchedSchema,
    claraSessionMessageUserSchema,
    claraSessionMessageSyntheticSchema,
    claraSessionMessageSystemSchema,
    claraSessionMessageSkillSchema,
    claraSessionMessageShellSchema,
    claraSessionMessageAssistantSchema,
    claraSessionMessageCompactionSchema,
    claraSessionMessageIdleSchema,
  ])
  .meta({ id: 'ClaraSessionMessage' })

export const claraSessionMessageListSchema = z.array(claraSessionMessageSchema)

export const claraSessionMessagesResponseSchema = passthroughObject({
  data: z.array(claraSessionMessageSchema),
  cursor: passthroughObject({
    previous: z.string().nullish(),
    next: z.string().nullish(),
  }),
}).meta({ id: 'ClaraSessionMessagesResponse' })

export type ClaraToolTextContent = z.infer<typeof claraToolTextContentSchema>
export type ClaraToolFileContent = z.infer<typeof claraToolFileContentSchema>
export type ClaraToolContent = z.infer<typeof claraToolContentSchema>
export type ClaraSessionError = z.infer<typeof claraSessionErrorSchema>
export type ClaraSessionMessageAgentSelected = z.infer<
  typeof claraSessionMessageAgentSelectedSchema
>
export type ClaraSessionMessageModelSelected = z.infer<
  typeof claraSessionMessageModelSelectedSchema
>
export type ClaraSessionMessageLocationSwitched = z.infer<
  typeof claraSessionMessageLocationSwitchedSchema
>
export type ClaraSessionMessageUser = z.infer<typeof claraSessionMessageUserSchema>
export type ClaraSessionMessageSynthetic = z.infer<typeof claraSessionMessageSyntheticSchema>
export type ClaraSessionMessageSystem = z.infer<typeof claraSessionMessageSystemSchema>
export type ClaraSessionMessageSkill = z.infer<typeof claraSessionMessageSkillSchema>
export type ClaraSessionMessageShell = z.infer<typeof claraSessionMessageShellSchema>
export type ClaraSessionMessageAssistantText = z.infer<
  typeof claraSessionMessageAssistantTextSchema
>
export type ClaraSessionMessageAssistantReasoning = z.infer<
  typeof claraSessionMessageAssistantReasoningSchema
>
export type ClaraSessionMessageToolState = z.infer<typeof claraSessionMessageToolStateSchema>
export type ClaraSessionMessageAssistantTool = z.infer<
  typeof claraSessionMessageAssistantToolSchema
>
export type ClaraSessionMessageAssistantContent = z.infer<
  typeof claraSessionMessageAssistantContentSchema
>
export type ClaraSessionMessageAssistantRetry = z.infer<
  typeof claraSessionMessageAssistantRetrySchema
>
export type ClaraSessionMessageAssistant = z.infer<typeof claraSessionMessageAssistantSchema>
export type ClaraSessionMessageCompaction = z.infer<typeof claraSessionMessageCompactionSchema>
export type ClaraSessionMessageIdle = z.infer<typeof claraSessionMessageIdleSchema>
export type ClaraSessionMessage = z.infer<typeof claraSessionMessageSchema>
export type ClaraSessionMessageType = ClaraSessionMessage['type']
export type ClaraSessionMessagesResponse = z.infer<typeof claraSessionMessagesResponseSchema>
