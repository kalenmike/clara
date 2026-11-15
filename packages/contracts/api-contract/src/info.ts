import { z } from 'zod'

export const agentInfoSchema = z.object({
  version: z.string(),
  protocol: z.number(),
  opencodeVersion: z.string().optional(),
  room: z.string().optional(),
  pushPublicKey: z.string().optional(),
  syncEnabled: z.boolean().optional(),
  syncIntervalMs: z.number().optional(),
  orchestration: z.boolean().optional(),
})

export const apiInfoSchema = z.object({
  server: z.object({
    version: z.string(),
    protocol: z.number(),
    startedAt: z.number(),
    pid: z.number(),
  }),
  harness: z.object({
    configured: z.boolean(),
    generation: z.number(),
    paired: z.number(),
    online: z.number(),
    lastError: z.string().nullable(),
  }),
  agent: agentInfoSchema,
  api: z.object({
    version: z.literal('v1'),
    openapi: z.string(),
    docs: z.string(),
  }),
})

export type ApiInfo = z.infer<typeof apiInfoSchema>

/** A paired harness connection exposed to the browser for workspace setup. */
export const claraHarnessConnectionSchema = z.object({
  harnessID: z.string(),
  kind: z.string(),
  label: z.string(),
  online: z.boolean(),
  capabilities: z.record(z.string(), z.unknown()),
})

export const claraHarnessConnectionListSchema = z.array(claraHarnessConnectionSchema)

export type ClaraHarnessConnection = z.infer<typeof claraHarnessConnectionSchema>
