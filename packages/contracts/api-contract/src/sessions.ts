import { z } from 'zod'
import { claraJsonValueSchema } from './json.ts'
import { claraModelRefSchema, claraTokenUsageSchema, type ClaraTokenUsage } from './models.ts'
import { claraPermissionRuleSchema } from './permissions.ts'
import {
  claraPromptAgentAttachmentSchema,
  claraPromptFileAttachmentSchema,
  claraPromptSkillAttachmentSchema,
} from './prompt.ts'
import { passthroughObject } from './schema.ts'
import { claraLocationRefSchema } from './server.ts'
import { claraFileDiffSchema } from './vcs.ts'

export const claraSessionMetadataSchema = z.record(z.string(), claraJsonValueSchema)

export type ClaraSessionMetadata = Record<string, z.infer<typeof claraJsonValueSchema>>

export const claraProjectWorkspaceSchema = passthroughObject({
  id: z.string(),
  harnessID: z.string(),
  harnessKind: z.string(),
  harnessLabel: z.string(),
  online: z.boolean(),
  active: z.boolean(),
  directory: z.string(),
  canonical: z.string().optional(),
  label: z.string().optional(),
  projectIDs: z.array(z.string()),
  linked: z.boolean(),
  lastSeenAt: z.number().optional(),
  vcs: z.string().optional(),
  sandboxes: z.array(z.string()).optional(),
}).meta({ id: 'ClaraProjectWorkspace' })

/** The harness's own project record. Workspaces link Clara projects to it. */
export const claraHarnessProjectSchema = passthroughObject({
  id: z.string(),
  canonical: z.string(),
  vcs: z.string().optional(),
  name: z.string().optional(),
  icon: passthroughObject({
    url: z.string().optional(),
    override: z.string().optional(),
    color: z.string().optional(),
  }).optional(),
  commands: passthroughObject({
    start: z.string().optional(),
  }).optional(),
  time: passthroughObject({
    created: z.number(),
    updated: z.number(),
    active: z.number(),
    archived: z.number().optional(),
  }),
  sandboxes: z.array(z.string()),
}).meta({ id: 'ClaraHarnessProject' })

/**
 * A Clara project is a user-owned container. Directories live on its
 * workspaces, one per harness location, so a project can group several
 * harnesses without pretending every harness shares a path.
 */
export const claraProjectSchema = passthroughObject({
  id: z.string(),
  name: z.string().optional(),
  icon: passthroughObject({
    url: z.string().optional(),
    override: z.string().optional(),
    color: z.string().optional(),
  }).optional(),
  commands: passthroughObject({
    start: z.string().optional(),
  }).optional(),
  startupScript: z.string().optional(),
  time: passthroughObject({
    created: z.number(),
    updated: z.number(),
    active: z.number(),
    archived: z.number().optional(),
  }),
  defaultWorkspaceID: z.string().optional(),
  workspaces: z.array(claraProjectWorkspaceSchema),
}).meta({ id: 'ClaraProject' })

export const claraSessionStatusSchema = z
  .discriminatedUnion('type', [
    passthroughObject({
      type: z.literal('idle'),
    }),
    passthroughObject({
      type: z.literal('retry'),
      attempt: z.number(),
      message: z.string(),
      action: passthroughObject({
        reason: z.string(),
        provider: z.string(),
        title: z.string(),
        message: z.string(),
        label: z.string(),
        link: z.string().optional(),
      }).optional(),
      next: z.number(),
    }),
    passthroughObject({
      type: z.literal('busy'),
    }),
  ])
  .meta({ id: 'ClaraSessionStatus' })

export const claraSessionForkBoundarySchema = z
  .discriminatedUnion('type', [
    passthroughObject({
      type: z.literal('before'),
      messageID: z.string(),
    }),
    passthroughObject({
      type: z.literal('through'),
      messageID: z.string(),
    }),
  ])
  .meta({ id: 'ClaraSessionForkBoundary' })

