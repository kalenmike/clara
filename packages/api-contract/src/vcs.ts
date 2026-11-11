import { z } from 'zod'
import { passthroughObject } from './schema.ts'
import { claraLocationRefSchema } from './server.ts'

const fileStatusSchema = z.enum(['added', 'deleted', 'modified'])

export const claraVcsBranchSchema = passthroughObject({
  current: z.string().optional(),
  default: z.string().optional(),
}).meta({ id: 'ClaraVcsBranch' })

export const claraVcsInfoSchema = passthroughObject({
  provider: z.string().optional(),
  branch: claraVcsBranchSchema,
}).meta({ id: 'ClaraVcsInfo' })

export const claraVcsBaseSchema = passthroughObject({
  name: z.string(),
  ref: z.string(),
  source: z.enum(['reflog', 'default']),
}).meta({ id: 'ClaraVcsBase' })

export const claraVcsFileStatusSchema = passthroughObject({
  file: z.string(),
  additions: z.number(),
  deletions: z.number(),
  status: fileStatusSchema,
}).meta({ id: 'ClaraVcsFileStatus' })

export const claraFileDiffSchema = passthroughObject({
  file: z.string(),
  patch: z.string(),
  additions: z.number(),
  deletions: z.number(),
  status: fileStatusSchema,
}).meta({ id: 'ClaraFileDiff' })

export const claraWorktreeSchema = passthroughObject({
  directory: z.string(),
  strategy: z.string().optional(),
}).meta({ id: 'ClaraWorktree' })

export const claraWorktreeListSchema = z
  .array(claraWorktreeSchema)
  .meta({ id: 'ClaraWorktreeList' })

export const claraVcsGetOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: claraVcsInfoSchema,
}).meta({ id: 'ClaraVcsGetOutput' })

export const claraVcsBaseOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: claraVcsBaseSchema.nullable(),
}).meta({ id: 'ClaraVcsBaseOutput' })

export const claraVcsStatusOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraVcsFileStatusSchema),
}).meta({ id: 'ClaraVcsStatusOutput' })

export const claraVcsDiffOutputSchema = passthroughObject({
  location: claraLocationRefSchema,
  data: z.array(claraFileDiffSchema),
}).meta({ id: 'ClaraVcsDiffOutput' })

export type ClaraVcsBranch = z.infer<typeof claraVcsBranchSchema>
export type ClaraVcsInfo = z.infer<typeof claraVcsInfoSchema>
export type ClaraVcsBase = z.infer<typeof claraVcsBaseSchema>
export type ClaraVcsFileStatus = z.infer<typeof claraVcsFileStatusSchema>
export type ClaraFileDiff = z.infer<typeof claraFileDiffSchema>
export type ClaraWorktree = z.infer<typeof claraWorktreeSchema>
export type ClaraWorktreeList = z.infer<typeof claraWorktreeListSchema>
export type ClaraVcsGetOutput = z.infer<typeof claraVcsGetOutputSchema>
export type ClaraVcsBaseOutput = z.infer<typeof claraVcsBaseOutputSchema>
export type ClaraVcsStatusOutput = z.infer<typeof claraVcsStatusOutputSchema>
export type ClaraVcsDiffOutput = z.infer<typeof claraVcsDiffOutputSchema>
