import { z } from 'zod'
import { passthroughObject } from './schema.ts'
import { claraProjectSchema } from './sessions.ts'

/**
 * One harness's answer to a project-level archive or delete request. Clara
 * always applies its own change; this records what the harness could do.
 */
export const claraProjectHarnessResultSchema = passthroughObject({
  harnessID: z.string(),
  label: z.string(),
  kind: z.string(),
  ok: z.boolean(),
  code: z.string().optional(),
  message: z.string().optional(),
  affected: z.number().optional(),
}).meta({ id: 'ClaraProjectHarnessResult' })

export const claraProjectArchiveResultSchema = passthroughObject({
  project: claraProjectSchema,
  harnesses: z.array(claraProjectHarnessResultSchema),
}).meta({ id: 'ClaraProjectArchiveResult' })

export const claraProjectDeleteResultSchema = passthroughObject({
  removed: z.literal(true),
  harnesses: z.array(claraProjectHarnessResultSchema),
}).meta({ id: 'ClaraProjectDeleteResult' })

/** A harness project that can be imported as a Clara workspace. */
export const claraProjectAvailableSchema = passthroughObject({
  harnessID: z.string(),
  harnessLabel: z.string(),
  harnessKind: z.string(),
  projectID: z.string(),
  canonical: z.string(),
  name: z.string().optional(),
  vcs: z.string().optional(),
}).meta({ id: 'ClaraProjectAvailable' })

export type ClaraProjectHarnessResult = z.infer<typeof claraProjectHarnessResultSchema>
export type ClaraProjectArchiveResult = z.infer<typeof claraProjectArchiveResultSchema>
export type ClaraProjectDeleteResult = z.infer<typeof claraProjectDeleteResultSchema>
export type ClaraProjectAvailable = z.infer<typeof claraProjectAvailableSchema>
