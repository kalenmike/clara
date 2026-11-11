import { z } from 'zod'
import { passthroughObject } from './schema.ts'

export const claraPromptMentionSchema = passthroughObject({
  start: z.number(),
  end: z.number(),
  text: z.string(),
}).meta({ id: 'ClaraPromptMention' })

export const claraPromptFileSourceSchema = z
  .discriminatedUnion('type', [
    passthroughObject({
      type: z.literal('inline'),
    }),
    passthroughObject({
      type: z.literal('uri'),
      uri: z.string(),
    }),
  ])
  .meta({ id: 'ClaraPromptFileSource' })

export const claraPromptFileAttachmentSchema = passthroughObject({
  data: z.string(),
  mime: z.string(),
  source: claraPromptFileSourceSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  mention: claraPromptMentionSchema.optional(),
}).meta({ id: 'ClaraPromptFileAttachment' })

export const claraPromptAgentAttachmentSchema = passthroughObject({
  name: z.string(),
  mention: claraPromptMentionSchema.optional(),
}).meta({ id: 'ClaraPromptAgentAttachment' })

export const claraPromptSkillAttachmentSchema = passthroughObject({
  id: z.string(),
  name: z.string(),
  text: z.string().optional(),
  mention: claraPromptMentionSchema.optional(),
}).meta({ id: 'ClaraPromptSkillAttachment' })

export type ClaraPromptMention = z.infer<typeof claraPromptMentionSchema>
export type ClaraPromptFileSource = z.infer<typeof claraPromptFileSourceSchema>
export type ClaraPromptFileAttachment = z.infer<typeof claraPromptFileAttachmentSchema>
export type ClaraPromptAgentAttachment = z.infer<typeof claraPromptAgentAttachmentSchema>
export type ClaraPromptSkillAttachment = z.infer<typeof claraPromptSkillAttachmentSchema>
