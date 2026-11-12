import { z } from 'zod'
import { passthroughObject } from './schema.ts'

export const claraLocationRefSchema = passthroughObject({
  directory: z.string(),
  workspaceID: z.string().optional(),
}).meta({ id: 'ClaraLocationRef' })

export const claraLocationSchema = passthroughObject({
  directory: z.string(),
  project: passthroughObject({
    id: z.string(),
    directory: z.string(),
    canonical: z.string(),
  }),
}).meta({ id: 'ClaraLocation' })

export const claraServerInfoSchema = passthroughObject({
  version: z.string(),
  pid: z.number(),
  urls: z.array(z.string()),
  paths: passthroughObject({
    tmp: z.string(),
  }),
  capabilities: passthroughObject({
    persistentPty: z.boolean().optional(),
  }).optional(),
}).meta({ id: 'ClaraServerInfo' })

export type ClaraLocationRef = z.infer<typeof claraLocationRefSchema>
export type ClaraLocation = z.infer<typeof claraLocationSchema>
export type ClaraServerInfo = z.infer<typeof claraServerInfoSchema>