export const claraSessionRevertSchema = passthroughObject({
  messageID: z.string(),
  partID: z.string().optional(),
  snapshot: z.string().optional(),
  files: z.array(claraFileDiffSchema).optional(),
}).meta({ id: 'ClaraSessionRevert' })

export const claraSessionSchema = passthroughObject({
  id: z.string(),
  parentID: z.string().optional(),
  fork: passthroughObject({
    sessionID: z.string(),
    boundary: claraSessionForkBoundarySchema,
  }).optional(),
  projectID: z.string(),
  agent: z.string().optional(),
  model: claraModelRefSchema.optional(),
  cost: z.number(),
  tokens: claraTokenUsageSchema,
  outcome: z.enum(['succeeded', 'failed', 'interrupted']).optional(),
  time: passthroughObject({
    created: z.number(),
    updated: z.number(),
    idle: z.number().optional(),
    viewed: z.number().optional(),
    archived: z.number().optional(),
  }),
  title: z.string().optional(),
  subpath: z.string().optional(),
  metadata: claraSessionMetadataSchema.optional(),
  permissions: z.array(claraPermissionRuleSchema).optional(),
  revert: claraSessionRevertSchema.optional(),
  location: claraLocationRefSchema,
}).meta({ id: 'ClaraSession' })

export const claraSessionsResponseSchema = passthroughObject({
  data: z.array(claraSessionSchema),
  cursor: passthroughObject({
    previous: z.string().nullish(),
    next: z.string().nullish(),
  }),
}).meta({ id: 'ClaraSessionsResponse' })

export const claraSessionActiveSchema = passthroughObject({
  type: z.literal('running'),
}).meta({ id: 'ClaraSessionActive' })

export const claraSessionActiveOutputSchema = z
  .record(z.string(), claraSessionActiveSchema)
  .meta({ id: 'ClaraSessionActiveOutput' })

export const claraSessionInterruptResponseSchema = passthroughObject({
  interrupted: z.boolean(),
}).meta({ id: 'ClaraSessionInterruptResponse' })

export const claraSessionInboxDeliverySchema = z.enum(['steer', 'queue'])

export type ClaraSessionInboxDelivery = z.infer<typeof claraSessionInboxDeliverySchema>

export const claraSessionInboxUserPayloadSchema = passthroughObject({
  text: z.string(),
  files: z.array(claraPromptFileAttachmentSchema).optional(),
  agents: z.array(claraPromptAgentAttachmentSchema).optional(),
  skills: z.array(claraPromptSkillAttachmentSchema).optional(),
  metadata: z.record(z.string(), claraJsonValueSchema).optional(),
}).meta({ id: 'ClaraSessionInboxUserPayload' })

export const claraSessionInboxSyntheticPayloadSchema = passthroughObject({
  text: z.string(),
  description: z.string().optional(),
  metadata: z.record(z.string(), claraJsonValueSchema).optional(),
}).meta({ id: 'ClaraSessionInboxSyntheticPayload' })

export const claraSessionInboxCompactionPayloadSchema = passthroughObject({}).meta({
  id: 'ClaraSessionInboxCompactionPayload',
})

export const claraSessionInboxMovePayloadSchema = passthroughObject({
  projectID: z.string(),
  subpath: z.string().optional(),
  location: claraLocationRefSchema,
}).meta({ id: 'ClaraSessionInboxMovePayload' })

export const claraSessionInboxItemSchema = z
  .discriminatedUnion('type', [
    passthroughObject({
      type: z.literal('user'),
      payload: claraSessionInboxUserPayloadSchema,
      delivery: claraSessionInboxDeliverySchema,
    }),
    passthroughObject({
      type: z.literal('synthetic'),
      payload: claraSessionInboxSyntheticPayloadSchema,
      delivery: claraSessionInboxDeliverySchema,
    }),
    passthroughObject({
      type: z.literal('compaction'),
      payload: claraSessionInboxCompactionPayloadSchema,
      delivery: claraSessionInboxDeliverySchema,
    }),
    passthroughObject({
      type: z.literal('move'),
      payload: claraSessionInboxMovePayloadSchema,
      delivery: claraSessionInboxDeliverySchema,
    }),
  ])
  .meta({ id: 'ClaraSessionInboxItem' })

