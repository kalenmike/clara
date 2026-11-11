import { z } from 'zod'
import { claraJsonValueSchema } from './json.ts'
import { passthroughObject } from './schema.ts'
import { claraLocationRefSchema } from './server.ts'

export const claraPermissionRuleSchema = passthroughObject({
  action: z.string(),
  resource: z.string(),
  effect: z.enum(['allow', 'deny', 'ask']),
}).meta({ id: 'ClaraPermissionRule' })

export const claraPermissionSourceSchema = passthroughObject({
  type: z.literal('tool'),
  messageID: z.string(),
  id: z.string(),
}).meta({ id: 'ClaraPermissionSource' })

export const claraPermissionRequestSchema = passthroughObject({
  id: z.string(),
  sessionID: z.string(),
  action: z.string(),
  resources: z.array(z.string()),
  save: z.array(z.string()).optional(),
  metadata: z.record(z.string(), claraJsonValueSchema).optional(),
  source: claraPermissionSourceSchema.optional(),
  message: z.string().optional(),
}).meta({ id: 'ClaraPermissionRequest' })

export const claraPermissionRequestListOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraPermissionRequestSchema),
}).meta({ id: 'ClaraPermissionRequestListOutput' })

export type ClaraPermissionRule = z.infer<typeof claraPermissionRuleSchema>
export type ClaraPermissionSource = z.infer<typeof claraPermissionSourceSchema>
export type ClaraPermissionRequest = z.infer<typeof claraPermissionRequestSchema>
export type ClaraPermissionRequestListOutput = z.infer<
  typeof claraPermissionRequestListOutputSchema
>
