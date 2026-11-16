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

/** The machine or container an adapter runs on, as seen in pickers. */
export const claraHarnessHostSchema = z.object({
  hostname: z.string().optional(),
  platform: z.string().optional(),
  arch: z.string().optional(),
  container: z
    .object({
      runtime: z.enum(['docker', 'podman', 'kubernetes', 'other']).optional(),
    })
    .optional(),
  installMethod: z.enum(['local', 'ssh', 'docker']).optional(),
})

export type ClaraHarnessHost = z.infer<typeof claraHarnessHostSchema>

/** A paired harness connection exposed to the browser for workspace setup. */
export const claraHarnessConnectionSchema = z.object({
  harnessID: z.string(),
  kind: z.string(),
  label: z.string(),
  online: z.boolean(),
  capabilities: z.record(z.string(), z.unknown()),
  host: claraHarnessHostSchema.optional(),
})

export const claraHarnessConnectionListSchema = z.array(claraHarnessConnectionSchema)

export type ClaraHarnessConnection = z.infer<typeof claraHarnessConnectionSchema>