const inboxBaseShape = {
  id: z.string(),
  sessionID: z.string(),
  time: passthroughObject({
    created: z.number(),
  }),
  delivery: claraSessionInboxDeliverySchema,
}

export const claraSessionInboxUserSchema = passthroughObject({
  ...inboxBaseShape,
  type: z.literal('user'),
  payload: claraSessionInboxUserPayloadSchema,
}).meta({ id: 'ClaraSessionInboxUser' })

export const claraSessionInboxSyntheticSchema = passthroughObject({
  ...inboxBaseShape,
  type: z.literal('synthetic'),
  payload: claraSessionInboxSyntheticPayloadSchema,
}).meta({ id: 'ClaraSessionInboxSynthetic' })

export const claraSessionInboxCompactionSchema = passthroughObject({
  ...inboxBaseShape,
  type: z.literal('compaction'),
  payload: claraSessionInboxCompactionPayloadSchema,
}).meta({ id: 'ClaraSessionInboxCompaction' })

export const claraSessionInboxMoveSchema = passthroughObject({
  ...inboxBaseShape,
  type: z.literal('move'),
  payload: claraSessionInboxMovePayloadSchema,
}).meta({ id: 'ClaraSessionInboxMove' })

export const claraSessionInboxInfoSchema = z
  .union([
    claraSessionInboxUserSchema,
    claraSessionInboxSyntheticSchema,
    claraSessionInboxCompactionSchema,
    claraSessionInboxMoveSchema,
  ])
  .meta({ id: 'ClaraSessionInboxInfo' })

export const claraSessionInboxListSchema = z.array(claraSessionInboxInfoSchema)

export type ClaraProject = z.infer<typeof claraProjectSchema>
export type ClaraProjectWorkspace = z.infer<typeof claraProjectWorkspaceSchema>
export type ClaraHarnessProject = z.infer<typeof claraHarnessProjectSchema>
export type ClaraSessionStatus = z.infer<typeof claraSessionStatusSchema>
export type ClaraSessionForkBoundary = z.infer<typeof claraSessionForkBoundarySchema>
export type ClaraSessionRevert = z.infer<typeof claraSessionRevertSchema>
export type ClaraSession = z.infer<typeof claraSessionSchema>
export type ClaraSessionTokens = ClaraTokenUsage
export type ClaraSessionsResponse = z.infer<typeof claraSessionsResponseSchema>
export type ClaraSessionActive = z.infer<typeof claraSessionActiveSchema>
export type ClaraSessionActiveOutput = z.infer<typeof claraSessionActiveOutputSchema>
export type ClaraSessionInterruptResponse = z.infer<typeof claraSessionInterruptResponseSchema>
export type ClaraSessionInboxUserPayload = z.infer<typeof claraSessionInboxUserPayloadSchema>
export type ClaraSessionInboxSyntheticPayload = z.infer<
  typeof claraSessionInboxSyntheticPayloadSchema
>
export type ClaraSessionInboxCompactionPayload = z.infer<
  typeof claraSessionInboxCompactionPayloadSchema
>
export type ClaraSessionInboxMovePayload = z.infer<typeof claraSessionInboxMovePayloadSchema>
export type ClaraSessionInboxItem = z.infer<typeof claraSessionInboxItemSchema>
export type ClaraSessionInboxUser = z.infer<typeof claraSessionInboxUserSchema>
export type ClaraSessionInboxSynthetic = z.infer<typeof claraSessionInboxSyntheticSchema>
export type ClaraSessionInboxCompaction = z.infer<typeof claraSessionInboxCompactionSchema>
export type ClaraSessionInboxMove = z.infer<typeof claraSessionInboxMoveSchema>
export type ClaraSessionInboxInfo = z.infer<typeof claraSessionInboxInfoSchema>
