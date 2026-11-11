import { z } from 'zod'
import { claraPermissionRuleSchema } from './permissions.ts'
import { passthroughObject } from './schema.ts'
import { claraLocationRefSchema } from './server.ts'

export const claraTokenUsageSchema = passthroughObject({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: passthroughObject({
    read: z.number(),
    write: z.number(),
  }),
}).meta({ id: 'ClaraTokenUsage' })

export const claraModelRefSchema = passthroughObject({
  id: z.string(),
  providerID: z.string(),
  variant: z.string().optional(),
}).meta({ id: 'ClaraModelRef' })

export const claraModelCostSchema = passthroughObject({
  tier: passthroughObject({
    type: z.literal('context'),
    size: z.number(),
  }).optional(),
  input: z.number(),
  output: z.number(),
  cache: passthroughObject({
    read: z.number(),
    write: z.number(),
  }),
}).meta({ id: 'ClaraModelCost' })

export const claraModelCapabilitiesSchema = passthroughObject({
  tools: z.boolean(),
  input: z.array(z.string()),
  output: z.array(z.string()),
  temperature: z.boolean().optional(),
}).meta({ id: 'ClaraModelCapabilities' })

export const claraModelVariantSchema = passthroughObject({
  id: z.string(),
  settings: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
}).meta({ id: 'ClaraModelVariant' })

export const claraModelSchema = passthroughObject({
  id: z.string(),
  modelID: z.string(),
  providerID: z.string(),
  canonical: z.string().optional(),
  family: z.string().optional(),
  name: z.string(),
  compatibility: z.unknown().optional(),
  package: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  capabilities: claraModelCapabilitiesSchema,
  variants: z.array(claraModelVariantSchema),
  time: passthroughObject({
    released: z.number(),
  }),
  cost: z.array(claraModelCostSchema),
  status: z.enum(['alpha', 'beta', 'deprecated', 'active']),
  enabled: z.boolean(),
  limit: passthroughObject({
    context: z.number(),
    input: z.number().optional(),
    output: z.number(),
  }),
}).meta({ id: 'ClaraModel' })

export const claraProviderSchema = passthroughObject({
  id: z.string(),
  canonical: z.string().optional(),
  integrationID: z.string().optional(),
  name: z.string(),
  activation: z.enum(['auto', 'enabled', 'disabled']),
  package: z.string(),
  compatibility: z.unknown().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
}).meta({ id: 'ClaraProvider' })

export const claraProviderRequestSchema = passthroughObject({
  settings: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.string()),
  body: z.record(z.string(), z.unknown()),
}).meta({ id: 'ClaraProviderRequest' })

export const claraAgentSchema = passthroughObject({
  id: z.string(),
  name: z.string(),
  model: claraModelRefSchema.optional(),
  request: claraProviderRequestSchema,
  system: z.string().optional(),
  description: z.string().optional(),
  mode: z.enum(['subagent', 'primary', 'all']),
  hidden: z.boolean(),
  color: z.string().optional(),
  steps: z.number().optional(),
  permissions: z.array(claraPermissionRuleSchema),
}).meta({ id: 'ClaraAgent' })

export const claraCommandSchema = passthroughObject({
  name: z.string(),
  description: z.string().optional(),
}).meta({ id: 'ClaraCommand' })

export const claraSkillSchema = passthroughObject({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  autoinvoke: z.boolean().optional(),
  path: z.string(),
  content: z.string(),
}).meta({ id: 'ClaraSkill' })

export const claraReferenceSourceSchema = z
  .discriminatedUnion('type', [
    passthroughObject({
      type: z.literal('local'),
      path: z.string(),
    }),
    passthroughObject({
      type: z.literal('git'),
      repository: z.string(),
      branch: z.string().optional(),
    }),
  ])
  .meta({ id: 'ClaraReferenceSource' })

export const claraReferenceSchema = passthroughObject({
  name: z.string(),
  path: z.string(),
  description: z.string().optional(),
  hidden: z.boolean().optional(),
  source: claraReferenceSourceSchema,
}).meta({ id: 'ClaraReference' })

export const claraFileSystemEntrySchema = passthroughObject({
  path: z.string(),
  type: z.enum(['file', 'directory']),
}).meta({ id: 'ClaraFileSystemEntry' })

export const claraAgentListOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraAgentSchema),
}).meta({ id: 'ClaraAgentListOutput' })

export const claraModelListOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraModelSchema),
}).meta({ id: 'ClaraModelListOutput' })

export const claraProviderListOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraProviderSchema),
}).meta({ id: 'ClaraProviderListOutput' })

export const claraCommandListOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraCommandSchema),
}).meta({ id: 'ClaraCommandListOutput' })

export const claraSkillListOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraSkillSchema),
}).meta({ id: 'ClaraSkillListOutput' })

export const claraReferenceListOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraReferenceSchema),
}).meta({ id: 'ClaraReferenceListOutput' })

export const claraFileFindOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraFileSystemEntrySchema),
}).meta({ id: 'ClaraFileFindOutput' })

export type ClaraTokenUsage = z.infer<typeof claraTokenUsageSchema>
export type ClaraModelRef = z.infer<typeof claraModelRefSchema>
export type ClaraModelCost = z.infer<typeof claraModelCostSchema>
export type ClaraModelCapabilities = z.infer<typeof claraModelCapabilitiesSchema>
export type ClaraModelVariant = z.infer<typeof claraModelVariantSchema>
export type ClaraModel = z.infer<typeof claraModelSchema>
export type ClaraProvider = z.infer<typeof claraProviderSchema>
export type ClaraProviderRequest = z.infer<typeof claraProviderRequestSchema>
export type ClaraAgent = z.infer<typeof claraAgentSchema>
export type ClaraCommand = z.infer<typeof claraCommandSchema>
export type ClaraSkill = z.infer<typeof claraSkillSchema>
export type ClaraReferenceSource = z.infer<typeof claraReferenceSourceSchema>
export type ClaraReference = z.infer<typeof claraReferenceSchema>
export type ClaraFileSystemEntry = z.infer<typeof claraFileSystemEntrySchema>
export type ClaraAgentListOutput = z.infer<typeof claraAgentListOutputSchema>
export type ClaraModelListOutput = z.infer<typeof claraModelListOutputSchema>
export type ClaraProviderListOutput = z.infer<typeof claraProviderListOutputSchema>
export type ClaraCommandListOutput = z.infer<typeof claraCommandListOutputSchema>
export type ClaraSkillListOutput = z.infer<typeof claraSkillListOutputSchema>
export type ClaraReferenceListOutput = z.infer<typeof claraReferenceListOutputSchema>
export type ClaraFileFindOutput = z.infer<typeof claraFileFindOutputSchema>
